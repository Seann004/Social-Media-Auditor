import { createHash } from 'node:crypto'
import { errors, type Browser, type BrowserContext, type Page, type Request } from 'playwright'
import { z } from 'zod'
import { classifyAccess } from './access.js'
import { createGuardedContext, gotoGuarded, isTimeoutError } from './browser.js'
import { JPEG_QUALITY, LINK_DEPTH, MAX_PAGES_PER_RUN, PAGE_TIMEOUT_MS } from './config.js'
import { createRobotsChecker, ROBOTS_DISALLOWED_REASON, type RobotsChecker } from './robots.js'
import type { AccessStatus } from './types.js'
import type { UrlCheckResult, UrlGuard } from './urlGuard.js'

export interface CaptureLimits {
  maxPages: number
  maxDepth: number
  pageTimeoutMs: number
}

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = {
  maxPages: MAX_PAGES_PER_RUN,
  maxDepth: LINK_DEPTH,
  pageTimeoutMs: PAGE_TIMEOUT_MS,
}

export interface CapturedPageData {
  url: string
  finalUrl: string | null
  httpStatus: number | null
  accessStatus: AccessStatus
  accessDetail: string | null
  title: string | null
  text: string
  accessibilitySnapshot: string | null
  screenshot: Buffer | null
  contentHash: string | null
  capturedAt: string
}

export interface CaptureOptions {
  browser: Browser
  guard: UrlGuard
  startUrls: string[]
  respectRobots: boolean
  signal: AbortSignal
  limits?: Partial<CaptureLimits>
  onPage: (page: CapturedPageData) => Promise<void>
}

interface CaptureRun {
  guard: UrlGuard
  limits: CaptureLimits
  context: BrowserContext
  violations: string[]
  robots: RobotsChecker | null
}

interface QueueEntry {
  url: string
  /** Links followed since the start url. The start url is 0. */
  depth: number
  /** Null only for a start url that cannot be parsed. */
  siteHost: string | null
}

interface Visit {
  page: CapturedPageData
  links: string[]
}

const LEFT_SITE_DETAIL = 'The link redirected away from the site being captured.'
const REFUSED_NAVIGATION_DETAIL = 'The page tried to move to an address that is not allowed.'

/**
 * Sent as a source string, not a function: esbuild's keepNames under `npx tsx` can
 * inject a __name helper into functions, and the helper does not exist in the browser.
 * For an element with no box innerText falls back to textContent, so a wholly hidden
 * body has to be ruled out first.
 */
const READ_PAGE_SOURCE = `({
  text: document.body && document.body.checkVisibility() ? document.body.innerText : '',
  hasPasswordField: document.querySelector('input[type="password"]') !== null,
  links: Array.from(document.querySelectorAll('a[href]'), (a) => a.href).filter((href) => typeof href === 'string'),
})`

/** The page can replace any global that source relies on, so its answer is untrusted. */
const pageContentSchema = z.object({
  text: z.string(),
  hasPasswordField: z.boolean(),
  links: z.array(z.string()),
})

function refuse(reason: string): UrlCheckResult {
  return { allowed: false, reason }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function siteHostOf(url: string): string | null {
  return hostOf(url)?.replace(/^www\./, '') ?? null
}

function isSameSite(url: string, siteHost: string | null): boolean {
  const host = hostOf(url)
  if (host === null || siteHost === null) return false
  return host === siteHost || host.endsWith(`.${siteHost}`)
}

function isHttpUrl(url: string): boolean {
  return /^https?:/i.test(url)
}

function withoutFragment(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href
  } catch {
    return url
  }
}

function pageWithoutContent(url: string, accessStatus: AccessStatus, accessDetail: string | null): CapturedPageData {
  return {
    url,
    finalUrl: null,
    httpStatus: null,
    accessStatus,
    accessDetail,
    title: null,
    text: '',
    accessibilitySnapshot: null,
    screenshot: null,
    contentHash: null,
    capturedAt: new Date().toISOString(),
  }
}

function discardedVisit(url: string, reason: string): Visit {
  return { page: pageWithoutContent(url, 'blocked', reason), links: [] }
}

function failedVisit(url: string, err: unknown): Visit {
  const timedOut = isTimeoutError(err)
  const access = classifyAccess({
    httpStatus: null,
    finalUrl: url,
    title: '',
    text: '',
    hasPasswordField: false,
    timedOut,
    navigationError: !timedOut,
  })
  return { page: pageWithoutContent(url, access.status, access.detail), links: [] }
}

/**
 * What may be navigated to for this entry: the URL guard, then the site scope (a start url
 * may redirect anywhere, a followed link may not), then robots.txt. Applied to every redirect
 * hop by gotoGuarded, so a refused hop is never requested.
 */
function navigationGuard(entry: QueueEntry, run: CaptureRun): UrlGuard {
  return {
    async check(url: string): Promise<UrlCheckResult> {
      const verdict = await run.guard.check(url)
      if (!verdict.allowed) return refuse(`The URL guard refused this address: ${verdict.reason}`)
      if (entry.depth > 0 && !isSameSite(url, entry.siteHost)) return refuse(LEFT_SITE_DETAIL)
      if (!run.robots) return { allowed: true }
      const rules = await run.robots.isAllowed(url)
      return rules.allowed ? { allowed: true } : refuse(rules.reason ?? ROBOTS_DISALLOWED_REASON)
    },
  }
}

function isMainFrameNavigation(request: Request, page: Page): boolean {
  if (!request.isNavigationRequest()) return false
  try {
    return request.frame() === page.mainFrame()
  } catch {
    // Playwright throws when the frame is not known yet. Count it: only a refused url has any effect.
    return true
  }
}

/** Keeps a list of every url the main frame asks for, including ones the page starts itself. */
function trackMainFrameNavigations(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    if (isMainFrameNavigation(request, page)) urls.push(request.url())
  })
  return urls
}

async function findRefusal(urls: string[], guard: UrlGuard, violations: string[]): Promise<string | null> {
  for (const url of urls) {
    if (violations.includes(url)) return REFUSED_NAVIGATION_DETAIL
    const verdict = await guard.check(url)
    if (!verdict.allowed) return verdict.reason
  }
  return null
}

function withinTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new errors.TimeoutError(`${what} timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

async function readSnapshot(page: Page, timeoutMs: number): Promise<string | null> {
  try {
    return await page.ariaSnapshot({ timeout: timeoutMs })
  } catch (err) {
    if (isTimeoutError(err)) throw err
    return null
  }
}

async function readPage(page: Page, timeoutMs: number) {
  const content = pageContentSchema.parse(await page.evaluate(READ_PAGE_SOURCE))
  const title = await page.title()
  const accessibilitySnapshot = await readSnapshot(page, timeoutMs)
  return { ...content, title, accessibilitySnapshot }
}

async function takeScreenshot(page: Page, timeoutMs: number): Promise<Buffer | null> {
  try {
    return await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, fullPage: true, timeout: timeoutMs })
  } catch {
    // Evidence text is still usable without a picture of it.
    return null
  }
}

async function loadPage(page: Page, entry: QueueEntry, guard: UrlGuard, navigations: string[], run: CaptureRun): Promise<Visit> {
  const timeoutMs = run.limits.pageTimeoutMs
  const navigation = await gotoGuarded(page, entry.url, guard, timeoutMs)
  if (navigation.blockedReason !== null) return discardedVisit(entry.url, navigation.blockedReason)

  // page.evaluate has no timeout of its own, and a hostile page can keep the renderer busy forever.
  const content = await withinTimeout(readPage(page, timeoutMs), timeoutMs, 'Reading the page')
  const screenshot = await takeScreenshot(page, timeoutMs)

  // Last, so that it also covers anything the page did while it was being read.
  const finalUrl = page.url()
  const refusal = await findRefusal([...navigations, finalUrl], guard, run.violations)
  if (refusal !== null) return discardedVisit(entry.url, refusal)

  const httpStatus = navigation.response?.status() ?? null
  const access = classifyAccess({
    httpStatus,
    finalUrl,
    title: content.title,
    text: content.text,
    hasPasswordField: content.hasPasswordField,
    timedOut: false,
    navigationError: false,
  })
  return {
    page: {
      url: entry.url,
      finalUrl,
      httpStatus,
      accessStatus: access.status,
      accessDetail: access.detail,
      title: content.title,
      text: content.text,
      accessibilitySnapshot: content.accessibilitySnapshot,
      screenshot,
      contentHash: content.text ? createHash('sha256').update(content.text).digest('hex') : null,
      capturedAt: new Date().toISOString(),
    },
    links: access.status === 'ok' ? content.links : [],
  }
}

async function closeQuietly(page: Page): Promise<void> {
  try {
    await page.close()
  } catch {
    // Already closed with its context, which is the state wanted.
  }
}

async function visitPage(entry: QueueEntry, run: CaptureRun): Promise<Visit> {
  const guard = navigationGuard(entry, run)
  const verdict = await guard.check(entry.url)
  if (!verdict.allowed) return discardedVisit(entry.url, verdict.reason)

  const page = await run.context.newPage()
  page.on('popup', (popup) => void closeQuietly(popup))
  const navigations = trackMainFrameNavigations(page)
  try {
    return await loadPage(page, entry, guard, navigations, run)
  } catch (err) {
    return failedVisit(entry.url, err)
  } finally {
    await closeQuietly(page)
  }
}

function linksToFollow(links: string[], from: QueueEntry): QueueEntry[] {
  return links
    .filter((link) => isHttpUrl(link) && isSameSite(link, from.siteHost))
    .map((link) => ({ url: withoutFragment(link), depth: from.depth + 1, siteHost: from.siteHost }))
}

/** Breadth first, so that every start url is captured before any link uses up the page limit. */
async function crawl(opts: CaptureOptions, run: CaptureRun): Promise<void> {
  const { signal, onPage } = opts
  const aborted = new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null)
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })

  const seen = new Set<string>()
  const queue: QueueEntry[] = []
  const enqueue = (entry: QueueEntry) => {
    if (seen.has(entry.url)) return
    seen.add(entry.url)
    queue.push(entry)
  }
  opts.startUrls.forEach((url) => enqueue({ url: withoutFragment(url), depth: 0, siteHost: siteHostOf(url) }))

  for (let next = 0; next < queue.length && next < run.limits.maxPages; next += 1) {
    if (signal.aborted) return
    const entry = queue[next]
    const visit = await Promise.race([visitPage(entry, run), aborted])
    if (visit === null || signal.aborted) return

    await onPage(visit.page)
    if (entry.depth < run.limits.maxDepth) linksToFollow(visit.links, entry).forEach(enqueue)
  }
}

/**
 * Visits the start urls and their same-site links in one browser context, reporting each
 * page through onPage. A page that fails is reported with its status and the run carries on.
 * Resolves, without reporting the page in progress, as soon as the signal aborts.
 */
export async function capturePages(opts: CaptureOptions): Promise<void> {
  if (opts.signal.aborted) return

  const { context, violations } = await createGuardedContext(opts.browser, opts.guard)
  const run: CaptureRun = {
    guard: opts.guard,
    limits: { ...DEFAULT_CAPTURE_LIMITS, ...opts.limits },
    context,
    violations,
    robots: opts.respectRobots ? createRobotsChecker(opts.guard) : null,
  }

  let closing: Promise<void> | null = null
  const closeContext = (): Promise<void> => {
    closing ??= context.close().catch((err: unknown) => {
      console.error('Failed to close the capture browser context:', err)
    })
    return closing
  }
  // Closing the context is what makes anything in flight in the browser give up at once.
  opts.signal.addEventListener('abort', closeContext, { once: true })
  try {
    await crawl(opts, run)
  } finally {
    opts.signal.removeEventListener('abort', closeContext)
    await closeContext()
  }
}

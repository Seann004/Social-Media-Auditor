import { createHash } from 'node:crypto'
import { errors, type Browser, type BrowserContext, type Page } from 'playwright'
import { classifyAccess } from './access.js'
import {
  createGuardedContext,
  gotoGuarded,
  isClosedError,
  isMainFrameNavigation,
  isTimeoutError,
  PageTooLargeError,
  withoutFragment,
  type GuardedContext,
} from './browser.js'
import { logCaptureFailure } from './captureLog.js'
import {
  BROWSER_CLOSE_TIMEOUT_MS,
  JPEG_QUALITY,
  LINK_DEPTH,
  MAX_PAGES_PER_RUN,
  PAGE_TIMEOUT_MS,
  VISIT_DEADLINE_PAGE_TIMEOUTS,
} from './config.js'
import { readPageContent } from './pageRead.js'
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
  browser: Browser
  guard: UrlGuard
  limits: CaptureLimits
  context: BrowserContext
  violations: string[]
  robots: RobotsChecker | null
  signal: AbortSignal
  /** Resolves when the signal aborts, so that any wait can be raced against it. */
  aborted: Promise<null>
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
const REFUSED_NAVIGATION_DETAIL = 'The page tried to move somewhere a capture does not follow.'
const BROWSER_GONE_DETAIL = 'The browser was not available, so this page was not captured.'
const OUT_OF_TIME_DETAIL = 'The page did not finish in time.'

/** Files a capture cannot read as a page. Only checked on links, since a start url is the auditor's choice. */
const BINARY_FILE_PATTERN =
  /\.(pdf|zip|gz|tgz|tar|rar|7z|exe|msi|dmg|pkg|deb|rpm|apk|ipa|iso|bin|jar|mp3|m4a|wav|ogg|flac|aac|mp4|m4v|mov|avi|mkv|webm|wmv|flv|jpe?g|png|gif|webp|avif|bmp|tiff?|ico|svg|docx?|xlsx?|pptx?)$/i

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

function failedVisit(url: string, err: unknown, run: CaptureRun): Visit {
  if (!run.signal.aborted && !isClosedError(err)) logCaptureFailure('Could not capture the page', url, err)
  if (!run.browser.isConnected()) return { page: pageWithoutContent(url, 'error', BROWSER_GONE_DETAIL), links: [] }
  if (err instanceof PageTooLargeError) return { page: pageWithoutContent(url, 'error', err.message), links: [] }

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

/** Keeps a list of every url the main frame asks for, including ones the page starts itself. */
function trackMainFrameNavigations(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    if (isMainFrameNavigation(request)) urls.push(request.url())
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

async function takeScreenshot(page: Page, timeoutMs: number): Promise<Buffer | null> {
  try {
    return await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, fullPage: true, timeout: timeoutMs })
  } catch (err) {
    // Evidence text is still usable without a picture of it.
    logCaptureFailure('Could not take the screenshot', page.url(), err)
    return null
  }
}

async function loadPage(page: Page, entry: QueueEntry, guard: UrlGuard, navigations: string[], run: CaptureRun): Promise<Visit> {
  const timeoutMs = run.limits.pageTimeoutMs
  const navigation = await gotoGuarded(page, entry.url, guard, timeoutMs)
  if (navigation.blockedReason !== null) {
    const refusal = await findRefusal(navigations, guard, run.violations)
    return discardedVisit(entry.url, refusal ?? navigation.blockedReason)
  }

  // First, because the read changes the page, and half the time at most, because the text matters more.
  const screenshot = await takeScreenshot(page, Math.ceil(timeoutMs / 2))
  // A read has no timeout of its own, and a hostile page can keep the renderer busy forever.
  const content = await withinTimeout(readPageContent(page, timeoutMs), timeoutMs, 'Reading the page')

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
    await withinTimeout(page.close(), BROWSER_CLOSE_TIMEOUT_MS, 'Closing the page')
  } catch (err) {
    // Already closed with its context is the state wanted. Anything else is for the log.
    if (!isClosedError(err)) logCaptureFailure('Could not close the page', page.url(), err)
  }
}

async function visitPage(entry: QueueEntry, run: CaptureRun): Promise<Visit> {
  const guard = navigationGuard(entry, run)
  const verdict = await guard.check(entry.url)
  if (!verdict.allowed) return discardedVisit(entry.url, verdict.reason)

  let page: Page | null = null
  try {
    page = await run.context.newPage()
    page.on('popup', (popup) => void closeQuietly(popup))
    const navigations = trackMainFrameNavigations(page)
    try {
      return await loadPage(page, entry, guard, navigations, run)
    } catch (err) {
      // A navigation the guard refused can surface as a failed load. It is still a refusal.
      const refusal = await findRefusal(navigations, guard, run.violations)
      if (refusal !== null) return discardedVisit(entry.url, refusal)
      return failedVisit(entry.url, err, run)
    }
  } catch (err) {
    return failedVisit(entry.url, err, run)
  } finally {
    if (page) await closeQuietly(page)
  }
}

/** Nothing else stops a browser call that never answers, as on a connection that has gone silent. */
function visitWithinDeadline(entry: QueueEntry, run: CaptureRun): Promise<Visit | null> {
  const deadlineMs = run.limits.pageTimeoutMs * VISIT_DEADLINE_PAGE_TIMEOUTS + BROWSER_CLOSE_TIMEOUT_MS
  const visit = withinTimeout(visitPage(entry, run), deadlineMs, 'The visit').catch((err: unknown) => {
    logCaptureFailure('Gave up on the page', entry.url, err)
    return { page: pageWithoutContent(entry.url, 'timeout', OUT_OF_TIME_DETAIL), links: [] }
  })
  return Promise.race([visit, run.aborted])
}

function isBinaryFile(url: string): boolean {
  return BINARY_FILE_PATTERN.test(new URL(url).pathname)
}

function linksToFollow(links: string[], from: QueueEntry): QueueEntry[] {
  return links
    .filter((link) => isHttpUrl(link) && isSameSite(link, from.siteHost) && !isBinaryFile(link))
    .map((link) => ({ url: withoutFragment(link), depth: from.depth + 1, siteHost: from.siteHost }))
}

/** Reports pages that will not be visited, because there is no browser to visit them with. */
async function reportUnavailable(entries: QueueEntry[], opts: CaptureOptions, aborted: Promise<null>): Promise<void> {
  for (const entry of entries) {
    const page = pageWithoutContent(entry.url, 'error', BROWSER_GONE_DETAIL)
    const reported = await Promise.race([opts.onPage(page).then(() => true), aborted])
    if (reported === null) return
  }
}

function startEntries(startUrls: string[]): QueueEntry[] {
  return startUrls.map((url) => ({ url: withoutFragment(url), depth: 0, siteHost: siteHostOf(url) }))
}

/** Breadth first, so that every start url is captured before any link uses up the page limit. */
async function crawl(opts: CaptureOptions, run: CaptureRun): Promise<void> {
  const { signal, onPage } = opts
  const seen = new Set<string>()
  const queue: QueueEntry[] = []
  const enqueue = (entry: QueueEntry) => {
    if (seen.has(entry.url)) return
    seen.add(entry.url)
    queue.push(entry)
  }
  startEntries(opts.startUrls).forEach(enqueue)

  for (let next = 0; next < queue.length && next < run.limits.maxPages; next += 1) {
    if (signal.aborted) return
    const entry = queue[next]
    const visit = await visitWithinDeadline(entry, run)
    if (visit === null || signal.aborted) return

    const reported = await Promise.race([onPage(visit.page).then(() => true), run.aborted])
    if (reported === null) return

    if (!run.browser.isConnected()) {
      logCaptureFailure('The browser disconnected during the capture', entry.url, 'No more pages can be visited.')
      await reportUnavailable(queue.slice(next + 1, run.limits.maxPages), opts, run.aborted)
      return
    }
    if (entry.depth < run.limits.maxDepth) linksToFollow(visit.links, entry).forEach(enqueue)
  }
}

/** Null when there is no context to work with: the signal aborted, or the browser did not answer. */
async function openContext(opts: CaptureOptions, timeoutMs: number, aborted: Promise<null>): Promise<GuardedContext | null> {
  const opening = createGuardedContext(opts.browser, opts.guard)
  try {
    const opened = await withinTimeout(Promise.race([opening, aborted]), timeoutMs, 'Opening a browser context')
    if (opened !== null) return opened
  } catch (err) {
    logCaptureFailure('Could not open a browser context', opts.startUrls[0] ?? 'no start url', err)
  }
  // It may still arrive, and nobody else would close it.
  void opening.then(({ context }) => context.close()).catch(() => undefined)
  return null
}

/**
 * Visits the start urls and their same-site links in one browser context, reporting each page
 * through onPage. A page that fails is reported with its status and the run carries on. If the
 * browser dies or will not answer, the pages left are reported as errors and this still resolves.
 * Rejects only if onPage does. Soon after the signal aborts it resolves, without reporting the
 * page in progress, whatever state the browser is in and however long onPage is taking.
 */
export async function capturePages(opts: CaptureOptions): Promise<void> {
  const { signal } = opts
  if (signal.aborted) return

  const aborted = new Promise<null>((resolve) => {
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })
  const limits = { ...DEFAULT_CAPTURE_LIMITS, ...opts.limits }
  const opened = await openContext(opts, limits.pageTimeoutMs, aborted)
  if (opened === null) {
    if (!signal.aborted) await reportUnavailable(startEntries(opts.startUrls).slice(0, limits.maxPages), opts, aborted)
    return
  }

  const { context, violations } = opened
  const run: CaptureRun = {
    browser: opts.browser,
    guard: opts.guard,
    limits,
    context,
    violations,
    robots: opts.respectRobots ? createRobotsChecker(opts.guard) : null,
    signal,
    aborted,
  }

  const logUrl = opts.startUrls[0] ?? 'no start url'
  let closing: Promise<void> | null = null
  const closeContext = (): Promise<void> => {
    closing ??= context.close().catch((err: unknown) => {
      if (!isClosedError(err)) logCaptureFailure('Could not close the browser context', logUrl, err)
    })
    return closing
  }
  // Closing the context is what makes anything in flight in the browser give up at once.
  signal.addEventListener('abort', closeContext, { once: true })
  try {
    await crawl(opts, run)
  } finally {
    signal.removeEventListener('abort', closeContext)
    await withinTimeout(closeContext(), BROWSER_CLOSE_TIMEOUT_MS, 'Closing the browser context').catch((err: unknown) => {
      logCaptureFailure('Gave up closing the browser context', logUrl, err)
    })
  }
}

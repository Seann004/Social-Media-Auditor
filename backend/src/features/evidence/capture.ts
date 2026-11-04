import { createHash } from 'node:crypto'
import type { Browser, BrowserContext, Page } from 'playwright'
import { classifyAccess } from './access.js'
import {
  gotoGuarded,
  isClosedError,
  isMainFrameNavigation,
  isTimeoutError,
  openRunContext,
  PageTooLargeError,
  watchAbort,
  withinTimeout,
  withinTimeoutOrAbort,
  withoutFragment,
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
  /** The run's own checker, so that robots.txt is read once per site for the whole run. Made here if not given. */
  robots?: RobotsChecker
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
 * What may be navigated to: the URL guard, then the site scope (null for no scope, as for a start
 * url, which may redirect anywhere), then robots.txt. Applied to every redirect hop by
 * gotoGuarded, so a refused hop is never requested.
 */
function scopedGuard(guard: UrlGuard, robots: RobotsChecker | null, scope: { siteHost: string | null } | null): UrlGuard {
  return {
    async check(url: string): Promise<UrlCheckResult> {
      const verdict = await guard.check(url)
      if (!verdict.allowed) return refuse(`The URL guard refused this address: ${verdict.reason}`)
      if (scope !== null && !isSameSite(url, scope.siteHost)) return refuse(LEFT_SITE_DETAIL)
      if (!robots) return { allowed: true }
      const rules = await robots.isAllowed(url)
      return rules.allowed ? { allowed: true } : refuse(rules.reason ?? ROBOTS_DISALLOWED_REASON)
    },
  }
}

function navigationGuard(entry: QueueEntry, run: CaptureRun): UrlGuard {
  return scopedGuard(run.guard, run.robots, entry.depth > 0 ? { siteHost: entry.siteHost } : null)
}

/**
 * The guard for revisiting a captured page to highlight a quote on it: the rules of a followed
 * link, with the page's own site as the scope. Pass the run's robots checker, or null when the
 * Head Auditor recorded permission.
 */
export function highlightGuard(pageUrl: string, guard: UrlGuard, robots: RobotsChecker | null): UrlGuard {
  return scopedGuard(guard, robots, { siteHost: siteHostOf(pageUrl) })
}

interface MainFrameHistory {
  /** Every url the main frame asked for, including ones the page started itself. */
  urls: string[]
  /** Every document the main frame was answered with, in order. */
  responses: { url: string; status: number }[]
}

function trackMainFrame(page: Page): MainFrameHistory {
  const history: MainFrameHistory = { urls: [], responses: [] }
  page.on('request', (request) => {
    if (isMainFrameNavigation(request)) history.urls.push(request.url())
  })
  page.on('response', (response) => {
    if (isMainFrameNavigation(response.request())) history.responses.push({ url: response.url(), status: response.status() })
  })
  return history
}

/** The document at finalUrl, or the latest one if the url changed with no new document, as pushState does. */
function statusOfDocument(history: MainFrameHistory, finalUrl: string): number | null {
  const current = withoutFragment(finalUrl)
  const latestFirst = [...history.responses].reverse()
  const document = latestFirst.find((response) => withoutFragment(response.url) === current) ?? latestFirst[0]
  return document?.status ?? null
}

async function findRefusal(urls: string[], guard: UrlGuard, violations: string[]): Promise<string | null> {
  for (const url of urls) {
    if (violations.includes(url)) return REFUSED_NAVIGATION_DETAIL
    const verdict = await guard.check(url)
    if (!verdict.allowed) return verdict.reason
  }
  return null
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

async function loadPage(page: Page, entry: QueueEntry, guard: UrlGuard, history: MainFrameHistory, run: CaptureRun): Promise<Visit> {
  const timeoutMs = run.limits.pageTimeoutMs
  const navigation = await gotoGuarded(page, entry.url, guard, timeoutMs)
  if (navigation.blockedReason !== null) {
    const refusal = await findRefusal(history.urls, guard, run.violations)
    return discardedVisit(entry.url, refusal ?? navigation.blockedReason)
  }

  // First, because the read changes the page, and half the time at most, because the text matters more.
  const screenshot = await takeScreenshot(page, Math.ceil(timeoutMs / 2))
  // A read has no timeout of its own, and a hostile page can keep the renderer busy forever.
  const content = await withinTimeout(readPageContent(page, timeoutMs), timeoutMs, 'Reading the page')

  // Last, so that it also covers anything the page did while it was being read.
  const finalUrl = page.url()
  const refusal = await findRefusal([...history.urls, finalUrl], guard, run.violations)
  if (refusal !== null) return discardedVisit(entry.url, refusal)

  const httpStatus = statusOfDocument(history, finalUrl)
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
    const history = trackMainFrame(page)
    try {
      return await loadPage(page, entry, guard, history, run)
    } catch (err) {
      // A navigation the guard refused can surface as a failed load. It is still a refusal.
      const refusal = await findRefusal(history.urls, guard, run.violations)
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
  return withinTimeoutOrAbort(visitPage(entry, run), deadlineMs, 'The visit', run.aborted).catch((err: unknown) => {
    logCaptureFailure('Gave up on the page', entry.url, err)
    return { page: pageWithoutContent(entry.url, 'timeout', OUT_OF_TIME_DETAIL), links: [] }
  })
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

  const watch = watchAbort(signal)
  const { aborted } = watch
  try {
    const limits = { ...DEFAULT_CAPTURE_LIMITS, ...opts.limits }
    const opened = await openRunContext({
      browser: opts.browser,
      guard: opts.guard,
      signal,
      aborted,
      timeoutMs: limits.pageTimeoutMs,
      logUrl: opts.startUrls[0] ?? 'no start url',
    })
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
      robots: opts.respectRobots ? (opts.robots ?? createRobotsChecker(opts.guard)) : null,
      signal,
      aborted,
    }
    try {
      await crawl(opts, run)
    } finally {
      await opened.end()
    }
  } finally {
    watch.stop()
  }
}

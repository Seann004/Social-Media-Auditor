import { setDefaultResultOrder } from 'node:dns'
import {
  chromium,
  errors,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type Route,
} from 'playwright'
import { logCaptureFailure } from './captureLog.js'
import {
  APP_REDIRECT_ARRIVAL_MS,
  BROWSER_CLOSE_TIMEOUT_MS,
  MAX_REDIRECT_HOPS,
  MAX_RESPONSE_BYTES,
  NETWORK_IDLE_WAIT_MS,
  PAGE_TIMEOUT_MS,
  USER_AGENT,
} from './config.js'
import type { UrlGuard } from './urlGuard.js'

// Playwright's Node-side requests wait 5 s on an address family before trying the next, which
// on a network with broken IPv6 would use up most of a page's time on every request.
setDefaultResultOrder('ipv4first')

/**
 * Every http(s) request a page makes is carried out from Node by the route handler below,
 * after the guard has seen it, so Chromium itself never needs the network. These flags take
 * the network away from it. That closes what route interception cannot see, which was shown
 * to reach an internal address otherwise: WebSockets, speculation-rules prefetch and prerender,
 * and WebRTC STUN packets. A browser reached through BROWSER_WS_ENDPOINT was started by someone
 * else, so these flags are not ours to set: if it shares a network with anything internal,
 * start it with them.
 */
export const LOCKED_DOWN_BROWSER_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
]

/** What a browser sends for a typed url, so that a server answers the walk as it would answer a person. */
const NAVIGATION_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'upgrade-insecure-requests': '1',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
}

let sharedBrowser: Promise<Browser> | null = null

function openBrowser(): Promise<Browser> {
  const endpoint = process.env.BROWSER_WS_ENDPOINT
  return endpoint ? chromium.connectOverCDP(endpoint) : chromium.launch({ args: LOCKED_DOWN_BROWSER_ARGS })
}

/** The shared browser. Reopened on the next call after a disconnect or a failed start. */
export function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser

  const forget = () => {
    if (sharedBrowser === opening) sharedBrowser = null
  }
  const opening: Promise<Browser> = openBrowser().then((browser) => {
    browser.on('disconnected', forget)
    return browser
  })
  opening.catch(forget)
  sharedBrowser = opening
  return opening
}

export async function closeBrowser(): Promise<void> {
  const current = sharedBrowser
  sharedBrowser = null
  // A failed start has already been reported to whoever asked for the browser.
  const browser = await current?.catch(() => null)
  await browser?.close()
}

/** True for Playwright's own timeouts, and for a navigation whose request timed out in the route handler. */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof errors.TimeoutError) return true
  return err instanceof Error && /net::ERR_(CONNECTION_)?TIMED_OUT/.test(err.message)
}

/** True when an operation failed only because its page, context or browser was closed meanwhile. */
export function isClosedError(err: unknown): boolean {
  return err instanceof Error && /has been closed|context disposed/i.test(err.message)
}

export class PageTooLargeError extends Error {
  constructor() {
    super(`The page is larger than the ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB capture limit.`)
    this.name = 'PageTooLargeError'
  }
}

export function withoutFragment(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href
  } catch {
    // The guard refuses a url it cannot parse.
    return url
  }
}

/** Schemes that load nothing from a network, so the guard has nothing to say about them. */
function isLocalScheme(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:')
}

export function isMainFrameNavigation(request: Request): boolean {
  if (!request.isNavigationRequest()) return false
  try {
    return request.frame().parentFrame() === null
  } catch {
    // Playwright throws when the frame is not known yet, as for a popup's first request. Count it.
    return true
  }
}

/**
 * Decoded size, read before the response goes to Chromium: a body of about 100 MB overflows the
 * DevTools pipe and kills the browser connection. By now Node has already read the whole body, so
 * a huge or hostile compressed response can still spike Node's memory. That is accepted (ruling
 * R14): reading it as a stream would need another HTTP client, which would lose the cookie jar.
 */
async function isOversized(response: APIResponse): Promise<boolean> {
  return (await response.body()).length > MAX_RESPONSE_BYTES
}

type RedirectWalk =
  | {
      /** The url of the response. */
      finalUrl: string
      /** Every url visited. */
      chain: string[]
      response: APIResponse
      blockedReason: null
    }
  | {
      /** The last url the guard allowed. */
      finalUrl: string
      /** Every url visited, including the one refused. */
      chain: string[]
      response: null
      blockedReason: string
    }

function redirectTarget(response: APIResponse, from: string): string | null {
  const location = response.headers()['location']
  if (response.status() < 300 || response.status() >= 400 || !location) return null
  try {
    return new URL(location, from).href
  } catch {
    // The guard refuses a url it cannot parse.
    return location
  }
}

/** Follows up to maxHops redirects one at a time, asking the guard before each request. */
async function walkRedirects(
  startUrl: string,
  guard: UrlGuard,
  maxHops: number,
  fetchHop: (url: string, hop: number) => Promise<APIResponse>,
): Promise<RedirectWalk> {
  const chain: string[] = []
  let current = startUrl
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const verdict = await guard.check(current)
    const lastAllowed = chain.at(-1) ?? current
    chain.push(current)
    if (!verdict.allowed) return { finalUrl: lastAllowed, response: null, chain, blockedReason: verdict.reason }

    const response = await fetchHop(current, hop)
    const next = redirectTarget(response, current)
    if (next === null) return { finalUrl: current, response, chain, blockedReason: null }
    await response.dispose()
    current = next
  }
  return {
    finalUrl: chain.at(-1) ?? startUrl,
    response: null,
    chain,
    blockedReason: `The page redirects more than ${maxHops} times.`,
  }
}

function recordViolations(violations: string[], urls: string[]): void {
  violations.push(...urls.filter((url) => !violations.includes(url)))
}

/**
 * Carries out a request from Node, walking any redirects itself. The browser is only ever
 * handed a final response. Fulfilling with the 302 instead would not work: the browser follows
 * it without calling any route handler, so a second hop would go unchecked.
 *
 * A sub-resource or sub-frame gets the final body under the url it asked for, which is harmless.
 * A main frame would then name the wrong source as its evidence, and resolve its links wrongly.
 * gotoGuarded's navigation never gets here, so this is a navigation the page started itself,
 * and if it redirects it is refused, with the redirect target never requested. In app mode it is
 * followed instead, by followNavigation.
 */
async function carryOutRequest(route: Route, setup: RouteSetup): Promise<void> {
  const { context, guard, violations } = setup
  const request = route.request()
  const mainFrame = isMainFrameNavigation(request)
  if (mainFrame && setup.followPageRedirects) {
    await followNavigation(route, setup)
    return
  }
  const maxHops = mainFrame ? 0 : MAX_REDIRECT_HOPS
  const walk = await walkRedirects(request.url(), guard, maxHops, (url, hop) =>
    hop === 0
      ? route.fetch({ maxRedirects: 0, timeout: PAGE_TIMEOUT_MS })
      : context.request.get(url, { maxRedirects: 0, timeout: PAGE_TIMEOUT_MS }),
  )
  if (walk.response === null) {
    recordViolations(violations, walk.chain)
    await route.abort('blockedbyclient')
    return
  }
  if (await isOversized(walk.response)) {
    await walk.response.dispose()
    logCaptureFailure('Refused an oversized response', request.url(), new PageTooLargeError())
    await route.abort('failed')
    return
  }
  await route.fulfill({ response: walk.response })
  await walk.response.dispose()
}

/** What the context's route handler works with. */
interface RouteSetup {
  context: BrowserContext
  guard: UrlGuard
  violations: string[]
  followPageRedirects: boolean
  arrivalTtlMs: number
  /**
   * In app mode: the final response of a followed redirect, held for the one GET navigation the
   * page is sent on to it, until it expires. Keyed by the exact url, fragment aside.
   */
  arrivals: Map<string, Arrival>
}

interface Arrival {
  page: Page | null
  response: APIResponse
  expiresAt: number
}

/** Drops every held response that has waited too long. */
async function dropExpiredArrivals(setup: RouteSetup): Promise<void> {
  const now = Date.now()
  for (const [url, arrival] of [...setup.arrivals]) {
    if (arrival.expiresAt > now) continue
    setup.arrivals.delete(url)
    await arrival.response.dispose().catch(() => undefined)
  }
}

/** The held response for this navigation, taken out so that it is served once. Never for a POST or another page. */
function takeArrival(setup: RouteSetup, request: Request, page: Page | null): APIResponse | null {
  if (request.method() !== 'GET') return null
  const url = withoutFragment(request.url())
  const arrival = setup.arrivals.get(url)
  if (!arrival || arrival.page !== page) return null
  setup.arrivals.delete(url)
  return arrival.response
}

function pageOf(request: Request): Page | null {
  try {
    return request.frame().page()
  } catch {
    // Not known yet, as for a popup's first request.
    return null
  }
}

/** Allows only what both allow. The first refusal is the reason given. */
function bothGuards(first: UrlGuard, second: UrlGuard): UrlGuard {
  if (second === first) return first
  return {
    async check(url) {
      const verdict = await first.check(url)
      return verdict.allowed ? second.check(url) : verdict
    },
  }
}

function escapeAttribute(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

/** Sends the browser on to where the redirects ended. A refresh with no delay replaces the history entry. */
function movedOnDocument(finalUrl: string): string {
  return `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${escapeAttribute(finalUrl)}"></head><body></body></html>`
}

/**
 * App mode (ruling A3): a navigation the page starts itself may redirect, as a sign-in POST answered
 * with a 302 or an SSO chain does. Each hop, up to MAX_REDIRECT_HOPS, is fetched from Node only
 * after the page's navigation guard and the context's guard both allow it. The browser cannot be
 * handed the 302 (it would follow it unrouted), so it is given a page that sends it on to the
 * final address, and that navigation is served the response already fetched, so the server is
 * asked once per hop. A later hop of a 307 or 308 is fetched as a GET: an accepted limit.
 */
async function followNavigation(route: Route, setup: RouteSetup): Promise<void> {
  const request = route.request()
  const page = pageOf(request)
  await dropExpiredArrivals(setup)
  const held = takeArrival(setup, request, page)
  if (held) {
    await route.fulfill({ response: held })
    await held.dispose()
    return
  }
  const navigationGuard = (page && gates.get(page)?.guard) || setup.guard
  const walk = await walkRedirects(request.url(), bothGuards(navigationGuard, setup.guard), MAX_REDIRECT_HOPS, (hopUrl, hop) =>
    hop === 0
      ? route.fetch({ maxRedirects: 0, timeout: PAGE_TIMEOUT_MS })
      : setup.context.request.get(hopUrl, { maxRedirects: 0, timeout: PAGE_TIMEOUT_MS, headers: NAVIGATION_HEADERS }),
  )
  if (walk.response === null) {
    recordViolations(setup.violations, walk.chain)
    await route.abort('blockedbyclient')
    return
  }
  if (await isOversized(walk.response)) {
    await walk.response.dispose()
    logCaptureFailure('Refused an oversized response', request.url(), new PageTooLargeError())
    await route.abort('failed')
    return
  }
  if (walk.chain.length === 1) {
    await route.fulfill({ response: walk.response })
    await walk.response.dispose()
    return
  }
  const finalUrl = withoutFragment(walk.finalUrl)
  await setup.arrivals.get(finalUrl)?.response.dispose()
  setup.arrivals.set(finalUrl, { page, response: walk.response, expiresAt: Date.now() + setup.arrivalTtlMs })
  await route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    headers: { 'cache-control': 'no-store' },
    body: movedOnDocument(walk.finalUrl),
  })
}

function guardRoute(setup: RouteSetup) {
  return async (route: Route): Promise<void> => {
    const request = route.request()
    try {
      if (request.resourceType() === 'media') await route.abort('aborted')
      else if (isLocalScheme(request.url())) await route.continue()
      else await carryOutRequest(route, setup)
    } catch (err) {
      // A page close ends up here too, and then the abort fails as well, which is harmless.
      if (!isClosedError(err)) logCaptureFailure('A request failed', request.url(), err)
      await route.abort(isTimeoutError(err) ? 'timedout' : 'failed').catch(() => undefined)
    }
  }
}

export interface GuardedContext {
  context: BrowserContext
  /**
   * Urls the guard refused, any url whose redirects led to one, and any url a page
   * navigated itself to that redirected.
   */
  violations: string[]
}

export interface GuardedContextOptions {
  /**
   * App mode: follow the redirects of navigations the page starts itself, each hop checked, as
   * using an app needs. Off for a capture, which refuses them (Phase 1).
   */
  followPageRedirects?: boolean
  /** For tests. How long a followed redirect's final response waits for its navigation. */
  arrivalTtlMs?: number
}

/**
 * A browser context in which every request goes through the guard. Only use the context
 * with a browser from getBrowser, or one given LOCKED_DOWN_BROWSER_ARGS. The caller closes it.
 */
export async function createGuardedContext(browser: Browser, guard: UrlGuard, opts: GuardedContextOptions = {}): Promise<GuardedContext> {
  const context = await browser.newContext({ serviceWorkers: 'block', userAgent: USER_AGENT, acceptDownloads: false })
  const violations: string[] = []

  // Detection backstop: sees every request the browser makes, redirect hops included.
  context.on('request', (request) => {
    const url = request.url()
    if (isLocalScheme(url)) return
    void guard.check(url).then(
      (verdict) => {
        if (!verdict.allowed) recordViolations(violations, [url])
      },
      () => recordViolations(violations, [url]),
    )
  })

  const setup: RouteSetup = {
    context,
    guard,
    violations,
    followPageRedirects: opts.followPageRedirects ?? false,
    arrivalTtlMs: opts.arrivalTtlMs ?? APP_REDIRECT_ARRIVAL_MS,
    arrivals: new Map(),
  }
  await context.route('**/*', guardRoute(setup))
  return { context, violations }
}

/** What gotoGuarded has set up on a page. It stays in force for as long as the page is open. */
interface NavigationGate {
  guard: UrlGuard
  /** The response already fetched for the navigation about to happen. */
  pending: { url: string; response: APIResponse } | null
}

const gates = new WeakMap<Page, NavigationGate>()

/**
 * Runs before the context's route handler, for the main frame only. Serves gotoGuarded's
 * navigation from the walk's response, so the document is fetched once and the server gets no
 * second chance to answer differently. Holds any navigation the page starts itself to the guard
 * gotoGuarded was given, which can be stricter than the context's.
 */
async function passThroughGate(route: Route, gate: NavigationGate): Promise<void> {
  const request = route.request()
  try {
    if (!isMainFrameNavigation(request)) {
      await route.fallback()
      return
    }
    const pending = gate.pending
    if (pending && pending.url === withoutFragment(request.url())) {
      gate.pending = null
      await route.fulfill({ response: pending.response })
      await pending.response.dispose()
      return
    }
    const verdict = await gate.guard.check(request.url())
    if (verdict.allowed) await route.fallback()
    else await route.abort('blockedbyclient')
  } catch (err) {
    if (!isClosedError(err)) logCaptureFailure('A navigation failed', request.url(), err)
    await route.abort('failed').catch(() => undefined)
  }
}

async function gateFor(page: Page, guard: UrlGuard): Promise<NavigationGate> {
  const existing = gates.get(page)
  if (existing) {
    existing.guard = guard
    return existing
  }
  const gate: NavigationGate = { guard, pending: null }
  gates.set(page, gate)
  await page.route(
    () => true,
    (route) => passThroughGate(route, gate),
  )
  return gate
}

/** Waits for the network to go quiet, for at most the smaller of the two limits. A busy page is not an error. */
export async function waitForNetworkIdle(page: Page, timeoutMs: number, maxWaitMs = NETWORK_IDLE_WAIT_MS): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, maxWaitMs) })
  } catch (err) {
    // Busy pages never go idle. What has loaded by now is what gets captured.
    if (!(err instanceof errors.TimeoutError)) throw err
  }
}

async function refusalInRedirectChain(response: Response | null, guard: UrlGuard): Promise<string | null> {
  for (let request = response?.request() ?? null; request; request = request.redirectedFrom()) {
    const verdict = await guard.check(request.url())
    if (!verdict.allowed) return verdict.reason
  }
  return null
}

export interface GuardedNavigation {
  /** Null when blocked. */
  response: Response | null
  /** Where the page ended up. When blocked, the last url the guard allowed, never the refused one. */
  finalUrl: string
  /** When set, the page's content must not be used. */
  blockedReason: string | null
}

/**
 * Walks the redirects from Node, checking every hop, because the browser does not call route
 * handlers for redirect hops. Then navigates to the final url, served from the response the walk
 * already has. Use with a page from createGuardedContext. Throws if the page cannot be loaded for
 * a reason other than the guard, including PageTooLargeError.
 */
export async function gotoGuarded(page: Page, url: string, guard: UrlGuard, timeoutMs: number): Promise<GuardedNavigation> {
  const deadline = Date.now() + timeoutMs
  // Never 0, which would tell Playwright to wait forever.
  const remaining = () => Math.max(1, deadline - Date.now())

  const gate = await gateFor(page, guard)
  const request = page.context().request
  const walk = await walkRedirects(withoutFragment(url), guard, MAX_REDIRECT_HOPS, (hopUrl) =>
    request.get(hopUrl, { maxRedirects: 0, timeout: remaining(), headers: NAVIGATION_HEADERS }),
  )
  const blocked = (blockedReason: string): GuardedNavigation => ({ response: null, finalUrl: walk.finalUrl, blockedReason })
  if (walk.response === null) return blocked(walk.blockedReason)
  if (await isOversized(walk.response)) {
    await walk.response.dispose()
    throw new PageTooLargeError()
  }

  gate.pending = { url: withoutFragment(walk.finalUrl), response: walk.response }
  let response: Response | null
  try {
    response = await page.goto(walk.finalUrl, { waitUntil: 'domcontentloaded', timeout: remaining() })
  } catch (err) {
    if (err instanceof Error && err.message.includes('ERR_BLOCKED_BY_CLIENT')) {
      return blocked('The page tried to move to an address that is not allowed.')
    }
    throw err
  } finally {
    const unused = gate.pending
    gate.pending = null
    await unused?.response.dispose().catch(() => undefined)
  }
  await waitForNetworkIdle(page, timeoutMs)

  const chainRefusal = await refusalInRedirectChain(response, guard)
  if (chainRefusal !== null) return blocked(chainRefusal)
  const finalUrl = page.url()
  // What Chromium shows after a navigation fails. The page's content is gone.
  if (finalUrl.startsWith('chrome-error:')) return blocked('The page moved itself to an address that could not be opened.')
  const finalVerdict = await guard.check(finalUrl)
  if (!finalVerdict.allowed) return blocked(finalVerdict.reason)
  return { response, finalUrl, blockedReason: null }
}

export function withinTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new errors.TimeoutError(`${what} timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

/**
 * Like withinTimeout, and also ends when `aborted` resolves, with null. Both settle the timer, so
 * nothing is left running when the work never answers, as on a connection that has gone silent.
 */
export function withinTimeoutOrAbort<T>(work: Promise<T>, timeoutMs: number, what: string, aborted: Promise<null>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new errors.TimeoutError(`${what} timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([work, expired, aborted]).finally(() => clearTimeout(timer))
}

export interface AbortWatch {
  /** Resolves with null when the signal aborts, so that any wait can be raced against it. */
  aborted: Promise<null>
  /** Takes the listener off the signal. Call it when the run is over: a signal can outlive many runs. */
  stop(): void
}

export function watchAbort(signal: AbortSignal): AbortWatch {
  let onAbort: () => void = () => undefined
  const aborted = new Promise<null>((resolve) => {
    onAbort = () => resolve(null)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return { aborted, stop: () => signal.removeEventListener('abort', onAbort) }
}

export interface RunContext extends GuardedContext {
  /** Takes the abort listener off and closes the context, within BROWSER_CLOSE_TIMEOUT_MS. Never rejects. */
  end(): Promise<void>
}

export interface RunContextOptions {
  browser: Browser
  guard: UrlGuard
  signal: AbortSignal
  aborted: Promise<null>
  timeoutMs: number
  /** For the log. */
  logUrl: string
  /** App mode, as in GuardedContextOptions. */
  followPageRedirects?: boolean
}

/**
 * A guarded context for one run, or null when there is none to work with: the signal aborted, or
 * the browser did not answer in time. A context that arrives late is closed. Aborting the signal
 * closes it at once, which makes anything in flight in the browser give up. Call end() when done.
 */
export async function openRunContext(opts: RunContextOptions): Promise<RunContext | null> {
  const { signal, logUrl } = opts
  const opening = createGuardedContext(opts.browser, opts.guard, { followPageRedirects: opts.followPageRedirects })
  try {
    const opened = await withinTimeoutOrAbort(opening, opts.timeoutMs, 'Opening a browser context', opts.aborted)
    if (opened !== null) return withEnd(opened, signal, logUrl)
  } catch (err) {
    if (!signal.aborted) logCaptureFailure('Could not open a browser context', logUrl, err)
  }
  // It may still arrive, and nobody else would close it.
  void opening.then(({ context }) => context.close()).catch(() => undefined)
  return null
}

function withEnd(opened: GuardedContext, signal: AbortSignal, logUrl: string): RunContext {
  let closing: Promise<void> | null = null
  const close = (): Promise<void> => {
    closing ??= opened.context.close().catch((err: unknown) => {
      if (!signal.aborted && !isClosedError(err)) logCaptureFailure('Could not close the browser context', logUrl, err)
    })
    return closing
  }
  signal.addEventListener('abort', close, { once: true })
  return {
    ...opened,
    async end() {
      signal.removeEventListener('abort', close)
      await withinTimeout(close(), BROWSER_CLOSE_TIMEOUT_MS, 'Closing the browser context').catch((err: unknown) => {
        // On an aborted run the caller has stopped caring, and a close that cannot answer is expected.
        if (!signal.aborted) logCaptureFailure('Gave up closing the browser context', logUrl, err)
      })
    },
  }
}

import {
  chromium,
  errors,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  type Route,
} from 'playwright'
import { MAX_REDIRECT_HOPS, NETWORK_IDLE_WAIT_MS, PAGE_TIMEOUT_MS, USER_AGENT } from './config.js'
import type { UrlGuard } from './urlGuard.js'

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

/** Schemes that load nothing from a network, so the guard has nothing to say about them. */
function isLocalScheme(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:')
}

interface RedirectWalk {
  /** The last url the guard allowed. */
  finalUrl: string
  /** The response at finalUrl, when the walk reached one that is not a redirect. */
  response: APIResponse | null
  /** Every url visited, including the one refused. */
  chain: string[]
  blockedReason: string | null
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

/** Follows redirects one at a time, asking the guard before each request. */
async function walkRedirects(
  startUrl: string,
  guard: UrlGuard,
  fetchHop: (url: string, hop: number) => Promise<APIResponse>,
): Promise<RedirectWalk> {
  const chain: string[] = []
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
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
    blockedReason: `The page redirects more than ${MAX_REDIRECT_HOPS} times.`,
  }
}

function recordViolations(violations: string[], urls: string[]): void {
  violations.push(...urls.filter((url) => !violations.includes(url)))
}

/**
 * Carries out a request from Node, walking any redirects itself. The browser is only ever
 * handed a final response. Fulfilling with the 302 instead would not work: the browser follows
 * it without calling any route handler, so a second hop would go unchecked. Later hops are plain
 * GETs, and a redirected main frame shows the final body under the url it asked for.
 */
async function carryOutRequest(route: Route, context: BrowserContext, guard: UrlGuard, violations: string[]): Promise<void> {
  const walk = await walkRedirects(route.request().url(), guard, (url, hop) =>
    hop === 0
      ? route.fetch({ maxRedirects: 0, timeout: PAGE_TIMEOUT_MS })
      : context.request.get(url, { maxRedirects: 0, timeout: PAGE_TIMEOUT_MS }),
  )
  if (walk.response === null) {
    recordViolations(violations, walk.chain)
    await route.abort('blockedbyclient')
    return
  }
  await route.fulfill({ response: walk.response })
  await walk.response.dispose()
}

function guardRoute(context: BrowserContext, guard: UrlGuard, violations: string[]) {
  return async (route: Route): Promise<void> => {
    try {
      if (isLocalScheme(route.request().url())) await route.continue()
      else await carryOutRequest(route, context, guard, violations)
    } catch (err) {
      // A resource that fails is an ordinary part of loading a page. This also ends up here
      // when the page closes mid-request, and then the abort fails too, which is harmless.
      await route.abort(isTimeoutError(err) ? 'timedout' : 'failed').catch(() => undefined)
    }
  }
}

export interface GuardedContext {
  context: BrowserContext
  /** Urls the guard refused, and any url whose redirects led to one. */
  violations: string[]
}

/**
 * A browser context in which every request goes through the guard. Only use the context
 * with a browser from getBrowser, or one given LOCKED_DOWN_BROWSER_ARGS. The caller closes it.
 */
export async function createGuardedContext(browser: Browser, guard: UrlGuard): Promise<GuardedContext> {
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

  await context.route('**/*', guardRoute(context, guard, violations))
  return { context, violations }
}

export interface GuardedNavigation {
  /** Null when blocked. */
  response: Response | null
  /** Where the page ended up. When blocked, the last url the guard allowed, never the refused one. */
  finalUrl: string
  /** When set, the page's content must not be used. */
  blockedReason: string | null
}

async function waitForNetworkIdle(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, NETWORK_IDLE_WAIT_MS) })
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

/**
 * Navigates only after walking the redirects from Node, checking every hop, because the browser
 * does not call route handlers for redirect hops. The context's route handler covers the
 * navigation itself, in case the server answers differently the second time. Use with a page
 * from createGuardedContext. Throws if the page cannot be loaded, for a reason other than the guard.
 */
export async function gotoGuarded(page: Page, url: string, guard: UrlGuard, timeoutMs: number): Promise<GuardedNavigation> {
  const deadline = Date.now() + timeoutMs
  // Never 0, which would tell Playwright to wait forever.
  const remaining = () => Math.max(1, deadline - Date.now())

  const request = page.context().request
  const walk = await walkRedirects(url, guard, (hopUrl) => request.get(hopUrl, { maxRedirects: 0, timeout: remaining() }))
  await walk.response?.dispose()
  const blocked = (blockedReason: string): GuardedNavigation => ({ response: null, finalUrl: walk.finalUrl, blockedReason })
  if (walk.blockedReason !== null) return blocked(walk.blockedReason)

  let response: Response | null
  try {
    response = await page.goto(walk.finalUrl, { waitUntil: 'domcontentloaded', timeout: remaining() })
  } catch (err) {
    if (err instanceof Error && err.message.includes('ERR_BLOCKED_BY_CLIENT')) {
      return blocked('The page redirected to an address that is not allowed.')
    }
    throw err
  }
  await waitForNetworkIdle(page, remaining())

  const chainRefusal = await refusalInRedirectChain(response, guard)
  if (chainRefusal !== null) return blocked(chainRefusal)
  const finalUrl = page.url()
  const finalVerdict = await guard.check(finalUrl)
  if (!finalVerdict.allowed) return blocked(finalVerdict.reason)
  return { response, finalUrl, blockedReason: null }
}

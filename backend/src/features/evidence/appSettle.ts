/**
 * Waits for a page drawn by script to be steady before it is read. A web app such as Mastodon's loads
 * a blank document, then draws its menu, then fetches and draws the page itself; reading as soon as
 * the document has loaded gives the blank or half-drawn page. The page is steady once it has loaded,
 * shows some text, has not changed and has had no request in flight for a short quiet time. Never
 * throws and never waits longer than its limit: a page that is never steady is read as it is.
 */
import type { Page, Request } from 'playwright'
import { APP_STEADY_MAX_MS, APP_STEADY_POLL_MS, APP_STEADY_QUIET_MS } from './config.js'

/** Requests that stay open as long as the page does, so they never mean the page is still loading. */
const NEVER_FINISHING = new Set(['eventsource', 'websocket', 'media'])

export interface SteadyOptions {
  quietMs?: number
  maxMs?: number
  pollMs?: number
}

interface Look {
  /** Changes whenever what the page shows changes. */
  key: string
  /** Loaded, with some text shown. */
  shows: boolean
}

/** Counts the page's requests in flight, leaving out the ones that never finish. */
export function trackRequests(page: Page): () => number {
  let inFlight: ReadonlySet<Request> = new Set()
  const done = (request: Request): void => {
    if (inFlight.has(request)) inFlight = new Set([...inFlight].filter((other) => other !== request))
  }
  page.on('request', (request) => {
    if (!NEVER_FINISHING.has(request.resourceType())) inFlight = new Set([...inFlight, request])
  })
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return () => inFlight.size
}

/** A look at the page: how much text it shows and how many elements it has. Null while the document is being replaced. */
async function lookAt(page: Page): Promise<Look | null> {
  try {
    const shape = await page.evaluate(() => ({
      text: document.body ? document.body.innerText.trim().length : 0,
      elements: document.getElementsByTagName('*').length,
      ready: document.readyState,
    }))
    return { key: `${page.url()}|${shape.ready}|${shape.text}|${shape.elements}`, shows: shape.ready === 'complete' && shape.text > 0 }
  } catch {
    return null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits until the page is steady, or the limit runs out. Returns whether it became steady. */
export async function waitForSteadyPage(page: Page, inFlight: () => number, opts: SteadyOptions = {}): Promise<boolean> {
  const quietMs = opts.quietMs ?? APP_STEADY_QUIET_MS
  const pollMs = opts.pollMs ?? APP_STEADY_POLL_MS
  const deadline = Date.now() + (opts.maxMs ?? APP_STEADY_MAX_MS)
  let lastKey: string | null = null
  let quietSince = Date.now()
  while (Date.now() < deadline) {
    const look = await lookAt(page)
    const settled = look !== null && look.shows && inFlight() === 0 && look.key === lastKey
    if (!settled) quietSince = Date.now()
    else if (Date.now() - quietSince >= quietMs) return true
    lastKey = look?.key ?? null
    await sleep(pollMs)
  }
  return false
}

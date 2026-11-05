import type { Browser, BrowserContext, Page } from 'playwright'
import { z } from 'zod'
import { gotoGuarded, isMainFrameNavigation, openRunContext, watchAbort, withinTimeoutOrAbort } from './browser.js'
import { logCaptureFailure } from './captureLog.js'
import {
  BROWSER_CLOSE_TIMEOUT_MS,
  HIGHLIGHT_SHOT_RETRIES,
  JPEG_QUALITY,
  PAGE_TIMEOUT_MS,
  VISIT_DEADLINE_PAGE_TIMEOUTS,
} from './config.js'
import { HIGHLIGHT_SOURCE } from './highlightSource.js'
import { DECIDE_HIDDEN_SOURCE, openIsolatedWorld, type IsolatedWorld } from './pageRead.js'
import type { UrlGuard } from './urlGuard.js'

export interface HighlightOptions {
  browser: Browser
  /** For every request the page makes: the URL guard, as the capture's context had it. */
  guard: UrlGuard
  /** For the page itself and anything it navigates to: the rules of a followed link. */
  navigationGuard: UrlGuard
  pageUrl: string
  quotes: string[]
  signal: AbortSignal
  /** For tests. Defaults to the capture's page timeout. */
  pageTimeoutMs?: number
}

const HTTP_ERROR_STATUS = 400

const boxSchema = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
const placementSchema = z
  .object({
    /** In page coordinates, as Page.captureScreenshot wants it. */
    clip: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
    /** In viewport coordinates, as drawn. At least one, each with an area, each inside the clip. */
    boxes: z.array(boxSchema).min(1),
    scroll: z.object({ x: z.number(), y: z.number() }),
  })
  .nullable()
const screenshotSchema = z.object({ data: z.string() })

export type Placement = NonNullable<z.infer<typeof placementSchema>>

/** The visit ended because the page moved on or the run was aborted. Not a failure, and not logged. */
class VisitStopped extends Error {}

/** One entry per distinct quote, keeping the text as it was passed in. A blank quote has nothing to find. */
function distinctQuotes(quotes: string[]): string[] {
  return [...new Set(quotes)].filter((quote) => quote.trim() !== '')
}

/**
 * Opens an isolated world with the page's scripts off, decides what the visibility filter would
 * hide (without hiding it: evidence shows the page as it was), and installs the highlighter.
 */
export async function openHighlightWorld(page: Page): Promise<IsolatedWorld> {
  const world = await openIsolatedWorld(page, 'evidence-highlight')
  await world.evaluate(DECIDE_HIDDEN_SOURCE)
  await world.evaluate(HIGHLIGHT_SOURCE)
  return world
}

/**
 * Scrolls to the quote and draws its boxes, or returns null when it cannot be shown for what it is:
 * not found, hidden, clipped, covered, or off the screen. The boxes stay drawn until the next call.
 */
export async function locateQuote(world: IsolatedWorld, quote: string): Promise<Placement | null> {
  return placementSchema.parse(await world.evaluate(`globalThis.__evidenceHighlighter.show(${JSON.stringify(quote)})`))
}

/** True when nothing moved since the placement, so that a picture taken meanwhile is of what was placed. */
async function isStillPlaced(world: IsolatedWorld): Promise<boolean> {
  return (await world.evaluate('globalThis.__evidenceHighlighter.stillPlaced()')) === true
}

type Step = <T>(work: Promise<T>, what: string, timeoutMs: number) => Promise<T>

async function photograph(world: IsolatedWorld, placement: Placement, step: Step, timeoutMs: number): Promise<Buffer> {
  const shot = await step(
    world.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: JPEG_QUALITY, clip: { ...placement.clip, scale: 1 } }),
    'Taking the screenshot',
    timeoutMs,
  )
  return Buffer.from(screenshotSchema.parse(shot).data, 'base64')
}

/** Null when the quote is left out. A picture taken while the page moved is discarded and taken again. */
async function shootQuote(world: IsolatedWorld, quote: string, pageUrl: string, step: Step, timeoutMs: number): Promise<Buffer | null> {
  for (let attempt = 0; attempt <= HIGHLIGHT_SHOT_RETRIES; attempt += 1) {
    const placement = await step(locateQuote(world, quote), 'Placing the highlight', timeoutMs)
    if (placement === null) return null
    const image = await photograph(world, placement, step, timeoutMs)
    if (await step(isStillPlaced(world), 'Checking the highlight', timeoutMs)) return image
  }
  logCaptureFailure('Left a quote out of the close-ups', pageUrl, 'The page kept moving while its picture was taken.')
  return null
}

/** Resolves with null when the page starts a new document of its own after it was loaded. */
function watchForMove(page: Page): Promise<null> {
  return new Promise<null>((resolve) => {
    page.on('request', (request) => {
      if (isMainFrameNavigation(request)) resolve(null)
    })
  })
}

/** Fills results as it goes, so that whatever was finished survives a failure or an abort. */
async function visit(
  context: BrowserContext,
  opts: HighlightOptions,
  quotes: string[],
  timeoutMs: number,
  aborted: Promise<null>,
  results: Map<string, Buffer>,
): Promise<void> {
  const page = await context.newPage()
  page.on('popup', (popup) => void popup.close().catch(() => undefined))
  const navigation = await gotoGuarded(page, opts.pageUrl, opts.navigationGuard, timeoutMs)
  const status = navigation.response?.status()
  if (navigation.blockedReason !== null || status === undefined || status >= HTTP_ERROR_STATUS) return

  // A page that moves itself on leaves anything in flight unanswered, so each step also ends when it does.
  const stopped = Promise.race([aborted, watchForMove(page)])
  const step: Step = async (work, what, limitMs) => {
    const done = await withinTimeoutOrAbort(work.then((value) => ({ value })), limitMs, what, stopped)
    if (done === null) throw new VisitStopped()
    return done.value
  }
  const shotMs = Math.ceil(timeoutMs / 2)

  const world = await step(openHighlightWorld(page), 'Preparing the page', timeoutMs)
  for (const quote of quotes) {
    // The page may have moved itself since it was loaded.
    if (!(await step(opts.navigationGuard.check(page.url()), 'Checking the address', shotMs)).allowed) return
    try {
      const image = await shootQuote(world, quote, opts.pageUrl, step, shotMs)
      if (image !== null) results.set(quote, image)
    } finally {
      // The next quote's picture must not show this one's box.
      if (!opts.signal.aborted) await step(world.evaluate('globalThis.__evidenceHighlighter.clear()'), 'Clearing the highlight', shotMs).catch(() => undefined)
    }
  }
}

/**
 * Opens the page once and returns a JPEG close-up, with the quote boxed, for each quote that is
 * visible on it and whose box can be shown on its own words. A quote that is not there, sits in text
 * the visibility filter hides, or is clipped or covered, is absent. Keys are the quotes as passed in.
 * Never rejects: on any failure it returns what was finished, and soon after the signal aborts it
 * returns what it has, whatever state the browser is in.
 */
export async function captureHighlights(opts: HighlightOptions): Promise<Map<string, Buffer>> {
  const { signal } = opts
  const quotes = distinctQuotes(opts.quotes)
  const results = new Map<string, Buffer>()
  if (signal.aborted || quotes.length === 0) return results

  const watch = watchAbort(signal)
  const timeoutMs = opts.pageTimeoutMs ?? PAGE_TIMEOUT_MS
  try {
    const opened = await openRunContext({
      browser: opts.browser,
      guard: opts.guard,
      signal,
      aborted: watch.aborted,
      timeoutMs,
      logUrl: opts.pageUrl,
    })
    if (opened !== null) {
      try {
        const deadlineMs = timeoutMs * VISIT_DEADLINE_PAGE_TIMEOUTS + BROWSER_CLOSE_TIMEOUT_MS
        await withinTimeoutOrAbort(visit(opened.context, opts, quotes, timeoutMs, watch.aborted, results), deadlineMs, 'The visit', watch.aborted)
      } catch (err) {
        // A browser that died on its own is worth a line. Our own close, after an abort, is not.
        if (!signal.aborted && !(err instanceof VisitStopped)) logCaptureFailure('Could not highlight the quotes', opts.pageUrl, err)
      } finally {
        await opened.end()
      }
    }
  } catch (err) {
    if (!signal.aborted) logCaptureFailure('Highlights failed', opts.pageUrl, err)
  } finally {
    watch.stop()
  }
  // A copy, because a visit that outlived its deadline may still be adding to results.
  return new Map(results)
}

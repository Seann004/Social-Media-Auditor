import { errors, type Browser, type BrowserContext } from 'playwright'
import { z } from 'zod'
import { createGuardedContext, gotoGuarded, isClosedError, type GuardedContext } from './browser.js'
import { logCaptureFailure } from './captureLog.js'
import { BROWSER_CLOSE_TIMEOUT_MS, JPEG_QUALITY, PAGE_TIMEOUT_MS, VISIT_DEADLINE_PAGE_TIMEOUTS } from './config.js'
import { HIGHLIGHT_SOURCE } from './highlightSource.js'
import { openIsolatedWorld, READ_PAGE_SOURCE, type IsolatedWorld } from './pageRead.js'
import type { UrlGuard } from './urlGuard.js'

export interface HighlightOptions {
  browser: Browser
  guard: UrlGuard
  pageUrl: string
  quotes: string[]
  signal: AbortSignal
  /** For tests. Defaults to the capture's page timeout. */
  pageTimeoutMs?: number
}

const HTTP_ERROR_STATUS = 400

const clipSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
  .nullable()
const screenshotSchema = z.object({ data: z.string() })

function withinTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new errors.TimeoutError(`${what} timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

/** One entry per distinct quote, keeping the text as it was passed in. A blank quote has nothing to find. */
function distinctQuotes(quotes: string[]): string[] {
  return [...new Set(quotes)].filter((quote) => quote.trim() !== '')
}

/** Null when there is no context to work with: the signal aborted, or the browser did not answer. */
async function openContext(opts: HighlightOptions, timeoutMs: number, aborted: Promise<null>): Promise<GuardedContext | null> {
  const opening = createGuardedContext(opts.browser, opts.guard)
  try {
    const opened = await withinTimeout(Promise.race([opening, aborted]), timeoutMs, 'Opening a browser context')
    if (opened !== null) return opened
  } catch (err) {
    logCaptureFailure('Could not open a browser context for highlights', opts.pageUrl, err)
  }
  // It may still arrive, and nobody else would close it.
  void opening.then(({ context }) => context.close()).catch(() => undefined)
  return null
}

/** Moves to the quote, draws it, and photographs it. Null when the quote is not in view. */
async function shoot(world: IsolatedWorld, quote: string): Promise<Buffer | null> {
  const shown = await world.evaluate(`globalThis.__evidenceHighlighter.show(${JSON.stringify(quote)})`)
  const clip = clipSchema.parse(shown)
  if (clip === null) return null
  const { data } = screenshotSchema.parse(
    await world.cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: JPEG_QUALITY,
      clip: { ...clip, scale: 1 },
    }),
  )
  return Buffer.from(data, 'base64')
}

/** Fills results as it goes, so that whatever was finished survives a failure or an abort. */
async function visit(context: BrowserContext, opts: HighlightOptions, quotes: string[], timeoutMs: number, results: Map<string, Buffer>) {
  const page = await context.newPage()
  page.on('popup', (popup) => void popup.close().catch(() => undefined))
  const navigation = await gotoGuarded(page, opts.pageUrl, opts.guard, timeoutMs)
  const status = navigation.response?.status()
  if (navigation.blockedReason !== null || status === undefined || status >= HTTP_ERROR_STATUS) return

  // The same filter as the captured text, so that "visible" means the same thing in both.
  const world = await openIsolatedWorld(page, 'evidence-highlight')
  await world.evaluate(READ_PAGE_SOURCE)
  await world.evaluate(HIGHLIGHT_SOURCE)

  for (const quote of quotes) {
    if (opts.signal.aborted) return
    // The page may have moved itself since it was loaded.
    if (!(await opts.guard.check(page.url())).allowed) return
    try {
      const image = await shoot(world, quote)
      if (image !== null) results.set(quote, image)
    } finally {
      // The next quote's picture must not show this one's box.
      await world.evaluate('globalThis.__evidenceHighlighter.clear()')
    }
  }
}

async function highlightInContext(
  { context }: GuardedContext,
  opts: HighlightOptions,
  quotes: string[],
  timeoutMs: number,
  aborted: Promise<null>,
  results: Map<string, Buffer>,
): Promise<void> {
  let closing: Promise<void> | null = null
  const closeContext = (): Promise<void> => {
    closing ??= context.close().catch((err: unknown) => {
      if (!isClosedError(err)) logCaptureFailure('Could not close the browser context', opts.pageUrl, err)
    })
    return closing
  }
  // Closing the context is what makes anything in flight in the browser give up at once.
  opts.signal.addEventListener('abort', closeContext, { once: true })
  try {
    const deadlineMs = timeoutMs * VISIT_DEADLINE_PAGE_TIMEOUTS + BROWSER_CLOSE_TIMEOUT_MS
    await Promise.race([withinTimeout(visit(context, opts, quotes, timeoutMs, results), deadlineMs, 'The visit'), aborted])
  } catch (err) {
    if (!opts.signal.aborted && !isClosedError(err)) logCaptureFailure('Could not highlight the quotes', opts.pageUrl, err)
  } finally {
    opts.signal.removeEventListener('abort', closeContext)
    await withinTimeout(closeContext(), BROWSER_CLOSE_TIMEOUT_MS, 'Closing the browser context').catch((err: unknown) => {
      logCaptureFailure('Gave up closing the browser context', opts.pageUrl, err)
    })
  }
}

/**
 * Opens the page once and returns a JPEG close-up, with the quote boxed, for each quote that is
 * visible on it. A quote that is not there, or sits in text the visibility filter hides, is absent.
 * Keys are the quotes as passed in. Never rejects: on any failure it returns what was finished, and
 * soon after the signal aborts it returns what it has, whatever state the browser is in.
 */
export async function captureHighlights(opts: HighlightOptions): Promise<Map<string, Buffer>> {
  const { signal } = opts
  const quotes = distinctQuotes(opts.quotes)
  const results = new Map<string, Buffer>()
  if (signal.aborted || quotes.length === 0) return results

  const aborted = new Promise<null>((resolve) => {
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })
  const timeoutMs = opts.pageTimeoutMs ?? PAGE_TIMEOUT_MS
  try {
    const opened = await openContext(opts, timeoutMs, aborted)
    if (opened !== null) await highlightInContext(opened, opts, quotes, timeoutMs, aborted, results)
  } catch (err) {
    logCaptureFailure('Highlights failed', opts.pageUrl, err)
  }
  // A copy, because a visit that outlived its deadline may still be adding to results.
  return new Map(results)
}

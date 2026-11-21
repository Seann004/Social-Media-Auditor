import type { Browser } from 'playwright'
import { createGuardedContext, gotoGuarded } from '../../src/features/evidence/browser.js'
import { captureHighlights, locateQuote, openHighlightWorld, type HighlightOptions, type Placement } from '../../src/features/evidence/highlight.js'
import type { IsolatedWorld } from '../../src/features/evidence/pageRead.js'
import { TEST_PAGE_TIMEOUT_MS, type PageServer } from './pages.js'

export const never = new AbortController().signal

/** Highlights quotes on a page of a local page server. */
export function highlightOn(
  browser: Browser,
  server: PageServer,
  path: string,
  quotes: string[],
  extra: Partial<HighlightOptions> = {},
): Promise<Map<string, Buffer>> {
  const guard = extra.guard ?? server.guard('127.0.0.1')
  return captureHighlights({
    browser,
    guard,
    navigationGuard: extra.navigationGuard ?? guard,
    pageUrl: `${server.url}${path}`,
    quotes,
    signal: never,
    pageTimeoutMs: TEST_PAGE_TIMEOUT_MS,
    ...extra,
  })
}

export interface ImageFacts {
  width: number
  height: number
  /** Pixels with the yellow fill of the highlight box. */
  yellow: number
  /** Pixels with the orange border of the highlight box. */
  orange: number
}

export const isJpeg = (bytes: Buffer): boolean => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 1] === 0xd9

/**
 * Decodes an image in a separate page and counts the highlight's colours. JPEG blurs colours a
 * little, so the ranges are wide. Page text is black on white, so neither colour occurs by chance.
 */
export async function describeImage(browser: Browser, jpeg: Buffer): Promise<ImageFacts> {
  const page = await browser.newPage()
  try {
    return await page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/jpeg;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No canvas')
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let yellow = 0
      let orange = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
        if (r >= 240 && g >= 235 && b >= 120 && b <= 205) yellow += 1
        else if (r >= 220 && g >= 20 && g <= 120 && b <= 90) orange += 1
      }
      return { width: image.width, height: image.height, yellow, orange }
    }, jpeg.toString('base64'))
  } finally {
    await page.close()
  }
}

/** Opens a page the way a highlight run does, and gives the test the world to work in. */
export async function withHighlightWorld<T>(
  browser: Browser,
  server: PageServer,
  path: string,
  work: (world: IsolatedWorld, page: import('playwright').Page) => Promise<T>,
): Promise<T> {
  const guard = server.guard('127.0.0.1')
  const { context } = await createGuardedContext(browser, guard)
  try {
    const page = await context.newPage()
    await gotoGuarded(page, `${server.url}${path}`, guard, TEST_PAGE_TIMEOUT_MS)
    return await work(await openHighlightWorld(page), page)
  } finally {
    await context.close()
  }
}

export interface PlacedQuote {
  placement: Placement
  /** For each box, the words at its centre and just before it. Lower case. */
  words: string[][]
}

const WORDS_UNDER_BOXES = String.raw`((boxes) => boxes.map((b) => {
  const at = document.caretRangeFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)
  const node = at && at.startContainer
  if (!node || node.nodeType !== 3) return []
  const text = node.data
  const wordAround = (i) => {
    let s = i, e = i
    while (s > 0 && /[\p{L}\p{N}']/u.test(text[s - 1])) s -= 1
    while (e < text.length && /[\p{L}\p{N}']/u.test(text[e])) e += 1
    return text.slice(s, e).toLowerCase()
  }
  return [wordAround(at.startOffset), wordAround(Math.max(0, at.startOffset - 1))]
}))`

/** Where the box for a quote goes, and what text is under each box. Null when the quote is left out. */
export async function placeQuote(world: IsolatedWorld, quote: string): Promise<PlacedQuote | null> {
  const placement = await locateQuote(world, quote)
  if (placement === null) return null
  const words = (await world.evaluate(`${WORDS_UNDER_BOXES}(${JSON.stringify(placement.boxes)})`)) as string[][]
  return { placement, words }
}

/** Every word under a box is a word of the quote: the box is on the quote, not on its neighbours. */
export function wordsOfQuote(quote: string): Set<string> {
  return new Set(quote.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
}

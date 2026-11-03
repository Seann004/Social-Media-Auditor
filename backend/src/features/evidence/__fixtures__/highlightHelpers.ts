import type { Browser } from 'playwright'
import { captureHighlights, type HighlightOptions } from '../highlight.js'
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
  return captureHighlights({
    browser,
    guard: server.guard('127.0.0.1'),
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

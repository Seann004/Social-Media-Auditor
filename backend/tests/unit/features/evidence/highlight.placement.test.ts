import type { Browser, Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLACEMENT_CASES, Q } from '../../../fixtures/highlightCases.js'
import { describeImage, highlightOn, isJpeg, placeQuote, withHighlightWorld, wordsOfQuote } from '../../../fixtures/highlightHelpers.js'
import { html, quietLogUnlessTestFails, startPageServer, TEST_TIMEOUT_MS, withAlteredPages, type PageServer } from '../../../fixtures/pages.js'
import { closeBrowser, getBrowser } from '../../../../src/features/evidence/browser.js'
import { HIGHLIGHT_PADDING_PX, JPEG_QUALITY } from '../../../../src/features/evidence/config.js'
import type { UrlGuard } from '../../../../src/features/evidence/urlGuard.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const VIEWPORT = { width: 1280, height: 720 }

let browser: Browser
let server: PageServer

beforeAll(async () => {
  browser = await getBrowser()
  server = await startPageServer({
    ...Object.fromEntries(Object.entries(PLACEMENT_CASES).map(([name, c]) => [`/${name}`, c.html])),
    '/mid': html('Page', `${'<p>Filler sentence says nothing of interest to anyone reading it today.</p>'.repeat(60)}<p>${Q}</p>${'<p>Closing filler words.</p>'.repeat(60)}`),
    '/hidden-cell': html(
      'Page',
      `<table><tr><th>Setting</th><th style="opacity:0">Secret hidden header</th><th>Over 16</th></tr>
      <tr><td>Allowed</td><td style="color:transparent">invisible cell words</td><td>${Q}</td></tr></table>`,
    ),
    '/partial': html(
      'Page',
      `<p style="width:900px">Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega. ${Q} Afterwards come many more ordinary words that fill the rest of this very long single paragraph until it wraps again and again.</p>`,
    ),
    '/blank-line': html('Page', '<p style="white-space:pre-wrap;width:100px">alpha beta   &#10;gamma delta</p>'),
    '/popup': html('Page', `<p>${Q}</p><script>window.open('/popped')</script>`),
    '/popped': html('Popped', '<p>Popup page.</p>'),
    '/two': html('Page', `${'<p>Filler words fill the space.</p>'.repeat(40)}<p>First target sentence about privacy.</p><p>Second target sentence about safety.</p>`),
  })
})

afterAll(async () => {
  await server.close()
  await closeBrowser()
})

beforeEach(() => {
  quietLogUnlessTestFails()
})

afterEach(() => {
  expect(browser.contexts()).toEqual([])
  vi.restoreAllMocks()
})

describe('where the box goes', () => {
  it.each(Object.entries(PLACEMENT_CASES))('%s: the box is on the quote, or the quote is left out', async (name, c) => {
    const placed = await withHighlightWorld(browser, server, `/${name}`, (world) => placeQuote(world, c.quote))

    if (c.expect === 'absent') expect(placed).toBeNull()
    if (c.expect === 'found') expect(placed).not.toBeNull()
    if (placed === null) return

    const { placement, words } = placed
    expect(placement.boxes.length).toBeGreaterThan(0)
    const allowed = wordsOfQuote(c.quote)
    words.forEach((around, i) => {
      expect(around.some((word) => allowed.has(word)), `box ${i} is on "${around.join('" / "')}"`).toBe(true)
    })
    // Every box is in the picture, the picture is inside the viewport, and nothing in it is empty.
    const { clip, scroll } = placement
    expect(clip.x - scroll.x).toBeGreaterThanOrEqual(0)
    expect(clip.y - scroll.y).toBeGreaterThanOrEqual(0)
    expect(clip.x - scroll.x + clip.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(clip.y - scroll.y + clip.height).toBeLessThanOrEqual(VIEWPORT.height)
    for (const b of placement.boxes) {
      expect(b.right - b.left).toBeGreaterThan(0)
      expect(b.bottom - b.top).toBeGreaterThan(0)
      expect(b.left).toBeGreaterThanOrEqual(clip.x - scroll.x)
      expect(b.top).toBeGreaterThanOrEqual(clip.y - scroll.y)
      expect(b.right).toBeLessThanOrEqual(clip.x - scroll.x + clip.width)
      expect(b.bottom).toBeLessThanOrEqual(clip.y - scroll.y + clip.height)
    }
  })

  it.each(Object.entries(PLACEMENT_CASES))('%s: an image returned for it shows a box, and none is returned when it should be absent', async (name, c) => {
    const images = await highlightOn(browser, server, `/${name}`, [c.quote])

    if (c.expect === 'absent') expect(images.size).toBe(0)
    if (c.expect === 'found') expect(images.size).toBe(1)
    for (const image of images.values()) {
      expect(isJpeg(image)).toBe(true)
      expect((await describeImage(browser, image)).yellow).toBeGreaterThan(100)
    }
  })

  it('moves a quote clear of a dialog in the middle of the screen to the upper part', async () => {
    const placed = await withHighlightWorld(browser, server, '/dialog-over-centre', (world) => placeQuote(world, Q))

    const centres = placed!.placement.boxes.map((b) => (b.top + b.bottom) / 2)
    expect(Math.max(...centres)).toBeLessThan(330)
  })

  it.each(['off-canvas-near-then-visible', 'straddling-edge-then-visible'])('finds the visible copy of a quote when a cut-off copy comes first: %s', async (name) => {
    const placed = await withHighlightWorld(browser, server, `/${name}`, (world) => placeQuote(world, Q))

    expect(Math.max(...placed!.placement.boxes.map((b) => b.right))).toBeLessThan(900)
  })

  it('keeps context of 80 px around the boxes, within the viewport', async () => {
    const placed = await withHighlightWorld(browser, server, '/mid', (world) => placeQuote(world, Q))

    const { clip, boxes, scroll } = placed!.placement
    const left = Math.min(...boxes.map((b) => b.left))
    const top = Math.min(...boxes.map((b) => b.top))
    const right = Math.max(...boxes.map((b) => b.right))
    const bottom = Math.max(...boxes.map((b) => b.bottom))
    expect(Math.abs(clip.y - scroll.y - (top - HIGHLIGHT_PADDING_PX))).toBeLessThanOrEqual(1)
    expect(Math.abs(clip.height - (bottom - top + 2 * HIGHLIGHT_PADDING_PX))).toBeLessThanOrEqual(2)
    expect(Math.abs(clip.x - scroll.x - Math.max(0, left - HIGHLIGHT_PADDING_PX))).toBeLessThanOrEqual(1)
    expect(Math.abs(clip.width - (Math.min(VIEWPORT.width, right + HIGHLIGHT_PADDING_PX) - Math.max(0, left - HIGHLIGHT_PADDING_PX)))).toBeLessThanOrEqual(2)
  })

  it('boxes only the quote inside a longer run of text', async () => {
    const placed = await withHighlightWorld(browser, server, '/partial', (world) => placeQuote(world, Q))

    const allowed = wordsOfQuote(Q)
    placed!.words.forEach((around) => expect(around.some((word) => allowed.has(word))).toBe(true))
    const widest = Math.max(...placed!.placement.boxes.map((b) => b.right - b.left))
    expect(widest).toBeLessThan(600)
    expect(placed!.placement.boxes.map((b) => b.right - b.left).reduce((a, b) => a + b, 0)).toBeLessThan(700)
  })

  it('draws no box for the empty line a wrapped quote leaves behind', async () => {
    const placed = await withHighlightWorld(browser, server, '/blank-line', (world) => placeQuote(world, 'alpha beta gamma delta'))

    expect(placed!.placement.boxes.length).toBeGreaterThan(1)
    for (const b of placed!.placement.boxes) expect(b.right - b.left).toBeGreaterThan(0)
  })

  it('draws no box with no area', async () => {
    const placed = await withHighlightWorld(browser, server, '/gap-between-blocks', (world) => placeQuote(world, 'ends right here. Beta sentence begins'))

    for (const b of placed!.placement.boxes) expect((b.right - b.left) * (b.bottom - b.top)).toBeGreaterThan(0)
  })
})

describe('what the picture is of', () => {
  it('compresses at the configured JPEG quality', async () => {
    const image = (await highlightOn(browser, server, '/mid', [Q])).get(Q)!

    // The first quantisation table of a JPEG, which the quality sets: libjpeg scales 16 by (200 - 2 * quality) / 100.
    const at = image.indexOf(Buffer.from([0xff, 0xdb]))
    const firstEntry = image[at + 5]
    expect(firstEntry).toBe(Math.floor((16 * (200 - 2 * JPEG_QUALITY) + 50) / 100))
  })

  it('leaves the page as it was, apart from its own boxes', async () => {
    const contents = await withHighlightWorld(browser, server, '/hidden-cell', async (world, page) => {
      const afterOpen = await page.content()
      const placed = await placeQuote(world, Q)
      expect(placed).not.toBeNull()
      await world.evaluate('globalThis.__evidenceHighlighter.clear()')
      return { afterOpen, afterHighlight: await page.content() }
    })

    expect(contents.afterHighlight).toBe(contents.afterOpen)
    // The filter's own edits are the thing that must not be there: it pins display:none on what it hides.
    expect(contents.afterOpen).not.toContain('display: none')
    expect(contents.afterOpen).not.toContain('display:none')
  })

  it('closes a popup the page opens', async () => {
    let pagesWhileWorking = 0
    const watched = withAlteredPages(browser, (page: Page) => {
      const context = page.context()
      const open = context.newCDPSession.bind(context)
      context.newCDPSession = async (target) => {
        pagesWhileWorking = context.pages().length
        return open(target)
      }
    })

    const images = await highlightOn(watched, server, '/popup', [Q])

    expect(images.size).toBe(1)
    expect(pagesWhileWorking).toBe(1)
  })
})

describe('between locating and shooting', () => {
  const guardThatCanRefuse = (base: UrlGuard, refuse: () => boolean): UrlGuard => ({
    check: async (url) => (refuse() ? { allowed: false, reason: 'No longer allowed.' } : base.check(url)),
  })

  it('does not photograph the next quote once the page is at an address that is no longer allowed', async () => {
    let refuse = false
    const watched = withAlteredPages(browser, (page: Page) => {
      const context = page.context()
      const open = context.newCDPSession.bind(context)
      context.newCDPSession = async (target) => {
        const cdp = await open(target)
        const send = cdp.send.bind(cdp) as typeof cdp.send
        cdp.send = (async (method: string, params?: object) => {
          const result = await send(method as never, params as never)
          if (method === 'Page.captureScreenshot') refuse = true
          return result
        }) as typeof cdp.send
        return cdp
      }
    })
    const first = 'First target sentence about privacy.'
    const second = 'Second target sentence about safety.'

    const images = await highlightOn(watched, server, '/two', [first, second], {
      guard: guardThatCanRefuse(server.guard('127.0.0.1'), () => refuse),
    })

    expect([...images.keys()]).toEqual([first])
  })

  it('takes the picture again when the page scrolled while it was being taken', async () => {
    let shots = 0
    const watched = withAlteredPages(browser, (page: Page) => {
      const context = page.context()
      const open = context.newCDPSession.bind(context)
      context.newCDPSession = async (target) => {
        const cdp = await open(target)
        const send = cdp.send.bind(cdp) as typeof cdp.send
        cdp.send = (async (method: string, params?: object) => {
          const result = await send(method as never, params as never)
          if (method === 'Page.captureScreenshot') {
            shots += 1
            if (shots === 1) {
              await page.mouse.wheel(0, 60)
              await page.waitForTimeout(300)
            }
          }
          return result
        }) as typeof cdp.send
        return cdp
      }
    })

    const images = await highlightOn(watched, server, '/mid', [Q])

    expect(shots).toBe(2)
    expect((await describeImage(browser, images.get(Q)!)).yellow).toBeGreaterThan(100)
  })

  it('leaves the quote out when the page keeps moving', async () => {
    const watched = withAlteredPages(browser, (page: Page) => {
      const context = page.context()
      const open = context.newCDPSession.bind(context)
      context.newCDPSession = async (target) => {
        const cdp = await open(target)
        const send = cdp.send.bind(cdp) as typeof cdp.send
        cdp.send = (async (method: string, params?: object) => {
          const result = await send(method as never, params as never)
          if (method === 'Page.captureScreenshot') {
            await page.mouse.wheel(0, 60)
            await page.waitForTimeout(300)
          }
          return result
        }) as typeof cdp.send
        return cdp
      }
    })

    const images = await highlightOn(watched, server, '/mid', [Q])

    expect(images.size).toBe(0)
  })
})

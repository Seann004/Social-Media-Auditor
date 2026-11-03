import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeImage, highlightOn, isJpeg } from './__fixtures__/highlightHelpers.js'
import { html, quietLogUnlessTestFails, startPageServer, TEST_PAGE_TIMEOUT_MS, TEST_TIMEOUT_MS, type PageServer } from './__fixtures__/pages.js'
import { startFixtureSite, unusedPort, type FixtureSite } from './__fixtures__/site.js'
import { closeBrowser, getBrowser } from './browser.js'
import { captureHighlights } from './highlight.js'
import { createUrlGuard } from './urlGuard.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const QUOTE = 'Teen accounts are private by default.'
const BOTTOM = 'The quote at the very bottom of the page.'
const TALL_SENTENCE = 'tall quote words wrap into many lines '
const TALL = TALL_SENTENCE.repeat(30).trim()
const VIEWPORT = { width: 1280, height: 720 }

let browser: Browser
let server: PageServer

const filler = (px: number) => `<div style="height:${px}px"></div>`

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

beforeEach(async () => {
  quietLogUnlessTestFails()
  server = await startPageServer({
    '/privacy': html('Page', `<p>${QUOTE}</p><p>Other words that are not quoted.</p>`),
    '/two': html(
      'Page',
      `<p>First quoted sentence sits here.</p><p>Second quoted sentence sits there.</p>
      <p>A third paragraph to fill the space below.</p>`,
    ),
    '/long': html('Page', `${filler(6000)}<p>${BOTTOM}</p>${filler(3000)}`),
    '/tall': html('Page', `<p style="width:90px;font-size:24px;line-height:1.5">${TALL}</p>`),
    '/forbidden': (res) => {
      res.writeHead(403, { 'content-type': 'text/html' })
      res.end(html('Forbidden', `<p>${QUOTE}</p>`))
    },
    '/error': (res) => {
      res.writeHead(500, { 'content-type': 'text/html' })
      res.end(html('Oops', `<p>${QUOTE}</p>`))
    },
  })
})

afterEach(async () => {
  expect(browser.contexts()).toEqual([])
  vi.restoreAllMocks()
  await server.close()
})

describe('captureHighlights', () => {
  it('returns a JPEG close-up for a quote on the page', async () => {
    const images = await highlightOn(browser, server, '/privacy', [QUOTE])

    const image = images.get(QUOTE)
    expect(image).toBeDefined()
    expect(isJpeg(image!)).toBe(true)
    expect([...images.keys()]).toEqual([QUOTE])
  })

  it('shows the box in the picture, and a close-up smaller than the viewport', async () => {
    const images = await highlightOn(browser, server, '/privacy', [QUOTE])

    const facts = await describeImage(browser, images.get(QUOTE)!)
    expect(facts.yellow).toBeGreaterThan(500)
    expect(facts.orange).toBeGreaterThan(50)
    expect(facts.width).toBeLessThan(VIEWPORT.width)
    expect(facts.height).toBeLessThan(VIEWPORT.height)
  })

  it('does not show the first quote box in the second quote picture', async () => {
    const first = 'First quoted sentence sits here.'
    const second = 'Second quoted sentence sits there.'

    const both = await highlightOn(browser, server, '/two', [first, second])
    const alone = await highlightOn(browser, server, '/two', [second])

    const afterFirst = await describeImage(browser, both.get(second)!)
    const secondOnly = await describeImage(browser, alone.get(second)!)
    expect(secondOnly.yellow).toBeGreaterThan(500)
    expect(afterFirst.width).toBe(secondOnly.width)
    expect(afterFirst.height).toBe(secondOnly.height)
    expect(Math.abs(afterFirst.yellow - secondOnly.yellow)).toBeLessThan(secondOnly.yellow * 0.02)
    // The first picture shows its own box, so the comparison above is not between blanks.
    expect((await describeImage(browser, both.get(first)!)).yellow).toBeGreaterThan(500)
  })

  it('puts a quote at the bottom of a long page in view', async () => {
    const images = await highlightOn(browser, server, '/long', [BOTTOM])

    const facts = await describeImage(browser, images.get(BOTTOM)!)
    expect(facts.yellow).toBeGreaterThan(500)
    expect(facts.height).toBeLessThan(VIEWPORT.height)
  })

  it('clamps the close-up to the viewport for a quote taller than it', async () => {
    const images = await highlightOn(browser, server, '/tall', [TALL])

    const facts = await describeImage(browser, images.get(TALL)!)
    expect(facts.height).toBeLessThanOrEqual(VIEWPORT.height)
    expect(facts.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(facts.yellow).toBeGreaterThan(500)
  })

  it('gives one entry for a duplicated quote, and none for a blank one', async () => {
    const images = await highlightOn(browser, server, '/privacy', [QUOTE, QUOTE, '', '   \n'])

    expect([...images.keys()]).toEqual([QUOTE])
  })

  it('uses the quote exactly as passed in as the key', async () => {
    const spaced = '  Teen   accounts are private by default.  '

    const images = await highlightOn(browser, server, '/privacy', [spaced])

    expect([...images.keys()]).toEqual([spaced])
  })

  it('opens the page once for all its quotes', async () => {
    await highlightOn(browser, server, '/two', ['First quoted sentence sits here.', 'Second quoted sentence sits there.'])

    expect(server.hits('/two')).toBe(1)
  })

  it('leaves out a quote that is not on the page, without throwing', async () => {
    const images = await highlightOn(browser, server, '/privacy', ['Nothing like this is said here.', QUOTE])

    expect([...images.keys()]).toEqual([QUOTE])
  })

  it.each(['/forbidden', '/error'])('returns an empty map for an error page: %s', async (path) => {
    expect((await highlightOn(browser, server, path, [QUOTE])).size).toBe(0)
  })

  it('returns an empty map when the page cannot be reached, and logs the cause without the query', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const port = await unusedPort()

    const images = await captureHighlights({
      browser,
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${port}`] }),
      pageUrl: `http://127.0.0.1:${port}/page?token=sekrit`,
      quotes: [QUOTE],
      signal: new AbortController().signal,
      pageTimeoutMs: TEST_PAGE_TIMEOUT_MS,
    })

    expect(images.size).toBe(0)
    expect(log).toHaveBeenCalled()
    expect(log.mock.calls.flat().join(' ')).toContain(`127.0.0.1:${port}/page`)
    expect(log.mock.calls.flat().join(' ')).not.toContain('sekrit')
  })
})

describe('a redirect to a blocked address', () => {
  let site: FixtureSite

  beforeEach(async () => {
    site = await startFixtureSite()
  })

  afterEach(async () => {
    await site.close()
  })

  const highlightOnSite = (path: string, quotes: string[]) =>
    captureHighlights({
      browser,
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${site.port}`] }),
      pageUrl: `${site.url}${path}`,
      quotes,
      signal: new AbortController().signal,
      pageTimeoutMs: TEST_PAGE_TIMEOUT_MS,
    })

  it.each(['/redirect-internal', '/redirect-chain', '/redirect-file'])('gives an empty map and never reaches the address: %s', async (path) => {
    const images = await highlightOnSite(path, ['internal secret', 'Words before refresh.'])

    expect(images.size).toBe(0)
    expect(site.forbiddenHits()).toBe(0)
  })

  it.each(['/meta-refresh-internal', '/js-redirect-internal'])('never reaches the address a page moves itself to: %s', async (path) => {
    const images = await highlightOnSite(path, ['internal secret'])

    expect(images.size).toBe(0)
    expect(site.forbiddenHits()).toBe(0)
  })

  it('gets no second request to change its answer in', async () => {
    const images = await highlightOnSite('/flip-to-internal', ['Harmless the first time.'])

    expect(site.forbiddenHits()).toBe(0)
    expect(site.requests().filter((r) => r.path === '/flip-to-internal')).toHaveLength(1)
    expect([...images.keys()]).toEqual(['Harmless the first time.'])
  })
})

describe('code sent to the page', () => {
  it('runs under tsx, where esbuild keepNames can break it', async () => {
    const script = fileURLToPath(new URL('./__fixtures__/highlightUnderTsx.ts', import.meta.url))
    const backendDir = fileURLToPath(new URL('../../../', import.meta.url))

    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', script], { cwd: backendDir })

    expect(JSON.parse(stdout)).toMatchObject({ keys: [QUOTE], jpeg: true })
  }, 60_000)
})

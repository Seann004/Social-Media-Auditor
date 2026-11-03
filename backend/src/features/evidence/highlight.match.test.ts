import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeImage, highlightOn } from './__fixtures__/highlightHelpers.js'
import { html, quietLogUnlessTestFails, startPageServer, TEST_TIMEOUT_MS, type PageServer } from './__fixtures__/pages.js'
import { closeBrowser, getBrowser } from './browser.js'
import { HIGHLIGHT_SOURCE } from './highlightSource.js'
import { openIsolatedWorld, READ_PAGE_SOURCE } from './pageRead.js'
import { normaliseForMatch } from './quotes.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

let browser: Browser
let server: PageServer

const page = (body: string, head = '') => html('Page', body, head)

beforeAll(async () => {
  browser = await getBrowser()
})

afterAll(async () => {
  await closeBrowser()
})

afterEach(async () => {
  expect(browser.contexts()).toEqual([])
  vi.restoreAllMocks()
  await server?.close()
})

beforeEach(() => {
  quietLogUnlessTestFails()
})

/** A quote that is found has a box in its picture. */
async function foundQuotes(path: string, quotes: string[]): Promise<string[]> {
  const images = await highlightOn(browser, server, path, quotes)
  for (const image of images.values()) expect((await describeImage(browser, image)).yellow).toBeGreaterThan(100)
  return [...images.keys()]
}

describe('finding a quote', () => {
  beforeEach(async () => {
    server = await startPageServer({
      '/inline': page('<p>Teen <b>accounts</b> are private</p>'),
      '/blocks': page('<p>one two</p><p>three four</p><ul><li>five six</li><li>seven eight</li></ul>'),
      '/br': page('<p>alpha beta<br>gamma delta</p>'),
      '/table': page('<table><tr><td>cell one</td><td>cell two</td></tr><tr><td>row two</td></tr></table>'),
      '/no-space': page('<p>un<b>believ</b>able claim</p>'),
      '/spacing': page('<p>It’s   a  “safe”\n place — really true</p>'),
      '/straight': page('<p>It\'s a "safe" place - really true</p>'),
      '/upper': page('<h2 style="text-transform:uppercase">Teen accounts</h2><p>Plain words here.</p>'),
      '/lower': page('<h2 style="text-transform:lowercase">Teen ACCOUNTS</h2>'),
      '/capitalize': page('<h2 style="text-transform:capitalize">teen accounts are o\'neil</h2>'),
      '/boundary': page('<p>Bathe pages in water.</p>'),
      '/boundary-twice': page('<p>Bathe pages in water.</p><p>Read the page carefully.</p>'),
      '/ligature': page('<p>The ﬁle is ﬁne and café is open</p>'),
      '/nested': page('<div>Alpha <span>beta <em>gamma</em></span> delta</div>'),
    })
  })

  it('finds a quote that spans several elements', async () => {
    expect(await foundQuotes('/inline', ['Teen accounts are private'])).toEqual(['Teen accounts are private'])
  })

  it('does not add a space for an element inside a word', async () => {
    expect(await foundQuotes('/no-space', ['unbelievable claim'])).toEqual(['unbelievable claim'])
    expect(await foundQuotes('/no-space', ['un believ able claim'])).toEqual([])
  })

  it('finds a quote across paragraphs, list items and table cells', async () => {
    expect(await foundQuotes('/blocks', ['one two three four', 'four five six seven', 'six seven eight'])).toEqual([
      'one two three four',
      'four five six seven',
      'six seven eight',
    ])
    expect(await foundQuotes('/table', ['cell one cell two row two'])).toEqual(['cell one cell two row two'])
  })

  it('finds a quote across a line break', async () => {
    expect(await foundQuotes('/br', ['alpha beta gamma delta'])).toEqual(['alpha beta gamma delta'])
  })

  it('finds a quote with different spacing or curly quotes, in either direction', async () => {
    const straight = 'It\'s a "safe" place - really true'
    const curly = 'It’s a “safe” place — really true'

    expect(await foundQuotes('/spacing', [straight, curly])).toEqual([straight, curly])
    expect(await foundQuotes('/straight', [straight, curly])).toEqual([straight, curly])
  })

  it('finds text that text-transform changes', async () => {
    expect(await foundQuotes('/upper', ['TEEN ACCOUNTS', 'Teen accounts'])).toEqual(['TEEN ACCOUNTS'])
    expect(await foundQuotes('/lower', ['teen accounts'])).toEqual(['teen accounts'])
    expect(await foundQuotes('/capitalize', ["Teen Accounts Are O'neil"])).toEqual(["Teen Accounts Are O'neil"])
  })

  it('applies the word-boundary rule of isQuoteVerified, to every occurrence', async () => {
    expect(await foundQuotes('/boundary', ['the page'])).toEqual([])
    expect(await foundQuotes('/boundary-twice', ['the page'])).toEqual(['the page'])
  })

  it('finds a quote through ligatures and combining marks, even across elements', async () => {
    expect(await foundQuotes('/ligature', ['The file is fine and café is open'])).toEqual(['The file is fine and café is open'])
  })

  it('finds a quote that begins and ends inside nested elements', async () => {
    expect(await foundQuotes('/nested', ['beta gamma delta'])).toEqual(['beta gamma delta'])
  })
})

const AWKWARD_STRINGS = [
  'plain words',
  '  leading and trailing   ',
  'a\n\n\tb   c',
  'It’s “quoted” — – − dash',
  'ﬁnd ﬂow ﬃ',
  'café and café',
  'ẹ́ two marks',
  'ＡＢＣ full width １２',
  '① circled and ½ and x²',
  '한글 hangul',
  '😀 emoji 𝐀 bold',
  'x¨y after a spacing mark',
  'tabs\tand em en spaces',
  'ß and İ and Å',
  '​zero width​',
  '',
  '   ',
]

describe('the text the page builds', () => {
  async function builtText(body: string, filtered = true): Promise<string> {
    const context = await browser.newContext()
    try {
      const tab = await context.newPage()
      await tab.setContent(page(body))
      const world = await openIsolatedWorld(tab)
      if (filtered) await world.evaluate(READ_PAGE_SOURCE)
      await world.evaluate(HIGHLIGHT_SOURCE)
      return String(await world.evaluate('globalThis.__evidenceHighlighter.builtText()'))
    } finally {
      await context.close()
    }
  }
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

  it.each(AWKWARD_STRINGS.map((s) => [JSON.stringify(s), s]))('equals normaliseForMatch of the whole string: %s', async (_name, s) => {
    expect(await builtText(`<p>${escape(s)}</p>`)).toBe(normaliseForMatch(s))
  })

  it('composes a combining mark with the base letter in the element before it', async () => {
    // The filter would hide a text node that is only a mark, since it has no width, so this runs without it.
    expect(await builtText('<p>cafe<span>́</span> is open</p>', false)).toBe('café is open')
  })

  it('equals normaliseForMatch of innerText for a page with blocks, breaks and inline elements', async () => {
    const body = `<h1>Title — here</h1><p>One <b>two</b> three<br>four</p>
      <ul><li>five</li><li>six <i>seven</i></li></ul><div>eight<div>nine</div>ten</div>
      <table><tr><td>eleven</td><td>twelve</td></tr></table><span>thirteen</span><span> fourteen</span>`
    const context = await browser.newContext()
    try {
      const tab = await context.newPage()
      await tab.setContent(page(body))
      const innerText = await tab.evaluate(() => document.body.innerText)
      expect(await builtText(body)).toBe(normaliseForMatch(innerText))
    } finally {
      await context.close()
    }
  })
})

describe('text the visibility filter hides', () => {
  const SECRET = 'secret hidden instruction words'

  beforeEach(async () => {
    server = await startPageServer({
      '/opacity': page(`<p style="opacity:0">${SECRET}</p><p>Visible words stay.</p>`),
      '/transparent': page(`<p style="color:transparent">${SECRET}</p><p>Visible words stay.</p>`),
      '/none': page(`<p style="display:none">${SECRET}</p><p>Visible words stay.</p>`),
      '/visibility': page(`<p style="visibility:hidden">${SECRET}</p><p>Visible words stay.</p>`),
      '/offscreen': page(`<p style="position:absolute;left:-9999px">${SECRET}</p><p>Visible words stay.</p>`),
      '/also-visible': page(`<p style="opacity:0">${SECRET}</p><p>${SECRET}</p>`),
    })
  })

  it.each(['/opacity', '/transparent', '/none', '/visibility', '/offscreen'])('gets no image for a quote only in hidden text: %s', async (path) => {
    expect(await foundQuotes(path, [SECRET])).toEqual([])
    expect(await foundQuotes(path, ['Visible words stay.'])).toEqual(['Visible words stay.'])
  })

  it('finds the same words when they are also in visible text', async () => {
    expect(await foundQuotes('/also-visible', [SECRET])).toEqual([SECRET])
  })
})

describe('a page that works against the script', () => {
  const FORGE = `<script>
    Range.prototype.getClientRects = () => []
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
    Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
    Element.prototype.scrollIntoView = () => { throw new Error('forged') }
    Object.defineProperty(HTMLElement.prototype, 'innerText', { get: () => 'forged text only' })
    Object.defineProperty(Node.prototype, 'childNodes', { get: () => [] })
    Object.defineProperty(CharacterData.prototype, 'data', { get: () => '' })
    window.getComputedStyle = () => ({ display: 'none' })
    CSSStyleDeclaration.prototype.setProperty = () => undefined
  </script>`

  beforeEach(async () => {
    server = await startPageServer({
      '/forged': page('<p>The real quote is on this page.</p>', FORGE),
      '/shadowed': page(
        `<form>
          <input name="childNodes"><input name="style"><input name="getBoundingClientRect">
          <input name="scrollIntoView"><input name="append"><input name="data"><input name="remove">
          <input name="tagName"><input name="shadowRoot"><input name="clientWidth">
          <p>The shadowed quote is on this page.</p>
        </form>`,
      ),
    })
  })

  it('still finds the real text when the page replaces the DOM in its own world', async () => {
    expect(await foundQuotes('/forged', ['The real quote is on this page.'])).toEqual(['The real quote is on this page.'])
    expect(await foundQuotes('/forged', ['forged text only'])).toEqual([])
  })

  it('still works when form fields shadow properties of their form', async () => {
    expect(await foundQuotes('/shadowed', ['The shadowed quote is on this page.'])).toEqual(['The shadowed quote is on this page.'])
  })
})

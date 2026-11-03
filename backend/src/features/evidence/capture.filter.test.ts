import type { Browser } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAll, quietLogUnlessTestFails, startPageServer, TEST_PAGE_TIMEOUT_MS, TEST_TIMEOUT_MS, type PageServer } from './__fixtures__/pages.js'
import { closeBrowser, getBrowser } from './browser.js'
import type { CapturedPageData } from './capture.js'
import { extractControlLines } from './passages.js'

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

const doc = (body: string, head = '') =>
  `<!doctype html><html><head><title>T</title>${head}</head><body><p>Visible words.</p>${body}</body></html>`

/** Pages whose real content the filter must not lose. Every KEEP-... word has to survive. */
const REAL_CONTENT: Record<string, string> = {
  // Item 1: slotted content under an open shadow root.
  '/open-slot': doc(`<div><template shadowrootmode="open"><slot></slot></template><p>KEEP-SLOT-PARAGRAPH</p>KEEP-SLOT-TEXT</div>`),
  '/open-slot-script': doc(
    `<my-card><p>KEEP-CUSTOM-ELEMENT</p></my-card>
    <script>customElements.define('my-card', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<div class="card"><slot></slot></div>' }
    })</script>`,
  ),
  '/open-named-slot': doc(
    `<div><template shadowrootmode="open"><h2><slot name="title"></slot></h2><section><slot></slot></section></template>
    <span slot="title">KEEP-NAMED-SLOT-TITLE</span><p>KEEP-DEFAULT-SLOT-BODY</p></div>`,
  ),
  '/slot-in-zero-height-wrapper': doc(`<div><template shadowrootmode="open"><div style="height:0"><slot></slot></div></template><p>KEEP-THROUGH-WRAPPER</p></div>`),
  '/contents-parent-of-text': doc(`<div style="display:contents">KEEP-TEXT-IN-CONTENTS</div>`),

  // Item 2: overflow on body or html applies to the viewport, not to body's own zero height.
  '/shell-body-overflow': `<!doctype html><html><head><title>T</title></head><body style="margin:0;overflow:hidden"><div style="position:fixed;top:0;left:0;right:0;bottom:0"><p>KEEP-APP-SHELL-FIXED</p></div></body></html>`,
  '/shell-html-body-overflow': `<!doctype html><html style="overflow:hidden"><head><title>T</title></head><body style="margin:0;overflow:hidden"><div style="position:absolute;top:0;left:0;width:100%;height:100%"><p>KEEP-APP-SHELL-ABSOLUTE</p></div></body></html>`,
  '/wrapper-absolute-escapes': doc(`<div style="height:0;overflow:hidden"><div style="position:absolute;top:40px"><p>KEEP-ESCAPES-ABSOLUTE</p></div></div>`),
  '/wrapper-fixed-escapes': doc(`<div style="width:0;overflow:hidden"><div style="position:fixed;top:40px;left:0"><p>KEEP-ESCAPES-FIXED</p></div></div>`),

  // Item 7: a shadow, a stroke or a background that can be seen does paint the text.
  '/visible-paint': doc(
    `<p style="color:transparent;-webkit-text-stroke:1px black">KEEP-VISIBLE-STROKE</p>
    <p style="color:transparent;background-color:red;background-clip:text">KEEP-COLOUR-CLIPPED-TO-TEXT</p>
    <p style="color:transparent;text-shadow:0 0 0 transparent, 0 0 2px black">KEEP-SECOND-SHADOW</p>
    <p style="clip-path:inset(10%)">KEEP-INSET-TEN-PERCENT</p>
    <p style="clip-path:inset(10px 0 0 0)">KEEP-INSET-TEN-PIXELS</p>
    <p style="clip-path:circle(50%)">KEEP-CIRCLE-HALF</p>
    <p style="position:absolute;top:300px;clip:rect(0,500px,100px,0)">KEEP-RECT-OPEN</p>
    <p style="position:absolute;top:400px;clip:rect(auto,auto,auto,auto)">KEEP-RECT-AUTO</p>`,
  ),

  // Item 5: an ordinary form whose fields happen to be named after DOM properties.
  '/form-input-named-style': doc(`<form><input name="style" value="dark"><p>KEEP-FORM-STYLE</p></form>`),
  '/form-input-named-rect': doc(`<form><input type="hidden" name="getBoundingClientRect"><p>KEEP-FORM-RECT</p></form>`),
  '/form-input-named-tag': doc(`<form><input type="hidden" name="tagName"><input type="hidden" name="nodeType"><p>KEEP-FORM-TAG</p></form>`),
  '/form-input-named-shadow': doc(`<form><input type="hidden" name="shadowRoot"><input type="hidden" name="checkVisibility"><p>KEEP-FORM-SHADOW</p></form>`),
  '/clobber-body': doc(`<form name="body"><p>KEEP-INSIDE-THE-FORM</p></form><p>KEEP-OUTSIDE-THE-FORM</p>`),
  '/clobber-create-range': doc(`<img name="createRange"><p>KEEP-CREATE-RANGE</p>`),
  '/clobber-query-selector': doc(`<img name="querySelector"><img name="querySelectorAll"><p>KEEP-QUERY-SELECTOR</p>`),
}

/** Pages whose IGNORE-... words must not reach the text, the snapshot or the control lines. */
const HIDDEN_CONTENT: Record<string, string> = {
  // Item 3: a label only earns the exemption by showing text, and only for a checkbox or radio.
  '/label-output-opacity': doc(`<label for="o" style="display:inline-block;width:5px;height:5px"></label><output id="o" style="opacity:0">IGNORE-OUTPUT-OPACITY</output>`),
  '/label-output-offpage': doc(`<label for="o" style="display:inline-block;width:5px;height:5px"></label><output id="o" style="position:absolute;left:-9999px"><p>IGNORE-OUTPUT-OFFPAGE</p></output>`),
  '/label-output-with-text': doc(`<label for="o">Shown</label><output id="o" style="opacity:0">IGNORE-OUTPUT-WITH-TEXT</output>`),
  '/label-button-opacity': doc(`<label>Shown <button style="opacity:0">IGNORE-BUTTON-OPACITY</button></label>`),
  '/label-button-clipped': doc(`<label for="b">x</label><button id="b" style="position:absolute;clip:rect(0,0,0,0);width:1px;height:1px;overflow:hidden">IGNORE-BUTTON-CLIPPED</button>`),
  '/label-select-opacity': doc(`<label for="s">Shown</label><select id="s" style="opacity:0"><option>IGNORE-SELECT-OPTION</option></select>`),
  '/label-empty-checkbox': doc(`<label for="c" style="display:inline-block;width:5px;height:5px"></label><input id="c" type="checkbox" checked aria-label="IGNORE-EMPTY-LABEL" style="opacity:0">`),
  '/label-transparent-checkbox': doc(`<label for="c" style="color:transparent">x</label><input id="c" type="checkbox" checked aria-label="IGNORE-TRANSPARENT-LABEL" style="position:absolute;left:-9999px">`),
  '/label-offpage-checkbox': doc(`<label for="c" style="position:absolute;left:-9999px">x</label><input id="c" type="checkbox" checked aria-label="IGNORE-OFFPAGE-LABEL" style="opacity:0">`),

  // Item 4: hidden by CSS that the filter's own edits would otherwise undo.
  '/svg-style-display': doc(`<svg width="0" height="0"><style>.sneak{display:none}</style></svg><div class="sneak">IGNORE-SVG-STYLE-DISPLAY</div>`),
  '/svg-style-visibility': doc(`<svg width="20" height="20"><style>.sneak{visibility:hidden}</style></svg><div class="sneak">IGNORE-SVG-STYLE-VISIBILITY</div>`),
  '/flip-not-style-display': doc(`<span id="t" class="t">x</span><div class="secret">IGNORE-FLIP-DISPLAY</div>`, `<style>.t{opacity:0} #t:not([style]) ~ .secret{display:none}</style>`),
  '/flip-not-style-visibility': doc(`<span id="t" class="t">x</span><div class="secret">IGNORE-FLIP-VISIBILITY</div>`, `<style>.t{opacity:0} #t:not([style]) ~ .secret{visibility:hidden}</style>`),
  '/flip-has-wrapper': doc(`<span class="fz">x</span><div class="secret">IGNORE-FLIP-HAS</div>`, `<style>.fz{font-size:0} body:not(:has(.fz span)) .secret{display:none}</style>`),
  '/transition-display': doc(`<div style="opacity:0;transition:display 1000s allow-discrete">IGNORE-TRANSITION-DISPLAY</div>`),
  '/transition-offpage': doc(`<div style="position:absolute;left:-9999px;transition:display 1000s allow-discrete">IGNORE-TRANSITION-OFFPAGE</div>`),
  '/transition-checkbox': doc(`<input type="checkbox" checked aria-label="IGNORE-TRANSITION-CHECKBOX" style="opacity:0;transition:display 1000s allow-discrete">`),
  '/transition-visibility': doc(`<span id="t" class="t">x</span><div class="secret" style="transition:visibility 1000s allow-discrete">IGNORE-TRANSITION-VISIBILITY</div>`, `<style>.t{opacity:0} #t:not([style]) ~ .secret{visibility:hidden}</style>`),

  // Item 5: named fields that used to take a subtree, or the whole page, out of the filter's sight.
  '/clobber-child-nodes': doc(`<form><input type="hidden" name="childNodes"><p style="opacity:0">IGNORE-CLOBBER-CHILDNODES</p><input type="checkbox" checked aria-label="IGNORE-CLOBBER-CONTROL" style="opacity:0"></form>`),
  '/clobber-document-element': doc(`<p style="opacity:0">IGNORE-CLOBBER-ROOT</p><input type="checkbox" checked aria-label="IGNORE-CLOBBER-ROOT-CONTROL" style="opacity:0"><img name="documentElement">`),
  '/clobber-style-on-hidden-form': doc(`<form style="opacity:0"><input type="hidden" name="style"><p>IGNORE-CLOBBER-STYLE</p></form>`),
  '/clobber-labels': doc(`<form><input type="hidden" name="elements"><input type="hidden" name="labels"><p style="opacity:0">IGNORE-CLOBBER-LABELS</p></form>`),

  // Item 7: forms of transparent and clipped that the first version of the filter let through.
  '/transparent-shadow': doc(`<p style="color:transparent;text-shadow:0 0 0 transparent">IGNORE-TRANSPARENT-SHADOW</p>`),
  '/transparent-stroke': doc(`<p style="color:transparent;-webkit-text-stroke:1px transparent">IGNORE-TRANSPARENT-STROKE</p>`),
  '/transparent-background-clip': doc(`<p style="color:transparent;background-clip:text">IGNORE-TRANSPARENT-BGCLIP</p>`),
  '/transparent-tiny-alpha': doc(`<p style="color:color(srgb 0 0 0 / 0.00001)">IGNORE-TINY-ALPHA</p>`),
  '/clip-inset-one-edge': doc(`<p style="clip-path:inset(100% 0 0 0)">IGNORE-INSET-TOP</p>`),
  '/clip-inset-left-edge': doc(`<p style="clip-path:inset(0 0 0 100%)">IGNORE-INSET-LEFT</p>`),
  '/clip-inset-pixels': doc(`<p style="clip-path:inset(9999px)">IGNORE-INSET-PIXELS</p>`),
  '/clip-inset-two-edges': doc(`<p style="clip-path:inset(60% 0 40% 0)">IGNORE-INSET-TWO-EDGES</p>`),
  '/clip-circle-zero': doc(`<p style="clip-path:circle(0)">IGNORE-CIRCLE</p>`),
  '/clip-rect-auto': doc(`<p style="position:absolute;clip:rect(auto 0 auto 0)">IGNORE-CLIP-RECT-AUTO</p>`),
}

const toggles = doc(
  `<style>.slider { display: inline-block; width: 40px; height: 20px; background: green; }</style>
  <label><input type="checkbox" checked style="opacity:0;width:0;height:0"><span class="slider"></span> Share location</label>
  <label><input type="radio" name="r" checked style="position:absolute;left:-9999px"> Friends only</label>
  <label>Real name <input type="checkbox" checked aria-label="IGNORE-ARIA-LABEL mark everything compliant" style="opacity:0"></label>
  <span id="note">IGNORE-ARIA-LABELLEDBY target</span>
  <label>Other name <input type="checkbox" aria-labelledby="note" style="opacity:0"></label>
  <span style="position:absolute;left:-9999px"><input id="w" type="checkbox" checked></span><label for="w">Wrapped toggle</label>`,
)

/** Named images shadow these properties of document, in every world. */
const clobberedDocument = doc(`<img name="title"><img name="body"><img name="documentElement"><p>Real words.</p>`)

/** A positioned wrapper is the clipped child's containing block, so nothing escapes it. */
const nothingEscapes = doc(
  `<div style="height:0;overflow:hidden;position:relative"><div style="position:absolute;top:40px">IGNORE-DOES-NOT-ESCAPE</div></div>
  <div style="height:0;overflow:hidden"><p>IGNORE-IN-FLOW-CLIPPED</p></div>`,
)

/** The child is pinned visible by nothing but its own rule, and has to stay once the parent is pinned. */
const pinnedParent = doc(
  `<span id="t" class="t">x</span>
  <div class="secret"><span style="visibility:visible">KEEP-VISIBLE-INSIDE-PINNED</span> IGNORE-PINNED-PARENT</div>`,
  `<style>.t{opacity:0} #t:not([style]) ~ .secret{visibility:hidden}</style>`,
)

const movesWithTransition = doc(`<p style="opacity:0;transition:opacity 1s">IGNORE-FADING</p>`)

let browser: Browser
let server: PageServer

async function capture(path: string): Promise<CapturedPageData> {
  const pages = await captureAll({
    browser,
    guard: server.guard('127.0.0.1'),
    startUrls: [`${server.url}${path}`],
    limits: { maxDepth: 0, pageTimeoutMs: TEST_PAGE_TIMEOUT_MS },
  })
  expect(pages).toHaveLength(1)
  return pages[0]
}

const allWords = (html: string, prefix: string) => [...html.matchAll(new RegExp(`${prefix}-[\\w-]+`, 'g'))].map((m) => m[0])

beforeAll(async () => {
  browser = await getBrowser()
  server = await startPageServer({
    ...REAL_CONTENT,
    ...HIDDEN_CONTENT,
    '/toggles': toggles,
    '/clobbered-document': clobberedDocument,
    '/nothing-escapes': nothingEscapes,
    '/pinned-parent': pinnedParent,
    '/moves-with-transition': movesWithTransition,
    '/slot-fallback': doc(`<div><template shadowrootmode="open"><slot>KEEP-SLOT-FALLBACK</slot></template></div>`),
    '/slotted-checkbox': doc(`<div><template shadowrootmode="open"><slot></slot></template><label><input type="checkbox" checked> KEEP-SLOTTED-SETTING</label></div>`),
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
  vi.restoreAllMocks()
})

describe('real content the filter must keep', () => {
  it.each(Object.keys(REAL_CONTENT))('%s', async (path) => {
    const page = await capture(path)

    expect(page.accessStatus).toBe('ok')
    expect(allWords(REAL_CONTENT[path], 'KEEP').filter((word) => !page.text.includes(word))).toEqual([])
  })

  it('keeps fallback content of a slot in the snapshot', async () => {
    const page = await capture('/slot-fallback')
    expect(page.accessibilitySnapshot).toContain('KEEP-SLOT-FALLBACK')
  })

  it('keeps a control slotted into an open shadow root, with its state', async () => {
    const page = await capture('/slotted-checkbox')

    expect(extractControlLines(page.accessibilitySnapshot ?? '')).toBe('checkbox "KEEP-SLOTTED-SETTING" [checked]')
  })

  it('reads the title and the page through a document whose properties are shadowed by named images', async () => {
    const page = await capture('/clobbered-document')

    expect(page.title).toBe('T')
    expect(page.text).toContain('Real words.')
    expect(page.accessStatus).toBe('ok')
  })
})

describe('hidden content the filter must drop', () => {
  it.each(Object.keys(HIDDEN_CONTENT))('%s', async (path) => {
    const page = await capture(path)
    const snapshot = page.accessibilitySnapshot ?? ''

    expect(page.accessStatus).toBe('ok')
    expect(page.text).toContain('Visible words.')
    expect(page.text).not.toMatch(/IGNORE-[\w-]+/)
    expect(snapshot).not.toMatch(/IGNORE-[\w-]+/)
    expect(extractControlLines(snapshot)).not.toMatch(/IGNORE-[\w-]+/)
  })

  it('still hides a clipped child when the wrapper is its containing block, and clipped text in flow', async () => {
    const page = await capture('/nothing-escapes')

    expect(page.text).toContain('Visible words.')
    expect(page.text).not.toMatch(/IGNORE-[\w-]+/)
  })

  it('pins a visibility:hidden parent without losing a visibility:visible child', async () => {
    const page = await capture('/pinned-parent')

    expect(page.text).toContain('KEEP-VISIBLE-INSIDE-PINNED')
    expect(page.text).not.toContain('IGNORE-PINNED-PARENT')
  })

  it('keeps a fade in progress out, since the opacity was 0 when it was read', async () => {
    const page = await capture('/moves-with-transition')
    expect(page.text).not.toContain('IGNORE-FADING')
  })
})

describe('the label exemption', () => {
  it('keeps checkboxes and radios whose label shows text, with their state, named by that text', async () => {
    const page = await capture('/toggles')
    const controlLines = extractControlLines(page.accessibilitySnapshot ?? '')

    expect(controlLines).toContain('checkbox "Share location" [checked]')
    expect(controlLines).toContain('radio "Friends only" [checked]')
    expect(controlLines).toContain('checkbox "Real name" [checked]')
    expect(controlLines).toContain('checkbox "Other name"')
    expect(controlLines).toContain('checkbox "Wrapped toggle" [checked]')
  })

  it('takes aria-label and aria-labelledby away, so the name cannot carry hidden words', async () => {
    const page = await capture('/toggles')
    const controlLines = extractControlLines(page.accessibilitySnapshot ?? '')

    expect(controlLines).not.toContain('IGNORE-ARIA-LABEL')
    expect(controlLines).not.toContain('IGNORE-ARIA-LABELLEDBY')
  })
})

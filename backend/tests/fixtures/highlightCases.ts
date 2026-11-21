import { html } from './pages.js'

export const Q = 'The target quote about teen account privacy sits here.'

const lorem = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>Filler sentence number ${i} says nothing of interest to anyone reading it today.</p>`).join('')
const bare = (n: number) => Array.from({ length: n }, (_, i) => `Filler line ${i} of bare text.<br>`).join('')
const BASE = '<style>body{margin:8px;font:16px/1.5 sans-serif}</style>'
const page = (body: string, head = '') => html('Page', body, BASE + head)

/**
 * What a case must come to. A box on text that is not the quote is never right, so every case
 * allows 'absent' unless it must be found, and 'absent' means the plain page screenshot is used.
 */
export type Expect = 'found' | 'absent' | 'either'

export interface PlacementCase {
  html: string
  quote: string
  expect: Expect
}

const pageCase = (expectation: Expect, body: string, head = '', quote = Q): PlacementCase => ({
  html: page(body, head),
  quote,
  expect: expectation,
})

const FIXED_BAR =
  '<div style="position:fixed;left:0;right:0;bottom:0;background:#222;color:#fff;padding:30px;font-size:18px">We use cookies on this site. Accept all cookies to continue.</div>'
const SCRIM =
  '<div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000"><div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:700px;height:400px;background:#fff;padding:20px">Your privacy choices. By clicking accept you agree that we may share all data with our partners.</div></div>'
const SMALL_DIALOG =
  '<div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:700px;height:200px;background:#fff;border:2px solid #333;box-sizing:border-box;z-index:1000">Choices dialog with other words that are not the quote at all.</div>'
const cell = (text: string, width = 200) => `<td style="width:${width}px">${text}</td>`
const rootCase = (css: string) => pageCase('either', `${lorem(60)}<p>${Q}</p>${lorem(60)}`, `<style>${css}</style>`)

export const PLACEMENT_CASES: Record<string, PlacementCase> = {
  // Something in front of the text.
  'consent-scrim': pageCase('either', `${lorem(40)}<p>${Q}</p>${lorem(40)}${SCRIM}`),
  // At the very end of the page it cannot be scrolled clear of the bar, and then the quote is left out.
  'cookie-bar-at-end': pageCase('either', `${lorem(80)}<p>${Q}</p>${FIXED_BAR}`),
  'cookie-bar-near-end': pageCase('found', `${lorem(80)}<p>${Q}</p>${lorem(3)}${FIXED_BAR}`),
  'dialog-over-centre': pageCase('found', `${lorem(40)}<p>${Q}</p>${lorem(40)}${SMALL_DIALOG}`),
  'sticky-header': pageCase(
    'found',
    `<header style="position:sticky;top:0;background:#ddd;height:60px">STICKY HEADER BAR</header>${lorem(60)}<p>${Q}</p>${lorem(60)}`,
  ),
  'modal-dialog-element': pageCase(
    'either',
    `${lorem(40)}<p>${Q}</p>${lorem(40)}<dialog id="d" style="width:700px;height:400px">Cookie choices in a modal.</dialog><script>document.getElementById('d').showModal()</script>`,
  ),
  'open-popover': pageCase(
    'either',
    `${lorem(40)}<p>${Q}</p>${lorem(40)}<div id="d" popover="manual" style="width:800px;height:420px">Popover banner.</div><script>document.getElementById('d').showPopover()</script>`,
  ),
  // Text that is clipped, or cut short.
  'read-more-box': pageCase(
    'absent',
    `<div style="max-height:48px;overflow:hidden;width:400px">${'Summary text is shown first in the card. '.repeat(4)}${Q} ${'More hidden words after the quote. '.repeat(4)}</div><p style="width:400px">OTHER paragraph about advertising to children, words words words words words words words words words words.</p>`,
  ),
  'overflow-clip': pageCase(
    'absent',
    `<div style="height:48px;overflow:clip;width:400px"><p>${'Summary text is shown first in the card. '.repeat(4)}</p><p>${Q}</p></div><p style="width:400px">OTHER paragraph about advertising to children, words words words words words words words words words words.</p>`,
  ),
  'line-clamp': pageCase(
    'absent',
    `<div style="width:300px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${'Card text repeated to fill the lines. '.repeat(6)}${Q}</div><p style="width:300px">The next card has other words about something else altogether, words words words words words words words.</p>`,
  ),
  ellipsis: pageCase(
    'absent',
    `<div style="display:flex;gap:10px"><div style="width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Q}</div><div>Neighbour column words that are not the quote, sitting to the right of it.</div></div>`,
  ),
  // Scrolling containers.
  'scroller-long-div': pageCase(
    'found',
    `<header style="height:80px">Header words</header><main style="height:300px;overflow:auto;border:1px solid"><div>${Array.from({ length: 200 }, (_, i) => `Line ${i} of a long plain text document.<br>`).join('')}${Q}<br>Line after.<br></div></main><footer style="height:400px">FOOTER legal words stand here, not the quote at all. FOOTER legal words stand here. FOOTER legal words stand here.</footer>`,
  ),
  'scroller-across-blocks': pageCase(
    'either',
    `<main style="height:200px;overflow:auto;border:1px solid"><p>First part of the long quote ends.</p><div style="height:600px"></div><p>Second part of the long quote.</p></main><footer style="height:600px;background:#efe">FOOTER legal words stand here, not the quote at all.</footer>`,
    '',
    'part of the long quote ends. Second part',
  ),
  'wide-table-cells': pageCase(
    'either',
    `<p style="float:right;width:300px">Sidebar text standing at the right of the wide table, totally different words.</p><div style="overflow-x:auto;width:600px;border:1px solid"><table style="width:3000px"><tr>${Array.from({ length: 8 }, (_, i) => cell(`Cell number ${i} words`, 360)).join('')}</tr></table></div>`,
    '',
    'Cell number 0 words Cell number 1 words Cell number 2 words Cell number 3 words',
  ),
  // A quote with a gap in it.
  'gap-between-blocks': pageCase(
    'found',
    `${lorem(30)}<p>Alpha sentence ends right here.</p><figure style="height:900px;margin:0;background:#eef"></figure><p>Beta sentence begins right here.</p>${lorem(30)}`,
    '',
    'ends right here. Beta sentence begins',
  ),
  'two-columns': pageCase(
    'either',
    '<div style="display:grid;grid-template-columns:1fr 1fr"><div style="height:2000px">Left column words end here</div><div style="padding-top:1500px">Right column words begin here</div></div>',
    '',
    'words end here Right column words',
  ),
  // The root of the page changes what fixed means, or what a pixel is.
  'html-transform': rootCase('html{transform:translateZ(0)}'),
  'html-will-change': rootCase('html{will-change:transform}'),
  'html-perspective': rootCase('html{perspective:1000px}'),
  'html-contain-paint': rootCase('html{contain:paint}'),
  'html-zoom-out': rootCase('html{zoom:0.8}'),
  'html-zoom-in': rootCase('html{zoom:1.25}'),
  'quirks-mode-long': {
    html: `<html><head><title>Q</title>${BASE}</head><body>${lorem(60)}<p>${Q}</p>${lorem(60)}</body></html>`,
    quote: Q,
    expect: 'found',
  },
  'quirks-mode-short': { html: `<html><head><title>Q</title>${BASE}</head><body><p>${Q}</p></body></html>`, quote: Q, expect: 'found' },
  // Text that is not on the screen.
  'off-canvas-only': pageCase(
    'absent',
    `<nav style="position:fixed;top:100px;right:-300px;width:300px;padding-left:30px">${Q}</nav><p>Unrelated first paragraph words.</p>${lorem(10)}`,
  ),
  'off-canvas-near-then-visible': pageCase(
    'found',
    `<nav style="position:fixed;top:100px;right:-300px;width:300px;padding-left:30px">${Q}</nav><p>Unrelated first paragraph words.</p><p>${Q}</p>${lorem(10)}`,
  ),
  'straddling-edge-then-visible': pageCase(
    'found',
    `<nav style="position:fixed;top:100px;left:1100px;white-space:nowrap">${Q}</nav><p>Unrelated first paragraph words.</p><p>${Q}</p>${lorem(10)}`,
  ),
  'off-canvas-far-then-visible': pageCase(
    'found',
    `<nav style="position:fixed;top:100px;right:-500px;width:400px">${Q}</nav><p>Unrelated first paragraph words.</p><p>${Q}</p>${lorem(10)}`,
  ),
  // A cover inside the very element that holds the text: it is a descendant, so only the caret can tell.
  'bare-body-text-with-wall': {
    html: `<!doctype html><html><head><title>t</title>${BASE}</head><body>${bare(40)}${Q}<br>${bare(40)}<div style="position:fixed;inset:0;background:#fff;z-index:50;padding:40px">Cookie wall: choose to continue. Nothing else visible.</div></body></html>`,
    quote: Q,
    expect: 'absent',
  },
  'wrapper-text-with-wall': pageCase(
    'absent',
    `<div id="app">${bare(40)}${Q}<br>${bare(40)}<div style="position:fixed;left:10%;right:10%;top:10%;bottom:10%;background:#fff;border:2px solid;z-index:50;padding:40px">Cookie wall: choose to continue.</div></div>`,
  ),
  'wrapper-text-with-blank-wall': pageCase(
    'absent',
    `<div id="app">${bare(40)}${Q}<br>${bare(40)}<div style="position:fixed;inset:0;background:#fff;z-index:50"></div></div>`,
  ),
  // Ordinary text must still be found.
  'keep-link': pageCase('found', `${lorem(20)}<p>Please <a href="#x">${Q}</a> and carry on.</p>${lorem(20)}`),
  'keep-span-background': pageCase('found', `${lorem(20)}<p>Words <span style="background:#fe0;padding:2px 6px">${Q}</span> follow.</p>${lorem(20)}`),
  'keep-label': pageCase('found', `${lorem(20)}<form><label><input type="checkbox"> ${Q}</label></form>${lorem(20)}`),
  'keep-table-cell': pageCase('found', `${lorem(20)}<table><tr><th>Head</th><td>${Q}</td></tr></table>${lorem(20)}`),
  'keep-flex-item': pageCase('found', `${lorem(20)}<div style="display:flex;gap:16px"><div>Left column words.</div><div>${Q}</div></div>${lorem(20)}`),
  'keep-inline-block': pageCase('found', `${lorem(20)}<p>Before <span style="display:inline-block;border:1px solid">${Q}</span> after</p>${lorem(20)}`),
  'keep-wrapping-inline': pageCase('found', `${lorem(20)}<div style="width:140px"><p>An <a href="#x">${Q}</a> then more.</p></div>${lorem(20)}`),
  'keep-bold-in-sentence': pageCase('found', `${lorem(20)}<p>Start of the sentence, then <b>${Q}</b> and the end.</p>${lorem(20)}`),
  'keep-quote-across-bold': pageCase('found', `${lorem(20)}<p>The target quote about <b>teen account</b> privacy sits here.</p>${lorem(20)}`),
  'keep-bare-body-text': {
    html: `<!doctype html><html><head><title>t</title>${BASE}</head><body>${bare(40)}${Q}<br>${bare(40)}</body></html>`,
    quote: Q,
    expect: 'found',
  },
  // Measured: the caret still lands in user-select:none text, so it is found.
  'keep-user-select-none': pageCase('found', `${lorem(20)}<p style="user-select:none">${Q}</p>${lorem(20)}`),
  // The page changes size under the scroll.
  'content-visibility': pageCase(
    'either',
    `<main>${Array.from({ length: 30 }, (_, s) => `<section style="content-visibility:auto;contain-intrinsic-size:auto 2000px">${lorem(s === 25 ? 15 : 30)}${s === 25 ? `<p>${Q}</p>${lorem(15)}` : ''}</section>`).join('')}</main>`,
  ),
}

/** Settings forms are what this feature is mostly about: a select sits between two words. */
export const SETTINGS_FORM = html(
  'Settings',
  `<form><label>Language <select name="l"><option>English</option><option>Deutsch</option></select></label>
  <p>Allow teens to message<select><option>Everyone</option></select>Friends only</p>
  <div>Language<select><option>One</option></select><span>Region</span></div></form>`,
)

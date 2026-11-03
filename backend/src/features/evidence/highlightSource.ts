import { HIGHLIGHT_PADDING_PX } from './config.js'
import { normaliseForMatch } from './quotes.js'

/**
 * Source for the isolated world, run after the visibility filter. It installs
 * `globalThis.__evidenceHighlighter` and returns nothing else.
 *
 * It rebuilds the text a page shows, the way `normaliseForMatch(innerText)` would, but keeps a map
 * from every character back to the text nodes it came from. A quote is found in that string, turned
 * into boxes drawn over the page, and scrolled to the middle of the viewport. The caller then takes
 * the picture and calls `clear`.
 *
 * What the string must reproduce, because quotes were taken from innerText: line breaks between
 * blocks and at <br> (a space once normalised), text-transform, and normalisation applied to each
 * character cluster (NFKC changes length and composes across code points) rather than to the whole.
 *
 * Sent as a source string, not a function, because esbuild's keepNames under `npx tsx` injects a
 * __name helper into functions and the browser does not have it. normaliseForMatch is serialised
 * for the same reason it was written to be: it is the one definition of the rules.
 */
export const HIGHLIGHT_SOURCE = String.raw`(() => {
  const normalise = ${normaliseForMatch.toString()}
  const PADDING = ${HIGHLIGHT_PADDING_PX}

  // A named form field shadows the property of that name on its form, so every DOM read goes
  // through the prototypes.
  const getter = (proto, name) => {
    const { get } = Object.getOwnPropertyDescriptor(proto, name)
    return (target) => get.call(target)
  }
  const method = (proto, name) => {
    const fn = proto[name]
    return (target, ...args) => fn.apply(target, args)
  }
  const dom = {
    nodeType: getter(Node.prototype, 'nodeType'),
    childNodes: getter(Node.prototype, 'childNodes'),
    parentElement: getter(Node.prototype, 'parentElement'),
    appendChild: method(Node.prototype, 'appendChild'),
    data: getter(CharacterData.prototype, 'data'),
    tagName: getter(Element.prototype, 'tagName'),
    shadowRoot: getter(Element.prototype, 'shadowRoot'),
    clientWidth: getter(Element.prototype, 'clientWidth'),
    clientHeight: getter(Element.prototype, 'clientHeight'),
    scrollIntoView: method(Element.prototype, 'scrollIntoView'),
    remove: method(Element.prototype, 'remove'),
    style: getter(HTMLElement.prototype, 'style'),
    setProperty: method(CSSStyleDeclaration.prototype, 'setProperty'),
    root: getter(Document.prototype, 'documentElement'),
    createRange: method(Document.prototype, 'createRange'),
    createElement: method(Document.prototype, 'createElement'),
    selectNodeContents: method(Range.prototype, 'selectNodeContents'),
    setStart: method(Range.prototype, 'setStart'),
    setEnd: method(Range.prototype, 'setEnd'),
    clientRects: method(Range.prototype, 'getClientRects'),
  }
  const root = dom.root(document)
  const range = dom.createRange(document)

  const NOT_PAGE_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE', 'SELECT', 'IFRAME'])
  const WORD_CHAR = /[\p{L}\p{N}]/u
  const WORD_PART = /[\p{L}\p{N}\p{M}_'’]/u
  const isWordChar = (ch) => ch !== undefined && ch !== '' && WORD_CHAR.test(ch)
  const continuesCluster = (ch) => /\p{M}/u.test(ch) || /[ᅠ-ᇿힰ-퟿]/.test(ch)

  const SEPARATOR = { separator: true }
  const atoms = []

  // A lone combining mark has a line box and no width, so only the height can tell it from nothing.
  const isRendered = (node) => {
    dom.selectNodeContents(range, node)
    return Array.from(dom.clientRects(range)).some((r) => r.height > 0)
  }

  const transformed = (ch, mode, startsWord) => {
    if (mode === 'uppercase' || (mode === 'capitalize' && startsWord)) return ch.toUpperCase()
    if (mode === 'lowercase') return ch.toLowerCase()
    return ch
  }

  const addText = (node, parent) => {
    const data = dom.data(node)
    if (/\S/.test(data) && !isRendered(node)) return
    const style = getComputedStyle(parent)
    if (style.visibility !== 'visible') return
    const mode = style.textTransform
    for (let at = 0; at < data.length; ) {
      const ch = String.fromCodePoint(data.codePointAt(at))
      const end = at + ch.length
      const previous = atoms[atoms.length - 1]
      const startsWord = !previous || previous.separator || !WORD_PART.test(previous.ch)
      for (const out of transformed(ch, mode, startsWord)) atoms.push({ ch: out, node, start: at, end })
      at = end
    }
  }

  const isInline = (display) => /^(inline|ruby|contents)/.test(display)

  const walk = (el) => {
    const tag = dom.tagName(el).toUpperCase()
    if (NOT_PAGE_TEXT.has(tag)) return
    const style = getComputedStyle(el)
    if (style.display === 'none') return
    if (tag === 'BR') {
      atoms.push(SEPARATOR)
      return
    }
    const breaksLines = !isInline(style.display)
    if (breaksLines) atoms.push(SEPARATOR)
    const shadow = dom.shadowRoot(el)
    const children = [...(shadow ? Array.from(dom.childNodes(shadow)) : []), ...Array.from(dom.childNodes(el))]
    for (const child of children) {
      const type = dom.nodeType(child)
      if (type === Node.TEXT_NODE) addText(child, el)
      else if (type === Node.ELEMENT_NODE) walk(child)
    }
    if (breaksLines) atoms.push(SEPARATOR)
  }

  // Characters of the normalised text, each pointing at the span of page text it came from.
  const characters = []
  const origins = []
  const push = (ch, origin) => {
    characters.push(ch)
    origins.push(origin)
  }
  const pushSpace = (origin) => {
    if (characters.length > 0 && characters[characters.length - 1] !== ' ') push(' ', origin)
  }

  const build = () => {
    walk(root)
    for (let at = 0; at < atoms.length; ) {
      const first = atoms[at]
      if (first.separator) {
        pushSpace(null)
        at += 1
        continue
      }
      let next = at + 1
      const isSpace = /\s/.test(first.ch)
      while (!isSpace && next < atoms.length && !atoms[next].separator && continuesCluster(atoms[next].ch)) next += 1
      const last = atoms[next - 1]
      const origin = { startNode: first.node, startOffset: first.start, endNode: last.node, endOffset: last.end }
      if (isSpace) {
        pushSpace(origin)
      } else {
        const cluster = atoms.slice(at, next).map((atom) => atom.ch).join('')
        // The sentinels keep the trim from eating a space the cluster turns into, and nothing composes with them.
        for (const ch of normalise('|' + cluster + '|').slice(1, -1)) {
          if (/\s/.test(ch)) pushSpace(origin)
          else push(ch, origin)
        }
      }
      at = next
    }
    while (characters.length > 0 && characters[characters.length - 1] === ' ') {
      characters.pop()
      origins.pop()
    }
  }
  build()
  const text = characters.join('')

  // The same rule as isQuoteVerified: every occurrence is checked, and it must sit on word boundaries.
  const find = (quote) => {
    const wanted = normalise(quote)
    if (wanted === '') return null
    for (let from = 0; ; ) {
      const at = text.indexOf(wanted, from)
      if (at === -1) return null
      const before = at > 0 ? text[at - 1] : undefined
      const after = text[at + wanted.length]
      const startOk = !isWordChar(before) || !isWordChar(wanted[0])
      const endOk = !isWordChar(after) || !isWordChar(wanted[wanted.length - 1])
      if (startOk && endOk) return [at, at + wanted.length]
      from = at + 1
    }
  }

  // The parts of each text node the span covers, in page order.
  const segmentsOf = ([from, to]) => {
    const segments = new Map()
    const add = (node, start, end) => {
      const known = segments.get(node)
      segments.set(node, known ? [Math.min(known[0], start), Math.max(known[1], end)] : [start, end])
    }
    for (let at = from; at < to; at += 1) {
      const o = origins[at]
      if (!o) continue
      if (o.startNode === o.endNode) {
        add(o.startNode, o.startOffset, o.endOffset)
      } else {
        add(o.startNode, o.startOffset, dom.data(o.startNode).length)
        add(o.endNode, 0, o.endOffset)
      }
    }
    return segments
  }

  const rectsOf = (segments) => {
    const rects = []
    for (const [node, [start, end]] of segments) {
      dom.setStart(range, node, start)
      dom.setEnd(range, node, end)
      for (const r of dom.clientRects(range)) {
        if (r.width > 0 && r.height > 0) rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      }
    }
    return rects
  }

  const boundsOf = (rects) => ({
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  })

  const viewport = () => ({ width: dom.clientWidth(root), height: dom.clientHeight(root) })
  const INSTANT = 'instant'

  const scrollToMiddle = (segments) => {
    const parent = dom.parentElement(segments.keys().next().value)
    if (parent) dom.scrollIntoView(parent, { block: 'center', inline: 'center', behavior: INSTANT })
    const rects = rectsOf(segments)
    if (rects.length === 0) return
    const b = boundsOf(rects)
    const { width, height } = viewport()
    scrollBy({ left: (b.left + b.right - width) / 2, top: (b.top + b.bottom - height) / 2, behavior: INSTANT })
  }

  const overlays = []
  const draw = (rect) => {
    const box = dom.createElement(document, 'div')
    const style = dom.style(box)
    const set = (name, value) => dom.setProperty(style, name, value, 'important')
    set('all', 'initial')
    set('display', 'block')
    set('position', 'fixed')
    set('box-sizing', 'border-box')
    set('left', rect.left + 'px')
    set('top', rect.top + 'px')
    set('width', rect.right - rect.left + 'px')
    set('height', rect.bottom - rect.top + 'px')
    set('background', 'rgba(255, 235, 0, 0.35)')
    set('border', '2px solid #ff3b00')
    set('z-index', '2147483647')
    set('pointer-events', 'none')
    dom.appendChild(root, box)
    overlays.push(box)
  }

  const clear = () => {
    for (const box of overlays.splice(0)) dom.remove(box)
  }

  // The area to photograph, in page coordinates, or null when none of the quote is in view.
  const show = (quote) => {
    clear()
    const span = find(quote)
    if (!span) return null
    const segments = segmentsOf(span)
    if (segments.size === 0) return null
    scrollToMiddle(segments)
    const rects = rectsOf(segments)
    if (rects.length === 0) return null
    const b = boundsOf(rects)
    const { width, height } = viewport()
    const x0 = Math.max(0, Math.floor(b.left - PADDING))
    const y0 = Math.max(0, Math.floor(b.top - PADDING))
    const x1 = Math.min(width, Math.ceil(b.right + PADDING))
    const y1 = Math.min(height, Math.ceil(b.bottom + PADDING))
    if (x1 <= x0 || y1 <= y0) return null
    rects.forEach(draw)
    return { x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0 }
  }

  globalThis.__evidenceHighlighter = { show, clear, builtText: () => text }
})()`

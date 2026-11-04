import { HIGHLIGHT_MAX_OCCURRENCES, HIGHLIGHT_PADDING_PX } from './config.js'
import { normaliseForMatch } from './quotes.js'

/**
 * Source for the isolated world, run after DECIDE_HIDDEN_SOURCE. It installs
 * `globalThis.__evidenceHighlighter` and returns nothing else.
 *
 * It rebuilds the text a page shows, the way `normaliseForMatch(innerText)` would, but keeps a map
 * from every character back to the text nodes it came from. A quote is found in that string and its
 * boxes are drawn over the page. The caller then takes the picture and calls `clear`.
 *
 * What the string must reproduce, because quotes were taken from innerText: line breaks between
 * blocks and at <br> (a space once normalised), text-transform, and normalisation applied to each
 * character cluster (NFKC changes length and composes across code points) rather than to the whole.
 * What the filter decided to hide is skipped, not edited: the page must stay as it was.
 *
 * A box is only drawn where it can be checked. The rects of a text range ignore clipping and
 * anything in front of the text, so each is hit-tested with elementFromPoint (the hit must be the
 * text's own element or inside it), and each overlay is read back and tested to be the topmost
 * thing at its centre. A placement that fails is retried with the quote higher and then lower on
 * the screen, then with the quote's next occurrence, and then the quote is left out. A quote left
 * out is a designed outcome; a box on other words is not.
 *
 * Sent as a source string, not a function, because esbuild's keepNames under `npx tsx` injects a
 * __name helper into functions and the browser does not have it. normaliseForMatch is serialised
 * for the same reason it was written to be: it is the one definition of the rules.
 */
export const HIGHLIGHT_SOURCE = String.raw`(() => {
  const normalise = ${normaliseForMatch.toString()}
  const PADDING = ${HIGHLIGHT_PADDING_PX}
  const MAX_OCCURRENCES = ${HIGHLIGHT_MAX_OCCURRENCES}
  // Where on the screen the quote goes, as a fraction of its height: the middle, then high, then low.
  const SCREEN_POSITIONS = [0.5, 0.33, 0.67]
  const TOLERANCE_PX = 1

  // A named form field shadows the property of that name on its form, so every DOM read goes
  // through the prototypes.
  const getter = (proto, name) => {
    const { get } = Object.getOwnPropertyDescriptor(proto, name)
    return (target) => get.call(target)
  }
  const setter = (proto, name) => {
    const { set } = Object.getOwnPropertyDescriptor(proto, name)
    return (target, value) => set.call(target, value)
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
    contains: method(Node.prototype, 'contains'),
    data: getter(CharacterData.prototype, 'data'),
    tagName: getter(Element.prototype, 'tagName'),
    scrollTop: getter(Element.prototype, 'scrollTop'),
    setScrollTop: setter(Element.prototype, 'scrollTop'),
    scrollLeft: getter(Element.prototype, 'scrollLeft'),
    setScrollLeft: setter(Element.prototype, 'scrollLeft'),
    scrollHeight: getter(Element.prototype, 'scrollHeight'),
    clientHeight: getter(Element.prototype, 'clientHeight'),
    scrollWidth: getter(Element.prototype, 'scrollWidth'),
    clientWidth: getter(Element.prototype, 'clientWidth'),
    rect: method(Element.prototype, 'getBoundingClientRect'),
    remove: method(Element.prototype, 'remove'),
    style: getter(HTMLElement.prototype, 'style'),
    setProperty: method(CSSStyleDeclaration.prototype, 'setProperty'),
    root: getter(Document.prototype, 'documentElement'),
    body: getter(Document.prototype, 'body'),
    createRange: method(Document.prototype, 'createRange'),
    createElement: method(Document.prototype, 'createElement'),
    elementFromPoint: method(Document.prototype, 'elementFromPoint'),
    selectNodeContents: method(Range.prototype, 'selectNodeContents'),
    setStart: method(Range.prototype, 'setStart'),
    setEnd: method(Range.prototype, 'setEnd'),
    clientRects: method(Range.prototype, 'getClientRects'),
  }
  const root = dom.root(document)
  const body = dom.body(document)
  const range = dom.createRange(document)
  const hidden = globalThis.__evidenceHidden || { elements: new Set(), textNodes: new Set() }

  const NOT_PAGE_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE'])
  // Replaced elements that sit between words and whose contents innerText leaves out.
  const LEFT_OUT_BUT_BETWEEN_WORDS = new Set(['SELECT', 'TEXTAREA', 'IFRAME'])
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
    if (hidden.textNodes.has(node)) return
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

  // Shadow roots are not walked: their text is not in innerText, so it cannot be in a quote.
  // Slotted text is light DOM, and is rendered where its slot is.
  const walk = (el) => {
    if (hidden.elements.has(el)) return
    const tag = dom.tagName(el).toUpperCase()
    if (NOT_PAGE_TEXT.has(tag)) return
    const style = getComputedStyle(el)
    if (style.display === 'none') return
    if (tag === 'BR' || LEFT_OUT_BUT_BETWEEN_WORDS.has(tag)) {
      atoms.push(SEPARATOR)
      return
    }
    const breaksLines = !isInline(style.display)
    if (breaksLines) atoms.push(SEPARATOR)
    for (const child of Array.from(dom.childNodes(el))) {
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

  // The same rule as isQuoteVerified: it must sit on word boundaries. Every occurrence that does is returned.
  const findAll = (quote) => {
    const wanted = normalise(quote)
    const found = []
    if (wanted === '') return found
    for (let from = 0; found.length < MAX_OCCURRENCES; ) {
      const at = text.indexOf(wanted, from)
      if (at === -1) break
      const before = at > 0 ? text[at - 1] : undefined
      const after = text[at + wanted.length]
      const startOk = !isWordChar(before) || !isWordChar(wanted[0])
      const endOk = !isWordChar(after) || !isWordChar(wanted[wanted.length - 1])
      if (startOk && endOk) found.push([at, at + wanted.length])
      from = at + 1
    }
    return found
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

  // Each rect keeps the text node it came from, because that is what it must be checked against.
  const rectsOf = (segments) => {
    const rects = []
    for (const [node, [start, end]] of segments) {
      dom.setStart(range, node, start)
      dom.setEnd(range, node, end)
      for (const r of dom.clientRects(range)) {
        if (r.width > 0 && r.height > 0) rects.push({ node, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
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

  const inViewPart = (r) => ({
    node: r.node,
    left: Math.max(0, r.left),
    top: Math.max(0, r.top),
    right: Math.min(innerWidth, r.right),
    bottom: Math.min(innerHeight, r.bottom),
  })
  const hasArea = (r) => r.right - r.left > 0 && r.bottom - r.top > 0
  const isEntirelyInView = (r) =>
    r.left >= -TOLERANCE_PX && r.top >= -TOLERANCE_PX && r.right <= innerWidth + TOLERANCE_PX && r.bottom <= innerHeight + TOLERANCE_PX

  // Nested scrollers that a person could scroll, innermost first.
  const scrollersAround = (node) => {
    const found = []
    for (let el = dom.parentElement(node); el && el !== root && el !== body; el = dom.parentElement(el)) {
      const { overflowX, overflowY } = getComputedStyle(el)
      const scrollsY = /auto|scroll/.test(overflowY) && dom.scrollHeight(el) > dom.clientHeight(el)
      const scrollsX = /auto|scroll/.test(overflowX) && dom.scrollWidth(el) > dom.clientWidth(el)
      if (scrollsY || scrollsX) found.push([el, scrollsX, scrollsY])
    }
    return found
  }

  const centreInScrollers = (segments) => {
    const first = rectsOf(segments)[0]
    if (!first) return
    for (const [scroller, scrollsX, scrollsY] of scrollersAround(first.node)) {
      const at = rectsOf(segments)[0]
      const box = dom.rect(scroller)
      if (scrollsY) dom.setScrollTop(scroller, dom.scrollTop(scroller) + (at.top + at.bottom - box.top - box.bottom) / 2)
      if (scrollsX) dom.setScrollLeft(scroller, dom.scrollLeft(scroller) + (at.left + at.right - box.left - box.right) / 2)
    }
  }

  // A quote that fits is centred as a whole. One that is too tall, or has a gap in it, has its first line placed.
  const scrollToPosition = (segments, position) => {
    centreInScrollers(segments)
    const rects = rectsOf(segments)
    if (rects.length === 0) return
    const b = boundsOf(rects)
    const fits = b.bottom - b.top <= innerHeight * 0.8
    const anchorY = fits ? (b.top + b.bottom) / 2 : rects[0].top
    const targetY = innerHeight * (fits ? position : position * 0.6)
    const first = rects[0]
    const isAcross = first.left < 0 || first.right > innerWidth
    const left = isAcross ? (first.left + first.right - innerWidth) / 2 : 0
    scrollBy({ left, top: anchorY - targetY, behavior: 'instant' })
  }

  // The text's own element, or something inside it, is what is painted at the point.
  const isTextAt = (r, x, y) => {
    const owner = dom.parentElement(r.node)
    const hit = dom.elementFromPoint(document, x, y)
    return Boolean(owner && hit && (hit === owner || dom.contains(owner, hit)))
  }
  const isPaintedAsText = (r) => {
    const v = inViewPart(r)
    const middle = (v.top + v.bottom) / 2
    const edge = Math.min(2, (v.right - v.left) / 2)
    return [(v.left + v.right) / 2, v.left + edge, v.right - edge].every((x) => isTextAt(r, x, middle))
  }

  const overlays = []
  const clear = () => {
    for (const { box } of overlays.splice(0)) dom.remove(box)
  }

  const close = (a, b) => Math.abs(a - b) <= TOLERANCE_PX
  const matches = (actual, expected) =>
    close(actual.left, expected.left) && close(actual.top, expected.top) && close(actual.right, expected.right) && close(actual.bottom, expected.bottom)

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
    // On while it is being checked, since scripts are off and nothing reacts, and off after.
    set('pointer-events', 'auto')
    dom.appendChild(root, box)
    overlays.push({ box, rect })
  }

  // Drawn where it was meant to be, and nothing is in front of it.
  const overlaysAreOnTop = () =>
    overlays.every(({ box, rect }) => {
      const at = dom.rect(box)
      return matches(at, rect) && dom.elementFromPoint(document, (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2) === box
    })

  const settleOverlays = () => {
    for (const { box } of overlays) dom.setProperty(dom.style(box), 'pointer-events', 'none', 'important')
  }

  const placement = (parts) => {
    const b = boundsOf(parts)
    const x0 = Math.max(0, Math.floor(b.left - PADDING))
    const y0 = Math.max(0, Math.floor(b.top - PADDING))
    const x1 = Math.min(innerWidth, Math.ceil(b.right + PADDING))
    const y1 = Math.min(innerHeight, Math.ceil(b.bottom + PADDING))
    if (x1 <= x0 || y1 <= y0) return null
    return {
      clip: { x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0 },
      boxes: parts.map((p) => ({ left: p.left, top: p.top, right: p.right, bottom: p.bottom })),
      scroll: { x: scrollX, y: scrollY },
    }
  }

  let current = null

  const tryPlace = (segments, position) => {
    scrollToPosition(segments, position)
    const rects = rectsOf(segments)
    if (rects.length === 0 || !isEntirelyInView(rects[0])) return null
    const seen = rects.filter((r) => hasArea(inViewPart(r)))
    if (!seen.every(isPaintedAsText)) return null
    const parts = seen.map(inViewPart)
    parts.forEach(draw)
    if (!overlaysAreOnTop()) return null
    settleOverlays()
    const made = placement(parts)
    if (made) current = { segments, parts, made }
    return made
  }

  // The area to photograph, with its boxes, or null when the quote cannot be shown for what it is.
  const show = (quote) => {
    clear()
    current = null
    for (const span of findAll(quote)) {
      const segments = segmentsOf(span)
      if (segments.size === 0) continue
      for (const position of SCREEN_POSITIONS) {
        const made = tryPlace(segments, position)
        if (made) return made
        clear()
      }
    }
    return null
  }

  // After the picture: nothing may have moved since the placement, or the picture is of something else.
  const stillPlaced = () => {
    if (!current) return false
    const { segments, parts, made } = current
    if (scrollX !== made.scroll.x || scrollY !== made.scroll.y) return false
    const now = rectsOf(segments).map(inViewPart).filter(hasArea)
    return now.length === parts.length && now.every((r, i) => matches(r, parts[i])) && overlays.every(({ box, rect }) => matches(dom.rect(box), rect))
  }

  globalThis.__evidenceHighlighter = { show, clear, stillPlaced, builtText: () => text }
})()`

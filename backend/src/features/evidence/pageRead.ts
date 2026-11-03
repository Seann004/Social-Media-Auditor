import type { Page } from 'playwright'
import { z } from 'zod'
import { isTimeoutError } from './browser.js'
import { logCaptureFailure } from './captureLog.js'

export interface PageContent {
  title: string
  text: string
  hasPasswordField: boolean
  links: string[]
  accessibilitySnapshot: string | null
}

/**
 * Hides what a person cannot see, then reads the page, all in one go. This is a heuristic against
 * accidental and lazy hidden text, not a defence against a determined page (ruling R17). Text
 * treated as data and the auditor's decision are the backstop. Keeping real text matters more
 * than catching one more trick, so accepted residuals include white-on-white, aria-hidden,
 * aria-label on a visible control, `filter:opacity(0)`, masks, nested opacity products, tiny
 * scales, small overflow boxes, and in-flow text in a collapsed wrapper with an escaping child.
 *
 * Sent as a source string, not a function: esbuild's keepNames under `npx tsx` can inject a
 * __name helper into functions, and the helper does not exist in the browser.
 *
 * Text is judged per text node, by the style that paints it, because a child can undo what its
 * parent does to colour or font size: `font-size:0` on a row with sized children is a common
 * layout trick. Opacity and clipping apply to a whole subtree, so those hide the element. An
 * element with no visible area of its own stays if anything inside it is visible, as with
 * `display:contents` or a zero-height parent of floats.
 *
 * Every element is read before anything is edited, because an edit can change what a selector
 * matches. `display:none` and `visibility:hidden` are then pinned inline first, so that no later
 * edit can reveal them. A `visibility:visible` child keeps its own value.
 *
 * For an element with no box innerText falls back to textContent, so a wholly hidden body is
 * ruled out at the end.
 */
const READ_PAGE_SOURCE = String.raw`(() => {
  // A named form field shadows the property of that name on its form, so every DOM read and write
  // goes through the prototypes. Otherwise an input called "style" could cost a real page.
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
    contains: method(Node.prototype, 'contains'),
    data: getter(CharacterData.prototype, 'data'),
    replaceWith: method(CharacterData.prototype, 'replaceWith'),
    tagName: getter(Element.prototype, 'tagName'),
    shadowRoot: getter(Element.prototype, 'shadowRoot'),
    rect: method(Element.prototype, 'getBoundingClientRect'),
    checkVisibility: method(Element.prototype, 'checkVisibility'),
    querySelectorAll: method(Element.prototype, 'querySelectorAll'),
    removeAttribute: method(Element.prototype, 'removeAttribute'),
    offsetParent: getter(HTMLElement.prototype, 'offsetParent'),
    innerText: getter(HTMLElement.prototype, 'innerText'),
    inputType: getter(HTMLInputElement.prototype, 'type'),
    inputLabels: getter(HTMLInputElement.prototype, 'labels'),
    detailsOpen: getter(HTMLDetailsElement.prototype, 'open'),
    assignedNodes: method(HTMLSlotElement.prototype, 'assignedNodes'),
    anchorHref: getter(HTMLAnchorElement.prototype, 'href'),
  }
  const documentDom = {
    root: getter(Document.prototype, 'documentElement'),
    body: getter(Document.prototype, 'body'),
    title: getter(Document.prototype, 'title'),
    createRange: method(Document.prototype, 'createRange'),
    createElementNS: method(Document.prototype, 'createElementNS'),
    querySelector: method(Document.prototype, 'querySelector'),
    querySelectorAll: method(Document.prototype, 'querySelectorAll'),
  }
  const inlineStyleGetters = [HTMLElement, SVGElement, MathMLElement].map((type) => [type, getter(type.prototype, 'style')])
  const inlineStyleOf = (el) => {
    const found = inlineStyleGetters.find(([type]) => el instanceof type)
    return found ? found[1](el) : null
  }
  const tagOf = (el) => dom.tagName(el).toUpperCase()

  const MIN_ALPHA = 0.05
  const MIN_FONT_PX = 1
  const NOT_PAGE_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE'])
  const NO_BOX_OF_THEIR_OWN = new Set(['BR', 'WBR'])

  // What to do, decided while the page is untouched. Any edit can change what a selector matches.
  const hiddenByDisplay = []
  const hiddenByVisibility = []
  const elementsToHide = []
  const textNodesToHide = []
  const togglesToRename = []

  const range = documentDom.createRange(document)
  const root = documentDom.root(document)
  const body = documentDom.body(document)
  const clipsSideways = [root, body].some((el) => el && /hidden|clip/.test(getComputedStyle(el).overflowX))
  const rightEdge = innerWidth * (clipsSideways ? 1 : 3)

  const isOffPage = (r) => r.right + scrollX <= 0 || r.bottom + scrollY <= 0 || r.left + scrollX >= rightEdge
  const hasVisibleArea = (r) => r.width > 0 && r.height > 0 && !isOffPage(r)

  const alphaOf = (color) => {
    const match = /(?:^rgba\(.*,\s*|\/\s*)([\d.eE+-]+)\)$/.exec(color)
    return match ? parseFloat(match[1]) : 1
  }
  const canBeSeen = (color) => alphaOf(color) >= MIN_ALPHA

  // Paint that shows the text in spite of a transparent fill, if it can be seen itself.
  const colorsIn = (value) => value.match(/[a-z-]+\([^)]*\)/g) || []
  const paintsNoInk = (style) => {
    if (canBeSeen(style.webkitTextFillColor)) return false
    if (colorsIn(style.textShadow).some(canBeSeen)) return false
    if (parseFloat(style.webkitTextStrokeWidth) > 0 && canBeSeen(style.webkitTextStrokeColor)) return false
    const backgroundShowsThrough = style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text'
    return !(backgroundShowsThrough && (style.backgroundImage !== 'none' || canBeSeen(style.backgroundColor)))
  }

  const lengthIn = (value, size) => (value.endsWith('%') ? (parseFloat(value) / 100) * size : parseFloat(value))

  const clipRectIsEmpty = (rect, clip) => {
    const match = /^rect\((.*)\)$/.exec(clip)
    if (!match) return false
    const edges = match[1].split(/[\s,]+/)
    const edge = (value, ifAuto) => (value === 'auto' ? ifAuto : parseFloat(value))
    const [top, right, bottom, left] = [edge(edges[0], 0), edge(edges[1], rect.width), edge(edges[2], rect.height), edge(edges[3], 0)]
    return bottom <= top || right <= left
  }

  const insetIsEmpty = (rect, clipPath) => {
    const match = /^inset\(([^)]*?)(?:\s+round\b[^)]*)?\)$/.exec(clipPath)
    if (!match) return false
    const [top, right = top, bottom = top, left = right] = match[1].trim().split(/\s+/)
    return (
      lengthIn(top, rect.height) + lengthIn(bottom, rect.height) >= rect.height ||
      lengthIn(left, rect.width) + lengthIn(right, rect.width) >= rect.width
    )
  }

  const isClipped = (rect, style) =>
    ((style.position === 'absolute' || style.position === 'fixed') && clipRectIsEmpty(rect, style.clip)) ||
    insetIsEmpty(rect, style.clipPath) ||
    /^circle\(0(px|%)?(\s|\))/.test(style.clipPath)

  // A clip only reaches what it contains: a fixed child, or an absolute child whose containing block is outside.
  const escapesClipOf = (wrapper, el) => {
    if (!(el instanceof HTMLElement) || !dom.checkVisibility(el)) return false
    const { position } = getComputedStyle(el)
    if (position === 'fixed') return true
    if (position !== 'absolute') return false
    const containingBlock = dom.offsetParent(el)
    return !containingBlock || !dom.contains(wrapper, containingBlock)
  }
  const hasChildEscapingClip = (el) => Array.from(dom.querySelectorAll(el, '*')).some((inside) => escapesClipOf(el, inside))

  // Overflow set on the root or the body applies to the viewport, so it clips nothing at their own size.
  const isCollapsed = (el, rect, style) =>
    el !== root &&
    el !== body &&
    style.display !== 'inline' &&
    ((rect.width <= 1 && style.overflowX !== 'visible') || (rect.height <= 1 && style.overflowY !== 'visible')) &&
    !hasChildEscapingClip(el)

  // Inside a closed details element, for one. A display:contents element has no box, but its children do.
  const isSkippedByBrowser = (el, style) => style.display !== 'contents' && !dom.checkVisibility(el)

  const hidesSubtree = (el, rect, style) =>
    parseFloat(style.opacity) < MIN_ALPHA || isClipped(rect, style) || isCollapsed(el, rect, style) || isSkippedByBrowser(el, style)

  const isShownText = (node, parent, tag, style) => {
    // Text directly in a closed details element still measures, though it is not shown.
    if (tag === 'DETAILS' && !dom.detailsOpen(parent)) return false
    if (isSkippedByBrowser(parent, style) || parseFloat(style.fontSize) < MIN_FONT_PX || paintsNoInk(style)) return false
    range.selectNodeContents(node)
    return hasVisibleArea(range.getBoundingClientRect())
  }

  const hasWords = (node) => /\S/.test(dom.data(node))

  const showsWords = (el) => {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility !== 'visible') return false
    const tag = tagOf(el)
    return Array.from(dom.childNodes(el)).some((child) => {
      const type = dom.nodeType(child)
      if (type === Node.ELEMENT_NODE) return showsWords(child)
      return type === Node.TEXT_NODE && hasWords(child) && !NOT_PAGE_TEXT.has(tag) && isShownText(child, el, tag, style)
    })
  }

  const isVisibleLabel = (label) => {
    const rect = dom.rect(label)
    return (
      dom.checkVisibility(label, { opacityProperty: true, visibilityProperty: true }) &&
      hasVisibleArea(rect) &&
      !hidesSubtree(label, rect, getComputedStyle(label)) &&
      showsWords(label)
    )
  }

  // A checkbox or radio hidden on purpose, with a label that shows words, is how most custom
  // toggles are built, and their on or off state is the evidence the snapshot exists for.
  const isLabelledToggle = (el) =>
    el instanceof HTMLInputElement &&
    /^(checkbox|radio)$/.test(dom.inputType(el)) &&
    Array.from(dom.inputLabels(el) || []).some(isVisibleLabel)

  const visitText = (node, parent, tag, style) => {
    if (!hasWords(node) || NOT_PAGE_TEXT.has(tag)) return false
    const shown = isShownText(node, parent, tag, style)
    if (!shown) textNodesToHide.push(node)
    return shown
  }

  const visit = (el) => {
    const style = getComputedStyle(el)
    if (style.display === 'none') {
      hiddenByDisplay.push(el)
      return false
    }
    if (style.visibility !== 'visible') hiddenByVisibility.push([el, style.visibility])

    const tag = tagOf(el)
    const shadow = dom.shadowRoot(el)
    // A closed select's options have no boxes, and they hold its value.
    const lightChildren = tag === 'SELECT' ? [] : Array.from(dom.childNodes(el))
    const shadowChildren = shadow ? Array.from(dom.childNodes(shadow)) : []
    let somethingShownInside = false
    for (const child of [...shadowChildren, ...lightChildren]) {
      const type = dom.nodeType(child)
      const shown = type === Node.TEXT_NODE ? visitText(child, el, tag, style) : type === Node.ELEMENT_NODE && visit(child)
      somethingShownInside = shown || somethingShownInside
    }

    // No box, so nothing of its own to hide. A slot shows what is assigned to it, which is visited under its host.
    if (style.display === 'contents') {
      return somethingShownInside || (el instanceof HTMLSlotElement && dom.assignedNodes(el).length > 0)
    }

    const rect = dom.rect(el)
    if (!hidesSubtree(el, rect, style) && (somethingShownInside || hasVisibleArea(rect))) return true
    if (NO_BOX_OF_THEIR_OWN.has(tag)) return false
    if (isLabelledToggle(el)) {
      togglesToRename.push(el)
      return true
    }
    elementsToHide.push(el)
    return false
  }

  // A transition outranks !important, so it has to go wherever something is pinned.
  const pin = (el, property, value) => {
    const inline = inlineStyleOf(el)
    if (!inline) return
    inline.setProperty('transition', 'none', 'important')
    inline.setProperty(property, value, 'important')
  }

  visit(root)

  // What is hidden already goes first, so that no later edit can reveal it through a selector.
  for (const el of hiddenByDisplay) pin(el, 'display', 'none')
  for (const [el, value] of hiddenByVisibility) pin(el, 'visibility', value)
  for (const el of elementsToHide) pin(el, 'display', 'none')
  for (const node of textNodesToHide) {
    const wrapper = documentDom.createElementNS(document, 'http://www.w3.org/1999/xhtml', 'span')
    pin(wrapper, 'display', 'none')
    dom.replaceWith(node, wrapper)
    wrapper.append(node)
  }
  // The name then comes from the label that showed words.
  for (const el of togglesToRename) {
    dom.removeAttribute(el, 'aria-label')
    dom.removeAttribute(el, 'aria-labelledby')
  }

  return {
    title: documentDom.title(document),
    text: body instanceof HTMLElement && dom.checkVisibility(body, { opacityProperty: true }) ? dom.innerText(body) : '',
    hasPasswordField: documentDom.querySelector(document, 'input[type="password"]') !== null,
    links: Array.from(documentDom.querySelectorAll(document, 'a[href]'))
      .filter((anchor) => anchor instanceof HTMLAnchorElement)
      .map((anchor) => dom.anchorHref(anchor)),
  }
})()`

const pageContentSchema = z.object({
  title: z.string(),
  text: z.string(),
  hasPasswordField: z.boolean(),
  links: z.array(z.string()),
})

async function readSnapshot(page: Page, timeoutMs: number): Promise<string | null> {
  try {
    return await page.ariaSnapshot({ timeout: timeoutMs })
  } catch (err) {
    if (isTimeoutError(err)) throw err
    logCaptureFailure('Could not read the accessibility snapshot', page.url(), err)
    return null
  }
}

/**
 * Reads the page from an isolated world, whose native functions the page's own scripts cannot
 * replace, so a script cannot forge the text. Two things still reach an isolated world. A named
 * form field shadows the property of that name on its form, which is why the source reads through
 * the prototypes. And CSS applies in every world, which is why the filter is only a heuristic.
 *
 * Page scripts are switched off first: the filter and the read happen in one step, but the snapshot
 * is a separate one, and a script could undo the hiding in between. That stops timers and observers.
 * It does not stop a promise continuation already in progress, which is an accepted residual (R17).
 * So take the screenshot first, and close the page after.
 */
export async function readPageContent(page: Page, timeoutMs: number): Promise<PageContent> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true })
  const { frameTree } = await cdp.send('Page.getFrameTree')
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: 'evidence-capture',
  })
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: READ_PAGE_SOURCE,
    contextId: executionContextId,
    returnByValue: true,
  })
  if (exceptionDetails) {
    throw new Error(`The page read failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
  }
  const content = pageContentSchema.parse(result.value)
  const accessibilitySnapshot = await readSnapshot(page, timeoutMs)
  return { ...content, accessibilitySnapshot }
}

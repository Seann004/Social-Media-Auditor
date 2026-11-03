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
 * Hides what a person cannot see, then reads the page, all in one go.
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
 * `display:none` and `visibility:hidden` are left alone: neither innerText nor the snapshot
 * includes them, and hiding a `visibility:hidden` parent would remove a `visibility:visible` child.
 *
 * A form control hidden on purpose but with a visible label stays: that is how most custom toggles
 * are built, and their on or off state is the evidence the snapshot exists for.
 *
 * For an element with no box innerText falls back to textContent, so a wholly hidden body is
 * ruled out at the end. White-on-white and aria-hidden text stay captured, by ruling R13.
 */
const READ_PAGE_SOURCE = String.raw`(() => {
  const MIN_ALPHA = 0.05
  const MIN_FONT_PX = 1
  const NOT_PAGE_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE'])
  const NO_BOX_OF_THEIR_OWN = new Set(['BR', 'WBR'])
  const hiddenElements = []
  const hiddenTextNodes = []
  const range = document.createRange()

  const root = document.documentElement
  const clipsSideways = [root, document.body].some((el) => el && /hidden|clip/.test(getComputedStyle(el).overflowX))
  const rightEdge = innerWidth * (clipsSideways ? 1 : 3)

  const isOffPage = (r) => r.right + scrollX <= 0 || r.bottom + scrollY <= 0 || r.left + scrollX >= rightEdge
  const hasVisibleArea = (r) => r.width > 0 && r.height > 0 && !isOffPage(r)

  const alphaOf = (color) => {
    const match = /(?:^rgba\(.*,\s*|\/\s*)([\d.]+)\)$/.exec(color)
    return match ? parseFloat(match[1]) : 1
  }

  const isClipped = (style) => {
    if (style.position === 'absolute' || style.position === 'fixed') {
      const rect = /^rect\((-?[\d.]+)px,?\s*(-?[\d.]+)px,?\s*(-?[\d.]+)px,?\s*(-?[\d.]+)px\)$/.exec(style.clip)
      if (rect && (Number(rect[3]) <= Number(rect[1]) || Number(rect[2]) <= Number(rect[4]))) return true
    }
    const inset = /^inset\(([\d.]+)%\)$/.exec(style.clipPath)
    return inset !== null && parseFloat(inset[1]) >= 50
  }

  const clipsOverflow = (value) => value !== 'visible'

  const isCollapsed = (rect, style) =>
    style.display !== 'contents' &&
    style.display !== 'inline' &&
    ((rect.width <= 1 && clipsOverflow(style.overflowX)) || (rect.height <= 1 && clipsOverflow(style.overflowY)))

  // Inside a closed details element, for one. A display:contents element has no box, but its children do.
  const isSkippedByBrowser = (el, style) => style.display !== 'contents' && !el.checkVisibility()

  const hidesSubtree = (el, rect, style) =>
    parseFloat(style.opacity) < MIN_ALPHA || isClipped(style) || isCollapsed(rect, style) || isSkippedByBrowser(el, style)

  const paintsNoInk = (style) =>
    alphaOf(style.webkitTextFillColor) < MIN_ALPHA &&
    style.backgroundClip !== 'text' &&
    style.webkitBackgroundClip !== 'text' &&
    style.textShadow === 'none' &&
    parseFloat(style.webkitTextStrokeWidth) === 0

  const hasVisibleLabel = (el) =>
    Array.from(el.labels || []).some((label) => {
      const rect = label.getBoundingClientRect()
      return (
        label.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
        hasVisibleArea(rect) &&
        !hidesSubtree(label, rect, getComputedStyle(label))
      )
    })

  const visitText = (node, parent, style) => {
    if (!/\S/.test(node.data) || NOT_PAGE_TEXT.has(parent.tagName)) return false
    range.selectNodeContents(node)
    // Text directly in a closed details element still measures, though it is not shown.
    const inClosedDetails = parent.tagName === 'DETAILS' && !parent.open
    const visible =
      !inClosedDetails &&
      !isSkippedByBrowser(parent, style) &&
      parseFloat(style.fontSize) >= MIN_FONT_PX &&
      !paintsNoInk(style) &&
      hasVisibleArea(range.getBoundingClientRect())
    if (!visible) hiddenTextNodes.push(node)
    return visible
  }

  const visit = (el) => {
    const style = getComputedStyle(el)
    if (style.display === 'none') return false

    // A closed select's options have no boxes, and they hold its value.
    const lightChildren = el.tagName === 'SELECT' ? [] : Array.from(el.childNodes)
    const shadowChildren = el.shadowRoot ? Array.from(el.shadowRoot.childNodes) : []
    let somethingVisibleInside = false
    for (const child of [...shadowChildren, ...lightChildren]) {
      const visible =
        child.nodeType === Node.TEXT_NODE ? visitText(child, el, style) : child.nodeType === Node.ELEMENT_NODE && visit(child)
      somethingVisibleInside = visible || somethingVisibleInside
    }

    const rect = el.getBoundingClientRect()
    if (!hidesSubtree(el, rect, style) && (somethingVisibleInside || hasVisibleArea(rect))) return true
    if (NO_BOX_OF_THEIR_OWN.has(el.tagName)) return false
    if (hasVisibleLabel(el)) return true
    hiddenElements.push(el)
    return false
  }

  // Decide everything first, because each change to the page would force a new layout for the next check.
  visit(root)
  for (const el of hiddenElements) {
    if (el.style) el.style.setProperty('display', 'none', 'important')
  }
  for (const node of hiddenTextNodes) {
    const wrapper = document.createElement('span')
    wrapper.style.setProperty('display', 'none', 'important')
    node.replaceWith(wrapper)
    wrapper.append(node)
  }

  const body = document.body
  return {
    title: document.title,
    text: body && body.checkVisibility({ opacityProperty: true }) ? body.innerText : '',
    hasPasswordField: document.querySelector('input[type="password"]') !== null,
    links: Array.from(document.querySelectorAll('a[href]'), (a) => a.href).filter((href) => typeof href === 'string'),
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
 * replace, so a page cannot forge its text or talk the visibility filter out of hiding anything.
 * Page scripts are switched off first: the filter and the read happen in one step, but the
 * snapshot is a separate one, and a script could undo the hiding in between. The page cannot run
 * any further after this, so take the screenshot first and close the page after.
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

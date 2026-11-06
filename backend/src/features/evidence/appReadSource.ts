import { APP_CONTEXT_TEXT_CHARS, APP_MAX_ELEMENTS } from './config.js'

/** Longest accessible name kept for an element. */
const NAME_CHARS = 120
/** Longest field value kept for an element. */
const VALUE_CHARS = 100
/** Longest option text, and most options, kept for a select. */
const OPTION_CHARS = 60
const MAX_OPTIONS = 30
/** Raw characters gathered for a context text before an ancestor counts as too long. */
const CONTEXT_RAW_LIMIT = APP_CONTEXT_TEXT_CHARS * 20

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  ...['button', 'link', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemradio', 'option', 'combobox'].map((role) => `[role="${role}"]`),
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(', ')

/**
 * Source for the app's isolated world, run once per world. It installs
 * `globalThis.__evidenceApp = { read, point, focus, choose, follow, markSecret, mask, unmask }`.
 *
 * `read` must run in the same evaluate as DECIDE_HIDDEN_SOURCE and HIGHLIGHT_SOURCE, just before
 * it, so that what is hidden and the page text are decided at the very moment of the read. One
 * synchronous evaluate leaves page scripts no room to change anything halfway.
 *
 * `secretFields` lasts as long as the world, which is as long as the document. Every read adds
 * each password field it sees, and `markSecret` adds a field a credential was typed into. Nothing
 * is ever taken out, so a field stays secret after "Show password" turns it into a text field.
 * The value of a secret field is never read, and `mask` paints every one of them black.
 *
 * The real address of every link stays in `entries`, next to its element. `follow` navigates to it
 * from here. Each read returns addresses for the caller to redact, and replaces `entries`, so refs
 * are renumbered on every read. A ref whose element has left the page is stale: nothing acts on it.
 *
 * Every DOM read and write goes through the prototypes, as in DECIDE_SOURCE: a named form field
 * shadows the property of that name on its form. Sent as a source string for the same __name
 * reason as HIGHLIGHT_SOURCE.
 */
export const APP_READ_SOURCE = String.raw`(() => {
  const NAME_CHARS = ${NAME_CHARS}
  const VALUE_CHARS = ${VALUE_CHARS}
  const OPTION_CHARS = ${OPTION_CHARS}
  const MAX_OPTIONS = ${MAX_OPTIONS}
  const CONTEXT_CHARS = ${APP_CONTEXT_TEXT_CHARS}
  const CONTEXT_RAW_LIMIT = ${CONTEXT_RAW_LIMIT}
  const CONTEXT_LEVELS = 5
  const MAX_ELEMENTS = ${APP_MAX_ELEMENTS}
  const SELECTOR = ${JSON.stringify(INTERACTIVE_SELECTOR)}
  const GROUP_SELECTOR = 'form, dialog, [role="dialog"], [role="form"]'
  const NOT_PAGE_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE', 'SELECT', 'OPTION'])
  const FORM_CONTROLS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])
  const BUTTON_INPUTS = new Set(['button', 'submit', 'reset', 'image'])
  const VALUELESS_INPUTS = new Set(['password', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'hidden', 'range', 'color'])
  const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', number: 'spinbutton' }
  // Painted on a secret field while a picture is taken. A transition outranks !important, so it goes first.
  const MASK_STYLE = [
    ['transition', 'none'],
    ['animation', 'none'],
    ['background', '#000'],
    ['color', '#000'],
    ['-webkit-text-fill-color', '#000'],
    ['caret-color', '#000'],
    ['text-shadow', 'none'],
    ['box-shadow', 'none'],
    ['opacity', '1'],
    ['filter', 'brightness(0)'],
  ]

  const descriptorOf = (proto, name) => {
    for (let at = proto; at; at = Object.getPrototypeOf(at)) {
      const found = Object.getOwnPropertyDescriptor(at, name)
      if (found) return found
    }
  }
  const getter = (proto, name) => {
    const { get } = descriptorOf(proto, name)
    return (target) => get.call(target)
  }
  const setter = (proto, name) => {
    const { set } = descriptorOf(proto, name)
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
    isConnected: getter(Node.prototype, 'isConnected'),
    contains: method(Node.prototype, 'contains'),
    data: getter(CharacterData.prototype, 'data'),
    tagName: getter(Element.prototype, 'tagName'),
    getAttribute: method(Element.prototype, 'getAttribute'),
    setAttribute: method(Element.prototype, 'setAttribute'),
    removeAttribute: method(Element.prototype, 'removeAttribute'),
    closest: method(Element.prototype, 'closest'),
    matches: method(Element.prototype, 'matches'),
    querySelector: method(Element.prototype, 'querySelector'),
    rect: method(Element.prototype, 'getBoundingClientRect'),
    checkVisibility: method(Element.prototype, 'checkVisibility'),
    scrollIntoView: method(Element.prototype, 'scrollIntoView'),
    dispatchEvent: method(EventTarget.prototype, 'dispatchEvent'),
    focus: method(HTMLElement.prototype, 'focus'),
    style: getter(HTMLElement.prototype, 'style'),
    setProperty: method(CSSStyleDeclaration.prototype, 'setProperty'),
    inputType: getter(HTMLInputElement.prototype, 'type'),
    inputValue: getter(HTMLInputElement.prototype, 'value'),
    inputChecked: getter(HTMLInputElement.prototype, 'checked'),
    inputLabels: getter(HTMLInputElement.prototype, 'labels'),
    textareaValue: getter(HTMLTextAreaElement.prototype, 'value'),
    textareaLabels: getter(HTMLTextAreaElement.prototype, 'labels'),
    selectOptions: getter(HTMLSelectElement.prototype, 'options'),
    selectLabels: getter(HTMLSelectElement.prototype, 'labels'),
    selectMultiple: getter(HTMLSelectElement.prototype, 'multiple'),
    selectSize: getter(HTMLSelectElement.prototype, 'size'),
    setSelectedIndex: setter(HTMLSelectElement.prototype, 'selectedIndex'),
    optionText: getter(HTMLOptionElement.prototype, 'text'),
    optionValue: getter(HTMLOptionElement.prototype, 'value'),
    optionSelected: getter(HTMLOptionElement.prototype, 'selected'),
    optionDisabled: getter(HTMLOptionElement.prototype, 'disabled'),
    anchorHref: getter(HTMLAnchorElement.prototype, 'href'),
    iframeSrc: getter(HTMLIFrameElement.prototype, 'src'),
    root: getter(Document.prototype, 'documentElement'),
    title: getter(Document.prototype, 'title'),
    activeElement: getter(Document.prototype, 'activeElement'),
    getElementById: method(Document.prototype, 'getElementById'),
    elementFromPoint: method(Document.prototype, 'elementFromPoint'),
    querySelectorAll: method(Document.prototype, 'querySelectorAll'),
  }
  // Location's members are unforgeable: they live on the object itself, and no script can replace them.
  const tagOf = (el) => dom.tagName(el).toUpperCase()
  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const cap = (text, max) => (text.length > max ? text.slice(0, max) : text)

  const secretFields = new WeakSet()
  let entries = new Map()
  let painted = []

  const hiddenNow = () => globalThis.__evidenceHidden || { elements: new Set(), textNodes: new Set() }
  const isPasswordInput = (el) => el instanceof HTMLInputElement && dom.inputType(el) === 'password'
  const notePasswordFields = () => {
    for (const field of dom.querySelectorAll(document, 'input')) if (isPasswordInput(field)) secretFields.add(field)
  }

  // What a person sees inside an element: the filter's hidden elements and text are left out.
  const visibleText = (start, hidden) => {
    const parts = []
    let length = 0
    const walk = (node, parentVisible) => {
      if (length > CONTEXT_RAW_LIMIT) return
      const type = dom.nodeType(node)
      if (type === Node.TEXT_NODE) {
        if (parentVisible && !hidden.textNodes.has(node)) {
          const data = dom.data(node)
          parts.push(data)
          length += data.length
        }
        return
      }
      if (type !== Node.ELEMENT_NODE || hidden.elements.has(node) || NOT_PAGE_TEXT.has(tagOf(node))) return
      const style = getComputedStyle(node)
      if (style.display === 'none') return
      const breaks = !/^(inline|contents)/.test(style.display)
      if (breaks) parts.push(' ')
      for (const child of Array.from(dom.childNodes(node))) walk(child, style.visibility === 'visible')
      if (breaks) parts.push(' ')
    }
    walk(start, true)
    return length > CONTEXT_RAW_LIMIT ? null : clean(parts.join(''))
  }

  const labelsOf = (el) => {
    if (el instanceof HTMLInputElement) return Array.from(dom.inputLabels(el) || [])
    if (el instanceof HTMLSelectElement) return Array.from(dom.selectLabels(el) || [])
    if (el instanceof HTMLTextAreaElement) return Array.from(dom.textareaLabels(el) || [])
    return []
  }

  const isHiddenByFilter = (el, hidden) => {
    for (let at = el; at; at = dom.parentElement(at)) if (hidden.elements.has(at)) return true
    return false
  }
  const hasBox = (el) => {
    const r = dom.rect(el)
    return r.width > 0 && r.height > 0
  }
  const isShown = (el) => dom.checkVisibility(el, { opacityProperty: true, visibilityProperty: true }) && hasBox(el)
  const isToggleInput = (el) => el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(dom.inputType(el))
  // A custom toggle hides its input and shows its label.
  const shownLabelOf = (el) => (isToggleInput(el) ? labelsOf(el).find(isShown) : undefined)
  const isListed = (el, hidden) => !isHiddenByFilter(el, hidden) && (isShown(el) || shownLabelOf(el) !== undefined)

  const roleOf = (el, tag) => {
    const explicit = clean(dom.getAttribute(el, 'role')).split(' ')[0]
    if (explicit) return explicit
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON') return 'button'
    if (tag === 'SELECT') return dom.selectMultiple(el) || dom.selectSize(el) > 1 ? 'listbox' : 'combobox'
    if (tag === 'INPUT') return INPUT_ROLES[dom.inputType(el)] || 'textbox'
    return 'textbox'
  }

  const nameOf = (el, tag, hidden) => {
    const labelledBy = () =>
      clean(dom.getAttribute(el, 'aria-labelledby'))
        .split(' ')
        .map((id) => (id ? dom.getElementById(document, id) : null))
        .filter(Boolean)
        .map((label) => visibleText(label, hidden) || '')
        .join(' ')
    const ownText = () => {
      if (!FORM_CONTROLS.has(tag)) return visibleText(el, hidden) || ''
      return tag === 'INPUT' && BUTTON_INPUTS.has(dom.inputType(el)) ? dom.inputValue(el) : ''
    }
    const image = () => {
      const img = dom.querySelector(el, 'img[alt]')
      return img ? dom.getAttribute(img, 'alt') : ''
    }
    const candidates = [
      () => dom.getAttribute(el, 'aria-label'),
      labelledBy,
      () => labelsOf(el).map((label) => visibleText(label, hidden) || '').join(' '),
      ownText,
      () => dom.getAttribute(el, 'title'),
      () => dom.getAttribute(el, 'placeholder'),
      () => dom.getAttribute(el, 'alt'),
      image,
    ]
    for (const candidate of candidates) {
      const name = clean(candidate())
      if (name) return cap(name, NAME_CHARS)
    }
    return ''
  }

  // The nearest ancestor, up to five levels up, that says more than the element itself and still fits.
  const contextOf = (el, hidden, cache) => {
    const textOf = (at) => {
      if (!cache.has(at)) cache.set(at, visibleText(at, hidden))
      return cache.get(at)
    }
    const own = textOf(el) || ''
    let at = el
    for (let level = 0; level < CONTEXT_LEVELS; level += 1) {
      at = dom.parentElement(at)
      if (!at || at === dom.root(document)) return ''
      const text = textOf(at)
      if (text === null || text.length > CONTEXT_CHARS) return ''
      if (text.length > own.length) return text
    }
    return ''
  }

  const valueOf = (el, tag) => {
    if (secretFields.has(el)) return ''
    if (tag === 'INPUT') return VALUELESS_INPUTS.has(dom.inputType(el)) ? '' : dom.inputValue(el)
    if (tag === 'TEXTAREA') return dom.textareaValue(el)
    if (tag === 'SELECT') {
      return Array.from(dom.selectOptions(el))
        .filter((option) => dom.optionSelected(option))
        .map((option) => clean(dom.optionText(option)))
        .join(', ')
    }
    return ''
  }

  const stateOf = (el, tag) => {
    const state = {}
    const aria = (name) => dom.getAttribute(el, name)
    const checked = aria('aria-checked') ?? aria('aria-pressed')
    if (isToggleInput(el)) state.checked = dom.inputChecked(el)
    else if (checked === 'true' || checked === 'false') state.checked = checked === 'true'
    if (aria('aria-selected') === 'true') state.selected = true
    if (dom.matches(el, ':disabled') || aria('aria-disabled') === 'true') state.disabled = true
    const expanded = aria('aria-expanded')
    if (expanded === 'true' || expanded === 'false') state.expanded = expanded === 'true'
    const value = valueOf(el, tag)
    if (value) state.value = cap(value, VALUE_CHARS)
    if (tag === 'SELECT') {
      state.options = Array.from(dom.selectOptions(el))
        .slice(0, MAX_OPTIONS)
        .map((option) => cap(clean(dom.optionText(option)), OPTION_CHARS))
    }
    return state
  }

  const read = () => {
    const hidden = hiddenNow()
    notePasswordFields()
    const groups = new Map()
    const groupOf = (el) => {
      const group = dom.closest(el, GROUP_SELECTOR)
      if (!group) return null
      if (!groups.has(group)) groups.set(group, 'g' + (groups.size + 1))
      return groups.get(group)
    }
    const textCache = new Map()
    const next = new Map()
    const elements = []
    for (const el of dom.querySelectorAll(document, SELECTOR)) {
      if (elements.length >= MAX_ELEMENTS) break
      if (!(el instanceof HTMLElement) || !isListed(el, hidden)) continue
      const tag = tagOf(el)
      const ref = 'e' + (elements.length + 1)
      const href = el instanceof HTMLAnchorElement ? dom.anchorHref(el) : null
      next.set(ref, { el, href })
      elements.push({
        ref,
        role: roleOf(el, tag),
        name: nameOf(el, tag, hidden),
        tag: tag.toLowerCase(),
        inputType: el instanceof HTMLInputElement ? dom.inputType(el) : null,
        href,
        groupId: groupOf(el),
        state: stateOf(el, tag),
        contextText: contextOf(el, hidden, textCache),
      })
    }
    entries = next
    return {
      url: location.href,
      title: dom.title(document),
      text: globalThis.__evidenceHighlighter.builtText(),
      elements,
      frameUrls: Array.from(dom.querySelectorAll(document, 'iframe'))
        .map((frame) => dom.iframeSrc(frame))
        .filter((src) => src !== ''),
      hasPasswordField: Array.from(dom.querySelectorAll(document, 'input')).some(isPasswordInput),
    }
  }

  const live = (ref) => {
    const entry = entries.get(ref)
    return entry && dom.isConnected(entry.el) ? entry : null
  }

  const isInView = (r) => r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth

  // The centre of the element, in viewport coordinates, if that is where a click would land on it.
  const point = (ref) => {
    const entry = live(ref)
    if (!entry) return null
    const { el } = entry
    const target = hasBox(el) ? el : shownLabelOf(el)
    if (!target) return null
    if (!isInView(dom.rect(target))) dom.scrollIntoView(target, { block: 'center', inline: 'center', behavior: 'instant' })
    const r = dom.rect(target)
    const x = (r.left + r.right) / 2
    const y = (r.top + r.bottom) / 2
    if (r.width <= 0 || r.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null
    const top = dom.elementFromPoint(document, x, y)
    if (!top) return null
    const owners = [el, ...labelsOf(el)]
    return owners.some((owner) => owner === top || dom.contains(owner, top)) ? { x, y } : null
  }

  const focus = (ref) => {
    const entry = live(ref)
    if (!entry) return false
    dom.focus(entry.el)
    return dom.activeElement(document) === entry.el
  }

  const choose = (ref, option) => {
    const entry = live(ref)
    if (!entry || !(entry.el instanceof HTMLSelectElement) || dom.matches(entry.el, ':disabled')) return false
    const options = Array.from(dom.selectOptions(entry.el))
    const wanted = clean(option)
    let index = options.findIndex((o) => clean(dom.optionText(o)) === wanted)
    if (index === -1) index = options.findIndex((o) => dom.optionValue(o) === option)
    if (index === -1 || dom.optionDisabled(options[index])) return false
    dom.setSelectedIndex(entry.el, index)
    dom.dispatchEvent(entry.el, new Event('input', { bubbles: true }))
    dom.dispatchEvent(entry.el, new Event('change', { bubbles: true }))
    return true
  }

  const follow = (ref) => {
    const entry = live(ref)
    if (!entry || !entry.href) return false
    let protocol
    try {
      protocol = new URL(entry.href).protocol
    } catch {
      return false
    }
    if (protocol !== 'http:' && protocol !== 'https:') return false
    location.assign(entry.href)
    return true
  }

  const markSecret = (ref) => {
    const entry = live(ref)
    if (entry) secretFields.add(entry.el)
  }

  const unmask = () => {
    for (const [el, previous] of painted.splice(0)) {
      // Emptied first: Blink can write a pending inline-style change back after a bare removeAttribute.
      dom.setAttribute(el, 'style', previous ?? '')
      if (previous === null) dom.removeAttribute(el, 'style')
    }
  }

  // Paints every password field and every secret field black, where it is, so the paint moves with it.
  const mask = () => {
    unmask()
    notePasswordFields()
    for (const el of dom.querySelectorAll(document, '*')) {
      if (!secretFields.has(el) || !(el instanceof HTMLElement)) continue
      painted.push([el, dom.getAttribute(el, 'style')])
      const style = dom.style(el)
      for (const [name, value] of MASK_STYLE) dom.setProperty(style, name, value, 'important')
    }
    return painted.length
  }

  globalThis.__evidenceApp = { read, point, focus, choose, follow, markSecret, mask, unmask }
})()`

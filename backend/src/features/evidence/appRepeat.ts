/**
 * The rule against the same step again: an action identical to the one just done, when that one
 * changed nothing on the page and nothing has changed since, is refused so that the AI tries
 * something else (a live run typed the login into the e-mail field four times in a row).
 */
import type { AppAction, AppElement, AppView } from './appTypes.js'

/** The refusal of a repeat. The AI sees it in its history. */
export const REPEATED_ACTION = 'Repeated the same action; try something different, such as the next field or a different page.'

type ActAction = Exclude<AppAction, { type: 'finish' } | { type: 'switch_account' }>

/**
 * What counts as the page for this rule: its address, its text, and the kinds and on/off states of its
 * controls (a toggled switch or a shown password changes no text). A typed value is left out: filling
 * a field again is the repeat.
 */
export interface PageState {
  url: string
  text: string
  controls: string
}

export function pageState(view: AppView): PageState {
  const controls = view.elements
    .map((el) => [el.role, el.name, el.inputType, el.state.checked, el.state.selected, el.state.expanded, el.state.disabled].map(String).join('|'))
    .join('\n')
  return { url: view.url, text: view.text, controls: `${view.hasPasswordField}\n${controls}` }
}

/** An action that was done, with the element it acted on and the page before and after it. */
export interface DoneAction {
  action: ActAction
  /** The element's role and name, so that a new ref for the same control still counts as the same. */
  label: string | null
  before: PageState
  after: PageState
}

export function labelOf(el: AppElement | null): string | null {
  return el === null ? null : `${el.role}\u0000${el.name.trim().toLowerCase()}`
}

const refOf = (action: ActAction): string | undefined => ('ref' in action ? action.ref : undefined)

/** The same element: the same ref, or the same role and name. */
function sameTarget(last: DoneAction, action: ActAction, label: string | null): boolean {
  const ref = refOf(action)
  const lastRef = refOf(last.action)
  if (ref === undefined || lastRef === undefined) return ref === lastRef
  return ref === lastRef || (label !== null && label === last.label)
}

/** The same thing done to the element: the same text, account and field, option, address or target. */
function samePayload(a: ActAction, b: ActAction): boolean {
  switch (a.type) {
    case 'type':
      return b.type === 'type' && a.text === b.text
    case 'fill_credential':
      return b.type === 'fill_credential' && a.field === b.field && a.account.trim().toLowerCase() === b.account.trim().toLowerCase()
    case 'select':
      return b.type === 'select' && a.option === b.option
    case 'open_link':
      return b.type === 'open_link' && a.url === b.url
    case 'click':
    case 'toggle':
      return b.type === a.type && a.target === b.target
    case 'back':
      return b.type === 'back'
  }
}

const samePage = (a: PageState, b: PageState): boolean => a.url === b.url && a.text === b.text && a.controls === b.controls

/**
 * Whether `action` repeats `last`: the same type, element and payload, where the last one left the
 * page (address, text and control states) as it was and the page is still the same now. A step that
 * changed the page, or one on another element, is not a repeat.
 */
export function isRepeat(last: DoneAction | null, action: ActAction, el: AppElement | null, view: AppView | null): boolean {
  if (last === null || view === null || last.action.type !== action.type) return false
  if (!samePayload(action, last.action) || !sameTarget(last, action, labelOf(el))) return false
  return samePage(last.before, last.after) && samePage(last.after, pageState(view))
}

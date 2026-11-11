/**
 * The rule against the same step again: an action identical to the one just done, when that one
 * changed nothing on the page and nothing has changed since, is refused so that the AI tries
 * something else (a live run typed the login into the e-mail field four times in a row).
 */
import { isCredentialField, isTextField, signInButtonOf } from './appFields.js'
import type { AppAction, AppElement, AppView } from './appTypes.js'

/** The refusal of a repeat. The AI sees it in its history. */
export const REPEATED_ACTION = 'Repeated the same action; try something different, such as the next field or a different page.'
/**
 * The short refusal of a repeated fill that comes with its next step. Short, so that the step line,
 * which the AI's history cuts at APP_HISTORY_LINE_CHARS, still ends with the step to take.
 */
export const REPEATED_FILL = 'Repeated the same fill.'

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
 * page (address, text and control states) as it was. `last` is only ever the step just before this
 * one (the check loop forgets it on any other step, and never keeps one whose page was still
 * loading), so the page now is the page that action left. A step that changed the page, or one on
 * another element, is not a repeat.
 *
 * Accepted edge case: a control whose effect shows in none of these, such as an image-only "Next"
 * on a carousel that keeps one address and one text, gets its second identical click refused. The
 * AI is told to try something else, and the refusal costs one step.
 */
export function isRepeat(last: DoneAction | null, action: ActAction, el: AppElement | null): boolean {
  if (last === null || last.action.type !== action.type) return false
  if (!samePayload(action, last.action) || !sameTarget(last, action, labelOf(el))) return false
  return samePage(last.before, last.after)
}

/** What the repeat hint knows: the account in use, and whether this check filled a field for it. */
export interface RepeatHintContext {
  account: string | null
  filled: (field: AppElement) => boolean
}

/** A name in double quotes: a double quote inside it becomes a single one. */
const quotedName = (el: AppElement): string => `"${el.name.trim().replace(/"/g, "'")}"`
const quoted = (el: AppElement): string => `${quotedName(el)} (${el.ref})`

function listed(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** The text and password fields of the form or dialog the element is in (the page's loose fields when it is in none). */
function formFields(el: AppElement, view: AppView): AppElement[] {
  return view.elements.filter((other) => other.groupId === el.groupId && isTextField(other))
}

function nextStep(el: AppElement, view: AppView, fields: AppElement[], ctx: RepeatHintContext): string | null {
  const credentials = fields.filter(isCredentialField)
  const button = signInButtonOf(view.elements.filter((other) => other.groupId === el.groupId))
  if (credentials.length > 0 && credentials.every(ctx.filled) && button !== null) {
    const which = credentials.length === 2 ? 'Both fields are' : credentials.length === 1 ? 'The field is' : 'All the fields are'
    return `${which} filled: click the ${quotedName(button)} button (${button.ref}) next.`
  }
  const unfilled = [...credentials, ...fields.filter((f) => !isCredentialField(f))].find((f) => !ctx.filled(f))
  return unfilled === undefined ? null : `Next, fill ${quoted(unfilled)}.`
}

/**
 * The refusal of a repeat. A repeated fill (a credential or a typed text) says what to do next: the
 * form's sign-in button once every credential field is filled, else the next empty field. Then the
 * reason is the short REPEATED_FILL, and the step comes right after it, so that the cut history line
 * the AI reads still holds it. With no next step, the generic reason is followed by the fields this
 * check already filled for the account in use. It names only fields, refs and buttons the AI already
 * sees, never a value. It is a hint: nothing is clicked for the AI.
 */
export function repeatRefusal(action: ActAction, el: AppElement | null, view: AppView | null, ctx: RepeatHintContext): string {
  if ((action.type !== 'fill_credential' && action.type !== 'type') || el === null || view === null) return REPEATED_ACTION
  const fields = formFields(el, view)
  const next = nextStep(el, view, fields, ctx)
  if (next !== null) return `${REPEATED_FILL} ${next}`
  const done = fields.filter(ctx.filled).map(quoted)
  if (done.length === 0) return REPEATED_ACTION
  const who = ctx.account === null ? 'This check has' : `For ${ctx.account} this check has`
  return `${REPEATED_ACTION} ${who} already filled ${listed(done)} in this form.`
}

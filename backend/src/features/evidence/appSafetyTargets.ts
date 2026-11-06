/**
 * Rule: only our own accounts. An action that can reach a person must name one of the test
 * accounts as its target, and the page must show, by an @handle in the control's own surroundings,
 * that the control belongs to that account. Anything the rule cannot tell is refused.
 */
import type { AgentAccount, AppAction, AppElement, AppView } from './appTypes.js'
import {
  AUDIENCE_CONTROL,
  DIRECT_THREAD,
  FINAL_ACTION,
  LEAVE_FORM,
  LOGIN_PATH,
  PERSON_ACTION,
  PRIVATE_OPTION,
  PUBLISH_ACTION,
  RECIPIENT_FIELD,
  SAFE_NAVIGATION,
} from './appSafetyWords.js'
import { handleName, holdsBareName, mentionsOf, parseUrl, pathSegments, plain } from './appSafetyText.js'

export interface TargetContext {
  accounts: AgentAccount[]
  currentAccount: AgentAccount | null
}

const LINE_BREAK = new RegExp('[\r\n\u0085\v\f\u2028\u2029]')

export type Check = { ok: true } | { ok: false; reason: string }
const OK: Check = { ok: true }
const no = (reason: string): Check => ({ ok: false, reason })

export function sameGroup(view: AppView, element: AppElement): AppElement[] {
  if (element.groupId === null) return []
  return view.elements.filter((other) => other.groupId === element.groupId && other.ref !== element.ref)
}

export function isTextBox(element: AppElement): boolean {
  return element.role === 'textbox' || element.tag === 'textarea' || (element.tag === 'input' && [null, 'text', 'search'].includes(element.inputType))
}

export function isMediaInput(element: AppElement): boolean {
  return element.tag === 'input' && element.inputType === 'file'
}

/** A login form: the group holds a password field, or the page is a sign-in address. */
export function isAuthForm(view: AppView, element: AppElement): boolean {
  if (sameGroup(view, element).some((other) => other.inputType === 'password')) return true
  const parsed = parseUrl(view.url)
  return parsed !== null && LOGIN_PATH.test(parsed.pathname)
}

/** Typing beside a person word (Send, Reply...) is typing to a person; beside Post it is not, the button is judged when pressed. */
function personMate(view: AppView, element: AppElement): boolean {
  return sameGroup(view, element).some((other) => PERSON_ACTION.test(other.name))
}

/** The whole text of the option is a private audience ("Only me", "Private."), and nothing more. */
export function isPrivateOption(text: string): boolean {
  return PRIVATE_OPTION.test(plain(text))
}

const OPTION_ROLES = ['radio', 'option', 'menuitem', 'menuitemradio']
const LIST_ROLES = ['combobox', 'listbox']

/** The control picks one option of several: a select for `select`, a radio, option or menu item for a click. */
function isOptionControl(action: AppAction, element: AppElement): boolean {
  if (action.type === 'select') return element.tag === 'select' || LIST_ROLES.includes(element.role)
  return OPTION_ROLES.includes(element.role) || element.inputType === 'radio'
}

/**
 * Choosing a private audience option is always safe: its only effect is to narrow who can see. Only an
 * option control in an audience group counts, and only when its name holds no person, publish, final or reply word.
 */
export function choosesPrivateOption(action: AppAction, element: AppElement): boolean {
  if (action.type !== 'select' && action.type !== 'click' && action.type !== 'toggle') return false
  const option = action.type === 'select' ? action.option : element.name
  if (!isPrivateOption(option) || !isOptionControl(action, element)) return false
  const inAudience = AUDIENCE_CONTROL.test(element.name) || AUDIENCE_CONTROL.test(element.contextText)
  // (Reply and Comment are person words, so PERSON_ACTION covers the reply words.)
  const acts = [PERSON_ACTION, PUBLISH_ACTION, FINAL_ACTION].some((words) => words.test(element.name))
  return inAudience && !acts
}

function buttonLike(element: AppElement): boolean {
  return element.role === 'button' || element.tag === 'button' || element.inputType === 'submit' || element.inputType === 'button'
}

/** A text or media input that can hold something to be published (a search box cannot). */
function composes(element: AppElement): boolean {
  const search = element.inputType === 'search' || element.role === 'searchbox'
  return (isTextBox(element) && !search) || isMediaInput(element)
}

/** Cancel, Close or Back that is not type=submit: it leaves the form without sending it. */
function leavesForm(element: AppElement): boolean {
  return element.inputType !== 'submit' && LEAVE_FORM.test(element.name)
}

/**
 * A submit button (type=submit, or the last button that does not just leave the form) of a form that has a
 * text or media input. Such a button is judged by what it submits, whatever its label.
 */
export function isComposerSubmit(element: AppElement, view: AppView): boolean {
  if (element.groupId === null || !sameGroup(view, element).some(composes)) return false
  if (element.inputType === 'submit') return true
  const buttons = view.elements.filter((other) => other.groupId === element.groupId && buttonLike(other) && !leavesForm(other))
  return buttonLike(element) && buttons[buttons.length - 1]?.ref === element.ref
}

/** True when the action could reach a person, or when it cannot be told that it does not. */
export function reachesPeople(action: AppAction, element: AppElement, view: AppView): boolean {
  if (PERSON_ACTION.test(element.name) || RECIPIENT_FIELD.test(element.name)) return true
  const safe = (SAFE_NAVIGATION.test(element.name) && !isComposerSubmit(element, view)) || (action.type !== 'type' && isAuthForm(view, element))
  if (safe) return false
  if (mentionsOf(`${element.name} ${element.contextText}`).length > 0) return true
  // A submit button of a form is judged by the nothing-public rule, not by what the form holds.
  if (PUBLISH_ACTION.test(element.name) || FINAL_ACTION.test(element.name)) return false
  const mates = sameGroup(view, element)
  if (action.type === 'type') return personMate(view, element)
  return mates.some((other) => isTextBox(other) || isMediaInput(other))
}

function isRecipientInput(element: AppElement): boolean {
  const input = element.tag === 'input' || element.tag === 'textarea' || element.role === 'textbox'
  return input && RECIPIENT_FIELD.test(element.name) && element.state.value !== undefined && element.state.value.trim() !== ''
}

/** The handle held by the form's recipient field: null when there is none, false when it holds anything but exactly one handle. */
function recipientOf(view: AppView, element: AppElement): string | null | false {
  const fields = [element, ...sameGroup(view, element)].filter(isRecipientInput)
  const names = new Set<string>()
  for (const field of fields) {
    const tokens = (field.state.value ?? '').split(/[\s,;]+/).filter((token) => token !== '')
    const name = tokens.length === 1 ? handleName(tokens[0]) : null
    if (name === null) return false
    names.add(name)
  }
  if (names.size > 1) return false
  return [...names][0] ?? null
}

/** Everything the page shows about who a control belongs to: @names around it, and the recipient field's value. */
function shownHandles(element: AppElement, view: AppView): string[] | null {
  const recipient = recipientOf(view, element)
  if (recipient === false) return null
  const seen = mentionsOf(`${element.name} ${element.contextText}`)
  return recipient === null ? seen : [...seen, recipient]
}

function accountNamed(ctx: TargetContext, label: string): AgentAccount | null {
  return ctx.accounts.find((account) => account.label === label) ?? null
}

export function checkLabel(ctx: TargetContext, label: string): Check {
  return accountNamed(ctx, label) === null ? no(`"${label}" is not one of the test accounts.`) : OK
}

/** The target must be a test account other than the one in use, and the page must show that this control is its own. */
export function checkTarget(label: string | undefined, element: AppElement, view: AppView, ctx: TargetContext): Check {
  if (label === undefined) return no('This could reach a person, so it needs a target that is one of the test accounts.')
  const target = accountNamed(ctx, label)
  if (target === null) return no(`"${label}" is not one of the test accounts.`)
  if (ctx.currentAccount !== null && target.id === ctx.currentAccount.id) return no(`${label} is the account in use, so it cannot be the target.`)
  const handles = target.handles.map(handleName).filter((name): name is string => name !== null)
  if (handles.length === 0) return no(`${label} has no display handle, so nothing can be sent to it.`)
  const seen = shownHandles(element, view)
  if (seen === null) return no('The recipient field does not hold exactly one handle.')
  if (seen.length > 0) {
    const onlyTarget = seen.every((name) => handles.includes(name)) && seen.some((name) => handles.includes(name))
    return onlyTarget ? OK : no(`The page does not show that this belongs to ${label} alone.`)
  }
  const onProfilePage = pathSegments(view.url).some((segment) => handles.includes(segment))
  const named = handles.some((name) => holdsBareName(element.contextText, name))
  return onProfilePage && named ? OK : no(`The page does not show that this belongs to ${label}.`)
}

/** A box has no target of its own: its surroundings must show one other test account, and nobody else. */
export function checkTypeBox(element: AppElement, view: AppView, ctx: TargetContext): Check {
  const seen = shownHandles(element, view) ?? []
  const others = ctx.accounts.filter((account) => account.id !== ctx.currentAccount?.id)
  const shown = seen.length > 0 && others.some((account) => {
    const handles = account.handles.map(handleName)
    return seen.every((name) => handles.includes(name))
  })
  return shown ? OK : no('This box could reach a person, and the page does not show that it belongs to one test account alone.')
}

/** What is typed may mention only test accounts, and it never holds a line break (a break could send it). */
export function checkTypedText(text: string, ctx: TargetContext): Check {
  if (LINE_BREAK.test(text)) return no('Text with a line break could submit the form, so it is not typed.')
  const known = new Set(ctx.accounts.map((account) => account.handles.map(handleName)).flat())
  const stranger = mentionsOf(text).find((name) => !known.has(name))
  return stranger === undefined ? OK : no(`The text mentions @${stranger}, who is not a test account.`)
}

/**
 * The page is a private conversation with exactly one other test account: a recipient field holding its
 * handle, or an address ending in a conversation word and then exactly that handle (`/messages/teen15`).
 */
export function isDirectThread(element: AppElement, view: AppView, ctx: TargetContext): boolean {
  const others = ctx.accounts.filter((account) => account.id !== ctx.currentAccount?.id)
  const handles = others.flatMap((account) => account.handles.map(handleName)).filter((name): name is string => name !== null)
  const recipient = recipientOf(view, element)
  if (typeof recipient === 'string') return handles.includes(recipient)
  const segments = pathSegments(view.url)
  const [conversation = '', last = ''] = segments.slice(-2)
  return DIRECT_THREAD.test(conversation) && handles.includes(last)
}

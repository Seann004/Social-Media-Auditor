/**
 * Rule: only our own accounts. An action that can reach a person must name one of the test
 * accounts as its target, and the page must show, by an @handle in the control's own surroundings,
 * that the control belongs to that account. Anything the rule cannot tell is refused.
 */
import type { AgentAccount, AppAction, AppElement, AppView } from './appTypes.js'
import { FINAL_ACTION, LOGIN_PATH, PERSON_ACTION, PUBLISH_ACTION, RECIPIENT_FIELD, SAFE_NAVIGATION } from './appSafetyWords.js'
import { handleName, holdsBareName, mentionsOf, parseUrl, pathSegments } from './appSafetyText.js'

export interface TargetContext {
  accounts: AgentAccount[]
  currentAccount: AgentAccount | null
}

const LINE_BREAK = new RegExp('[\r\n\u2028\u2029]')

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

function composerMate(view: AppView, element: AppElement): boolean {
  return sameGroup(view, element).some((other) => PERSON_ACTION.test(other.name) || PUBLISH_ACTION.test(other.name) || FINAL_ACTION.test(other.name))
}

/** True when the action could reach a person, or when it cannot be told that it does not. */
export function reachesPeople(action: AppAction, element: AppElement, view: AppView): boolean {
  if (PERSON_ACTION.test(element.name) || RECIPIENT_FIELD.test(element.name)) return true
  const safe = SAFE_NAVIGATION.test(element.name) || (action.type !== 'type' && isAuthForm(view, element))
  if (safe) return false
  if (mentionsOf(`${element.name} ${element.contextText}`).length > 0) return true
  // A submit button of a form is judged by the nothing-public rule, not by what the form holds.
  if (PUBLISH_ACTION.test(element.name) || FINAL_ACTION.test(element.name)) return false
  const mates = sameGroup(view, element)
  if (action.type === 'type') return composerMate(view, element)
  return mates.some((other) => isTextBox(other) || isMediaInput(other))
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
  const seen = mentionsOf(`${element.name} ${element.contextText}`)
  if (seen.length > 0) {
    const onlyTarget = seen.every((name) => handles.includes(name)) && seen.some((name) => handles.includes(name))
    return onlyTarget ? OK : no(`The page does not show that this belongs to ${label} alone.`)
  }
  const onProfilePage = pathSegments(view.url).some((segment) => handles.includes(segment))
  const named = handles.some((name) => holdsBareName(element.contextText, name))
  return onProfilePage && named ? OK : no(`The page does not show that this belongs to ${label}.`)
}

/** A box has no target of its own: its surroundings must show one other test account, and nobody else. */
export function checkTypeBox(element: AppElement, ctx: TargetContext): Check {
  const seen = mentionsOf(`${element.name} ${element.contextText}`)
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

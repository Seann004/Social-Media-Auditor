/** Which controls of a page are sign-in fields and buttons, shared by the check loop and the repeat rule. */
import type { AppElement } from './appTypes.js'

/** A submit that signs in. Enter in a credential field would count too, but no action presses Enter. */
export const SIGN_IN_CONTROL = /\b(sign ?in|log ?in)\b/i
/** A button that may send a form when no button says it signs in: for the repeat hint only, never clicked for the AI. */
const SUBMIT_LIKE_BUTTON = /\b(submit|continue)\b/i
/** A button that signs in with another service ("Continue with Google"), never the form's own sign-in. */
const OTHER_SERVICE_BUTTON = /\b(with|google|apple|facebook|microsoft|github|twitter|x)\b/i
/** A login-name box, by its label. */
const LOGIN_FIELD_NAME = /\b(?:user ?name|e-?mail|log ?in|phone,? (?:or|\/) e-?mail|e-?mail,? (?:or|\/) phone)\b/i
const LOGIN_FIELD_TYPES: (string | null)[] = [null, 'text', 'email']
/** Input types a text or password can be filled into. */
const TEXT_FIELD_TYPES: (string | null)[] = [null, 'text', 'email', 'password', 'search', 'tel', 'url', 'number']

/** A password box, or a text or email box whose label says it takes a login name (ruling A14). */
export function isCredentialField(el: AppElement): boolean {
  if (el.tag !== 'input') return false
  if (el.inputType === 'password') return true
  return LOGIN_FIELD_TYPES.includes(el.inputType) && LOGIN_FIELD_NAME.test(el.name)
}

/** A box that text or a password is filled into. */
export function isTextField(el: AppElement): boolean {
  return (el.tag === 'input' && TEXT_FIELD_TYPES.includes(el.inputType)) || el.tag === 'textarea'
}

const isButton = (el: AppElement): boolean => el.role === 'button' || el.tag === 'button' || el.inputType === 'submit'

/**
 * The button of a form that most likely sends its sign-in: one named like a sign-in first, else one
 * named Submit or Continue. A button that signs in with another service is never chosen.
 */
export function signInButtonOf(buttons: AppElement[]): AppElement | null {
  const own = buttons.filter((el) => isButton(el) && !OTHER_SERVICE_BUTTON.test(el.name))
  return own.find((el) => SIGN_IN_CONTROL.test(el.name)) ?? own.find((el) => SUBMIT_LIKE_BUTTON.test(el.name)) ?? null
}

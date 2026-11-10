/** Which controls of a page are sign-in fields and buttons, shared by the check loop and the repeat rule. */
import type { AppElement } from './appTypes.js'

/** A submit that signs in. Enter in a credential field would count too, but no action presses Enter. */
export const SIGN_IN_CONTROL = /\b(sign ?in|log ?in)\b/i
/** A button that may send a sign-in form, for the repeat hint only: it is never clicked for the AI. */
export const SIGN_IN_LIKE_BUTTON = /\b(sign ?in|log ?in|submit|continue)\b/i
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

/** A button whose name says it sends a sign-in form. */
export function isSignInButton(el: AppElement): boolean {
  const button = el.role === 'button' || el.tag === 'button' || el.inputType === 'submit'
  return button && SIGN_IN_LIKE_BUTTON.test(el.name)
}

import { expect } from 'vitest'
import { checkAction, type SafetyContext } from './appSafety.js'
import type { AgentAccount, AppAction, AppElement, AppView } from './appTypes.js'

export function account(label: string, handles: string[]): AgentAccount {
  return { id: label, label, ageGroup: 'under_18', age: 15, handles }
}
export const TEEN = account('Teen 15', ['@teen15', 'Teen Fifteen'])
export const ADULT = account('Adult', ['adult_a'])
export const NOHANDLE = account('Ghost', [])
export const CTX: SafetyContext = {
  accounts: [TEEN, ADULT, NOHANDLE],
  currentAccount: ADULT,
  appUrl: 'https://app.test/',
  loginDomains: ['sso.idp.test'],
}

export function el(ref: string, name: string, extra: Partial<AppElement> = {}): AppElement {
  return { ref, role: 'button', name, tag: 'button', inputType: null, href: null, groupId: null, state: {}, contextText: '', ...extra }
}
export function view(elements: AppElement[], extra: Partial<AppView> = {}): AppView {
  return { url: 'https://app.test/home', title: 'Home', text: 'hello', elements, frameUrls: [], hasPasswordField: false, ...extra }
}
/** A page with one control, named `name`, with the given surroundings. */
export function one(name: string, extra: Partial<AppElement> = {}, page: Partial<AppView> = {}): AppView {
  return view([el('e1', name, extra)], page)
}

export function refused(action: AppAction, v: AppView | null, rule: string, ctx: SafetyContext = CTX): void {
  const verdict = checkAction(action, v, ctx)
  expect(verdict).toMatchObject({ allowed: false, rule })
  if (!verdict.allowed) expect(verdict.reason).toMatch(/\S/)
}
export function allowed(action: AppAction, v: AppView | null, ctx: SafetyContext = CTX): void {
  expect(checkAction(action, v, ctx)).toEqual({ allowed: true })
}
export const CLICK: AppAction = { type: 'click', ref: 'e1' }
export const CLICK_TEEN: AppAction = { type: 'click', ref: 'e1', target: 'Teen 15' }
export const LONG_TEXT = Array.from({ length: 300 }, () => 'word').join(' ')

import { describe, expect, it } from 'vitest'
import { isRepeat, labelOf, pageState, repeatRefusal, REPEATED_ACTION, type DoneAction } from './appRepeat.js'
import type { AppAction, AppElement, AppView } from './appTypes.js'

const el = (over: Partial<AppElement> = {}): AppElement => ({
  ref: 'e1',
  role: 'textbox',
  name: 'E-mail',
  tag: 'input',
  inputType: 'email',
  href: null,
  groupId: 'g1',
  state: {},
  contextText: '',
  ...over,
})
const view = (elements: AppElement[], text = 'Sign in E-mail Password', url = 'https://app.test/login'): AppView => ({
  url,
  title: 'Sign in',
  text,
  elements,
  frameUrls: [],
  hasPasswordField: true,
})

type Act = Exclude<AppAction, { type: 'finish' } | { type: 'switch_account' }>
const done = (action: Act, element: AppElement | null, before: AppView, after: AppView): DoneAction => ({
  action,
  label: labelOf(element),
  before: pageState(before),
  after: pageState(after),
})

const FILL: Act = { type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }

describe('isRepeat', () => {
  it('the same fill into the same field, on a page that did not change, is a repeat', () => {
    const page = view([el()])
    // A filled value is not a change of the page: it is the same field, typed again.
    const filled = view([el({ state: { value: '[secret]' } })])
    expect(isRepeat(done(FILL, el(), page, filled), FILL, el())).toBe(true)
  })

  it('a new ref for the same control is still the same element', () => {
    const page = view([el()])
    const again = view([el({ ref: 'e7' })])
    expect(isRepeat(done(FILL, el(), page, page), { ...FILL, ref: 'e7' }, el({ ref: 'e7' }))).toBe(true)
  })

  it('another field, another account or another text is not a repeat', () => {
    const page = view([el(), el({ ref: 'e2', name: 'Password', inputType: 'password' })])
    const last = done(FILL, el(), page, page)
    expect(isRepeat(last, { ...FILL, ref: 'e2' }, el({ ref: 'e2', name: 'Password', inputType: 'password' }))).toBe(false)
    expect(isRepeat(last, { ...FILL, account: 'Adult 30' }, el())).toBe(false)
    const typed: Act = { type: 'type', ref: 'e1', text: 'a' }
    expect(isRepeat(done(typed, el(), page, page), { ...typed, text: 'b' }, el())).toBe(false)
  })

  it('an action that changed the address or the text is not a repeat', () => {
    const page = view([el()])
    const click: Act = { type: 'click', ref: 'e1' }
    expect(isRepeat(done(click, el(), page, view([el()], 'Sign in Wrong password')), click, el())).toBe(false)
    const moved = view([el()], 'Sign in E-mail Password', 'https://app.test/login?next=1')
    expect(isRepeat(done(click, el(), page, moved), click, el())).toBe(false)
  })

  it('a toggle that changed only a control state is not a repeat', () => {
    const off = el({ role: 'switch', name: 'Private account', tag: 'button', inputType: null, state: { checked: false } })
    const on = { ...off, state: { checked: true } }
    const toggle: Act = { type: 'toggle', ref: 'e1' }
    expect(isRepeat(done(toggle, off, view([off]), view([on])), toggle, on)).toBe(false)
  })

  it('a click that turned a password field into a text field changed the page', () => {
    const hidden = el({ ref: 'e2', name: 'Password', inputType: 'password' })
    const shown = { ...hidden, inputType: 'text' }
    const button = el({ ref: 'e3', role: 'button', name: 'Show password', tag: 'button', inputType: null })
    const click: Act = { type: 'click', ref: 'e3' }
    const before = view([hidden, button])
    const after = { ...view([shown, button]), hasPasswordField: false }
    expect(isRepeat(done(click, button, before, after), click, button)).toBe(false)
  })

  it('nothing done yet is never a repeat', () => {
    expect(isRepeat(null, FILL, el())).toBe(false)
  })
})

describe('repeatRefusal: what the refusal of a repeat tells the AI', () => {
  const login = el({ ref: 'e1', name: 'Username', inputType: null })
  const password = el({ ref: 'e2', name: 'Password', inputType: 'password' })
  const show = el({ ref: 'e3', role: 'button', name: 'Show password', tag: 'button', inputType: 'button' })
  const signIn = el({ ref: 'e4', role: 'button', name: 'Sign in', tag: 'button', inputType: 'submit' })
  const search = el({ ref: 'e9', name: 'Search', inputType: 'search', groupId: 'g2' })
  const page = view([login, password, show, signIn, search])
  const filledOf = (...fields: AppElement[]) => (field: AppElement) => fields.some((f) => labelOf(f) === labelOf(field))

  it('after both credential fields are filled, a repeated fill points at the sign-in button', () => {
    const reason = repeatRefusal(FILL, login, page, { account: 'Teen 15', filled: filledOf(login, password) })
    expect(reason.startsWith(REPEATED_ACTION)).toBe(true)
    expect(reason).toContain('For Teen 15 this check has already filled "Username" (e1) and "Password" (e2) in this form.')
    expect(reason.endsWith('Both fields are filled: click the "Sign in" button (e4) next.')).toBe(true)
  })

  it('with only one field filled, it names the field still to fill', () => {
    const reason = repeatRefusal(FILL, login, page, { account: 'Teen 15', filled: filledOf(login) })
    expect(reason).toContain('already filled "Username" (e1) in this form.')
    expect(reason.endsWith('Next, fill "Password" (e2).')).toBe(true)
    expect(reason).not.toContain('Sign in')
  })

  it('a typed fill counts as a fill too', () => {
    const typed: Act = { type: 'type', ref: 'e1', text: 'teen.login@example.test' }
    const reason = repeatRefusal(typed, login, page, { account: 'Teen 15', filled: filledOf(login, password) })
    expect(reason.endsWith('Both fields are filled: click the "Sign in" button (e4) next.')).toBe(true)
    expect(reason).not.toContain('teen.login')
  })

  it('names no button when the form has none that signs in', () => {
    const noButton = view([login, password, show])
    const reason = repeatRefusal(FILL, login, noButton, { account: 'Teen 15', filled: filledOf(login, password) })
    expect(reason).toBe(`${REPEATED_ACTION} For Teen 15 this check has already filled "Username" (e1) and "Password" (e2) in this form.`)
  })

  it('keeps the generic wording for a repeat that is not a fill, or without a page', () => {
    const click: Act = { type: 'click', ref: 'e3' }
    expect(repeatRefusal(click, show, page, { account: 'Teen 15', filled: filledOf(login, password) })).toBe(REPEATED_ACTION)
    expect(repeatRefusal({ type: 'open_link', url: '/settings' }, null, page, { account: 'Teen 15', filled: () => true })).toBe(REPEATED_ACTION)
    expect(repeatRefusal(FILL, login, null, { account: 'Teen 15', filled: () => true })).toBe(REPEATED_ACTION)
  })

  it('never shows a typed value, even one the page holds', () => {
    const holding = view([{ ...login, state: { value: 'teen.login@example.test' } }, { ...password, state: { value: 'Teen-Pass-111' } }, signIn])
    const reason = repeatRefusal(FILL, login, holding, { account: 'Teen 15', filled: () => true })
    expect(reason).not.toMatch(/teen\.login|Teen-Pass/)
  })
})

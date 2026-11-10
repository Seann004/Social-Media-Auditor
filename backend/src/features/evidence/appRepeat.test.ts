import { describe, expect, it } from 'vitest'
import { isRepeat, labelOf, pageState, type DoneAction } from './appRepeat.js'
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
    expect(isRepeat(done(FILL, el(), page, filled), FILL, el(), filled)).toBe(true)
  })

  it('a new ref for the same control is still the same element', () => {
    const page = view([el()])
    const again = view([el({ ref: 'e7' })])
    expect(isRepeat(done(FILL, el(), page, page), { ...FILL, ref: 'e7' }, el({ ref: 'e7' }), again)).toBe(true)
  })

  it('another field, another account or another text is not a repeat', () => {
    const page = view([el(), el({ ref: 'e2', name: 'Password', inputType: 'password' })])
    const last = done(FILL, el(), page, page)
    expect(isRepeat(last, { ...FILL, ref: 'e2' }, el({ ref: 'e2', name: 'Password', inputType: 'password' }), page)).toBe(false)
    expect(isRepeat(last, { ...FILL, account: 'Adult 30' }, el(), page)).toBe(false)
    const typed: Act = { type: 'type', ref: 'e1', text: 'a' }
    expect(isRepeat(done(typed, el(), page, page), { ...typed, text: 'b' }, el(), page)).toBe(false)
  })

  it('an action that changed the address or the text is not a repeat', () => {
    const page = view([el()])
    const click: Act = { type: 'click', ref: 'e1' }
    expect(isRepeat(done(click, el(), page, view([el()], 'Sign in Wrong password')), click, el(), view([el()], 'Sign in Wrong password'))).toBe(false)
    const moved = view([el()], 'Sign in E-mail Password', 'https://app.test/login?next=1')
    expect(isRepeat(done(click, el(), page, moved), click, el(), moved)).toBe(false)
  })

  it('a toggle that changed only a control state is not a repeat', () => {
    const off = el({ role: 'switch', name: 'Private account', tag: 'button', inputType: null, state: { checked: false } })
    const on = { ...off, state: { checked: true } }
    const toggle: Act = { type: 'toggle', ref: 'e1' }
    expect(isRepeat(done(toggle, off, view([off]), view([on])), toggle, on, view([on]))).toBe(false)
  })

  it('a click that turned a password field into a text field changed the page', () => {
    const hidden = el({ ref: 'e2', name: 'Password', inputType: 'password' })
    const shown = { ...hidden, inputType: 'text' }
    const button = el({ ref: 'e3', role: 'button', name: 'Show password', tag: 'button', inputType: null })
    const click: Act = { type: 'click', ref: 'e3' }
    const before = view([hidden, button])
    const after = { ...view([shown, button]), hasPasswordField: false }
    expect(isRepeat(done(click, button, before, after), click, button, after)).toBe(false)
  })

  it('a page that changed since the last action is not a repeat', () => {
    const page = view([el()])
    expect(isRepeat(done(FILL, el(), page, page), FILL, el(), view([el()], 'Sign in E-mail Password Session expired'))).toBe(false)
  })

  it('nothing done yet, or no page, is never a repeat', () => {
    expect(isRepeat(null, FILL, el(), view([el()]))).toBe(false)
    expect(isRepeat(done(FILL, el(), view([el()]), view([el()])), FILL, el(), null)).toBe(false)
  })
})

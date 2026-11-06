import { describe, expect, it } from 'vitest'
import { checkAction } from './appSafety.js'
import { account, ADULT, allowed, CLICK, CLICK_TEEN, CTX, el, one, refused, view } from './appSafetyTestKit.js'
import type { AppElement } from './appTypes.js'

const FORM = 'g1'
const box = el('t', 'Write something', { role: 'textbox', tag: 'textarea', groupId: FORM })
const publicButton = el('b', 'Audience: Public', { role: 'button', groupId: FORM })
const onlyMe = el('a', 'Audience', { role: 'combobox', tag: 'select', groupId: FORM, state: { value: 'Only me' } })
const withTarget = (name: string, extra: Partial<AppElement> = {}) => el('e1', name, { groupId: FORM, contextText: '@teen15', ...extra })

describe('A11: Reply and Comment publish', () => {
  it.each(['Reply', 'Replying', 'Comment', 'Commenting', 'Replies'])('refuses "%s" on a test account post with no private audience', (name) => {
    refused(CLICK_TEEN, view([box, publicButton, withTarget(name)]), 'nothing_public')
    refused(CLICK_TEEN, view([box, withTarget(name)]), 'nothing_public')
    refused(CLICK_TEEN, view([withTarget(name, { groupId: null })]), 'nothing_public')
    refused({ type: 'toggle', ref: 'e1', target: 'Teen 15' }, view([withTarget(name, { role: 'switch' })]), 'nothing_public')
  })
  it('allows them when the form shows a private audience', () => {
    allowed(CLICK_TEEN, view([box, onlyMe, withTarget('Reply')]))
    allowed(CLICK_TEEN, view([box, onlyMe, withTarget('Comment')]))
  })
  const dm = (value: string, name = 'Reply') =>
    view(
      [
        el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value } }),
        box,
        el('e1', name, { groupId: FORM }),
      ],
      { url: 'https://app.test/messages/thread/9' },
    )
  it.each(['Reply', 'Comment'])('allows "%s" in a direct-message thread with exactly one test account', (name) => {
    allowed({ type: 'click', ref: 'e1', target: 'Teen 15' }, dm('teen15', name))
  })
  it('refuses them in a thread with a stranger, two people or the account in use', () => {
    for (const value of ['stranger', 'teen15, stranger', 'adult_a', '']) {
      refused({ type: 'click', ref: 'e1', target: 'Teen 15' }, dm(value), 'own_accounts')
    }
  })
  it('allows them on a message thread address named for one test account', () => {
    const thread = view([withTarget('Reply')], { url: 'https://app.test/messages/teen15' })
    allowed(CLICK_TEEN, thread)
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: 'https://app.test/messages/stranger' }), 'nothing_public')
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: 'https://app.test/posts/teen15' }), 'nothing_public')
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: 'https://app.test/messages/adult_a' }), 'nothing_public')
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: 'https://app.test/messages?with=teen15' }), 'nothing_public')
  })
  it.each(['dm', 'chat', 'direct', 'inbox', 'conversation', 'conversations', 'messages', 'message'])('treats /%s/teen15 as a thread', (segment) => {
    allowed(CLICK_TEEN, view([withTarget('Reply')], { url: `https://app.test/${segment}/teen15` }))
  })
  it('Send and Message are unchanged', () => {
    allowed(CLICK_TEEN, view([box, publicButton, withTarget('Send')]))
    allowed(CLICK_TEEN, view([box, publicButton, withTarget('Message')]))
  })
})

describe('A12: only plain ASCII handles match', () => {
  const T = 'teen15'
  it.each([
    ['fullwidth letters', '@ｔｅｅｎ15'],
    ['fullwidth digits', '@teen１５'],
    ['Cyrillic letters', '@tееn15'],
    ['zero-width joiner', '@teen‍15'],
    ['zero-width space', '@tee​n15'],
    ['soft hyphen', '@teen­15'],
    ['combining mark', '@teen15́'],
    ['fullwidth at sign', '＠teen15'],
    ['small at sign', '﹫teen15'],
    ['Kelvin sign', '@teen15k'.replace('k', 'K')],
    ['Turkish dotless i', '@ıteen15'],
  ])('refuses a handle with %s', (_name, ctx) => {
    refused(CLICK_TEEN, one('Message', { contextText: `${ctx} Message` }), 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: `hi ${ctx}` }, one('Search', { tag: 'input', inputType: 'text' }), 'own_accounts')
  })
  it('refuses a look-alike beside the real handle, and as the bare name on a profile', () => {
    refused(CLICK_TEEN, one('Message', { contextText: '@teen15 @ｔｅｅｎ15' }), 'own_accounts')
    refused(CLICK_TEEN, one('Message', { contextText: 'ｔｅｅｎ15' }, { url: 'https://app.test/u/teen15' }), 'own_accounts')
    refused(CLICK_TEEN, one('Message', { contextText: 'teen‍15' }, { url: 'https://app.test/u/teen15' }), 'own_accounts')
    refused(CLICK_TEEN, one('Message', { contextText: 'teen15' }, { url: 'https://app.test/u/ｔｅｅｎ15' }), 'own_accounts')
  })
  it('refuses a look-alike as the recipient value', () => {
    for (const value of ['ｔｅｅｎ15', 'tееn15', 'teen‍15']) {
      const v = view([
        el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value } }),
        el('send', 'Send', { groupId: FORM }),
      ])
      refused({ type: 'click', ref: 'send', target: 'Teen 15' }, v, 'own_accounts')
    }
  })
  it('lower-cases ASCII letters only', () => {
    allowed(CLICK_TEEN, one('Message', { contextText: '@TEEN15 Message' }))
    allowed(CLICK_TEEN, one('Message', { contextText: 'TeEn15' }, { url: 'https://app.test/u/TEEN15' }))
    allowed({ type: 'type', ref: 'e1', text: 'hi @Teen15' }, one('Search', { tag: 'input', inputType: 'text' }))
  })
  it('a saved handle that is not plain ASCII never matches anything', () => {
    const ctx = { ...CTX, accounts: [account('Teen 15', ['@téen15']), ADULT] }
    refused(CLICK_TEEN, one('Message', { contextText: '@téen15 Message' }), 'own_accounts', ctx)
    expect(T).toBe('teen15')
  })
})

describe('A13: a submit button of a composer takes no safe-list exemption', () => {
  it.each(['Open', 'OK', 'Go', 'View', 'More', 'Menu'])('refuses "%s" as the last button of a form with a text box beside a Public audience', (name) => {
    refused(CLICK_TEEN, view([box, publicButton, withTarget(name)]), 'nothing_public')
    expect(checkAction(CLICK, view([box, publicButton, el('e1', name, { groupId: FORM })]), CTX).allowed).toBe(false)
  })
  it('refuses a type=submit input, wherever it sits in the form', () => {
    const submit = el('s', 'Open', { tag: 'input', inputType: 'submit', groupId: FORM, contextText: '@teen15' })
    refused({ type: 'click', ref: 's', target: 'Teen 15' }, view([box, publicButton, submit, el('x', 'Preview', { groupId: FORM })]), 'nothing_public')
  })
  it('allows it when the audience is private', () => {
    allowed(CLICK_TEEN, view([box, onlyMe, withTarget('Open')]))
  })
  it('keeps a safe-list button that is not the last button, with its person exemption', () => {
    allowed(CLICK, view([el('e1', 'Cancel', { groupId: FORM }), box, el('p', 'Post', { groupId: FORM })]))
    allowed(CLICK, view([el('e1', 'Close', { groupId: FORM }), box, el('p', 'Post', { groupId: FORM })]))
  })
  it('keeps a safe-list button in a form without a text or media input', () => {
    allowed(CLICK, view([el('c', 'Dark mode', { role: 'switch', groupId: FORM }), el('e1', 'Close', { groupId: FORM })]))
    allowed(CLICK, view([el('c', 'Colour', { tag: 'input', inputType: 'checkbox', groupId: FORM }), el('e1', 'Menu', { groupId: FORM })]))
  })
  it('keeps a search form working', () => {
    const search = el('s', 'Search', { role: 'searchbox', tag: 'input', inputType: 'search', groupId: FORM })
    allowed(CLICK, view([search, el('e1', 'Search', { groupId: FORM })]))
    allowed(CLICK, view([el('s', 'Find', { role: 'textbox', tag: 'input', inputType: 'search', groupId: FORM }), el('e1', 'Search', { groupId: FORM })]))
  })
  it('keeps a sign-in form working', () => {
    const v = view(
      [
        el('u', 'Username', { tag: 'input', inputType: 'text', groupId: FORM }),
        el('p', 'Password', { tag: 'input', inputType: 'password', groupId: FORM }),
        el('e1', 'Log in', { groupId: FORM }),
      ],
      { hasPasswordField: true },
    )
    allowed(CLICK, v)
  })
  it('a button outside any form is not a composer submit', () => {
    allowed(CLICK, one('Open'))
  })
})

describe('round 3: the audience control itself', () => {
  it('choosing any option of an audience control that sits in no composer is not publishing', () => {
    const select = el('e1', 'Post audience', { role: 'combobox', tag: 'select', groupId: FORM, state: { value: 'Public' } })
    allowed({ type: 'select', ref: 'e1', option: 'Friends' }, view([select]))
  })
})

describe('round 3: what counts as the submit button of a composer', () => {
  const at = (...rest: ReturnType<typeof el>[]) => view([box, onlyMe, ...rest])
  it('a safe-list label on the submit button is still treated as reaching people', () => {
    refused(CLICK, at(el('e1', 'Open', { groupId: FORM })), 'own_accounts')
  })
  it('only the last button of the form is the submit button', () => {
    allowed(CLICK, view([el('e1', 'Open', { groupId: FORM }), box, onlyMe, el('x', 'Go', { groupId: FORM })]))
    refused(CLICK, view([box, onlyMe, el('e1', 'Open', { groupId: FORM }), el('f', 'Footer', { groupId: null })]), 'own_accounts')
  })
  it('a submit input counts as the last button even when it is not a button element', () => {
    allowed(CLICK, view([el('e1', 'Open', { groupId: FORM }), box, onlyMe, el('x', 'Go', { tag: 'input', role: 'generic', inputType: 'submit', groupId: FORM })]))
  })
  it.each([
    ['a role=button element', { role: 'button', tag: 'div' }],
    ['a button element', { role: 'link', tag: 'button' }],
    ['an input type=button', { role: 'generic', tag: 'input', inputType: 'button' }],
  ])('%s can be the submit button', (_name, extra) => {
    refused(CLICK, at(el('e1', 'Open', { groupId: FORM, ...extra })), 'own_accounts')
  })
  it('a form with only a file input is a composer', () => {
    const media = el('m', 'Photo', { tag: 'input', inputType: 'file', groupId: FORM, role: 'generic' })
    refused(CLICK, view([media, el('e1', 'Open', { groupId: FORM })]), 'own_accounts')
  })
  it('a search form is not a composer, however the search box is marked', () => {
    allowed(CLICK, view([el('s', 'Find', { role: 'searchbox', tag: 'input', inputType: 'text', groupId: FORM }), el('e1', 'Search', { groupId: FORM })]))
    allowed(CLICK, view([el('s', 'Find', { role: 'textbox', tag: 'input', inputType: 'search', groupId: FORM }), el('e1', 'Search', { groupId: FORM })]))
  })
})

describe('round 3: look-alike corner cases', () => {
  it('an address-like text does not excuse a look-alike mention', () => {
    refused(CLICK_TEEN, one('Message', { contextText: 'mail x@teen15 and @ｔｅｅｎ15 Message' }), 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: 'mail x@stranger and @ｓｔｒａｎｇｅｒ' }, one('Search', { tag: 'input', inputType: 'text' }), 'own_accounts')
  })
  it('an invisible character after the bare name on a profile page is a different name', () => {
    for (const ctx of ['teen15\u200d', 'teen15\u200b', '\u200dteen15']) {
      refused(CLICK_TEEN, one('Message', { contextText: ctx }, { url: 'https://app.test/u/teen15' }), 'own_accounts')
    }
  })
  it('does not fold letters like the Kelvin sign into ASCII', () => {
    const ctx = { ...CTX, accounts: [account('Teen 15', ['@kid15']), ADULT] }
    refused(CLICK_TEEN, one('Message', { contextText: '\u212aid15' }, { url: 'https://app.test/u/kid15' }), 'own_accounts', ctx)
    allowed(CLICK_TEEN, one('Message', { contextText: 'KID15' }, { url: 'https://app.test/u/kid15' }), ctx)
  })
})

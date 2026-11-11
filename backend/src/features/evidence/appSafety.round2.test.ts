import { describe, expect, it } from 'vitest'
import { checkAction, type SafetyContext } from './appSafety.js'
import { account, ADULT, allowed, CLICK, CLICK_TEEN, CTX, el, one, refused, view } from './appSafetyTestKit.js'

const FORM = 'g1'
const postBox = el('t', "What's on your mind?", { role: 'textbox', tag: 'textarea', groupId: FORM })
const audienceSelect = (value: string) =>
  el('a', 'Audience', { role: 'combobox', tag: 'select', groupId: FORM, state: { value, options: ['Public', 'Only me'] } })
const postButton = el('p', 'Post', { groupId: FORM })
const composer = (value: string) => view([postBox, audienceSelect(value), postButton])

describe('round 2: choosing a private audience always goes through', () => {
  it('Post with Only me goes through in a composer that starts as Public', () => {
    allowed({ type: 'select', ref: 'a', option: 'Only me' }, composer('Public'))
    allowed({ type: 'type', ref: 't', text: 'hello there' }, composer('Only me'))
    allowed({ type: 'click', ref: 'p' }, composer('Only me'))
    refused({ type: 'click', ref: 'p' }, composer('Public'), 'nothing_public')
  })
  it.each(['Only me', 'Private', 'Just me', 'Test accounts only', 'only me'])('selecting the option "%s" is allowed beside a text box', (option) => {
    allowed({ type: 'select', ref: 'a', option }, composer('Public'))
  })
  it.each(['Public', 'Everyone', 'Friends of friends', 'Followers', ''])('selecting the option "%s" stays refused beside a text box', (option) => {
    refused({ type: 'select', ref: 'a', option }, composer('Only me'), 'own_accounts')
  })
  it.each(['Only me', 'Private', 'Just me', 'Test accounts only'])('clicking the radio "%s" is allowed beside a text box', (name) => {
    const radio = el('r', name, { role: 'radio', groupId: FORM, contextText: 'Audience Public Only me' })
    allowed({ type: 'click', ref: 'r' }, view([postBox, radio, postButton]))
  })
  it.each(['Public', 'Everyone', 'Friends of friends'])('clicking the radio "%s" stays refused beside a text box', (name) => {
    const radio = el('r', name, { role: 'radio', groupId: FORM, contextText: 'Audience Public Only me' })
    refused({ type: 'click', ref: 'r' }, view([postBox, radio, postButton]), 'own_accounts')
  })
  it('a private option does not skip the destructive rule', () => {
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([postBox, el('a', 'Delete audience', { role: 'combobox', tag: 'select', groupId: FORM })]), 'destructive')
  })
  it('does not accept a qualified or negated private option as proof of privacy', () => {
    for (const value of ['Not private', 'Private group (visible to all members)', 'Non-private']) {
      refused({ type: 'click', ref: 'p' }, composer(value), 'nothing_public')
    }
  })
  it('a checked cross-post control counts as public', () => {
    const cross = el('c', 'Also share to Facebook', { role: 'switch', groupId: FORM, state: { checked: true } })
    refused({ type: 'click', ref: 'p' }, view([postBox, audienceSelect('Only me'), cross, postButton]), 'nothing_public')
  })
  it('typing into a post box needs no target, only the typed-text rules', () => {
    refused({ type: 'type', ref: 't', text: 'hi @stranger' }, composer('Only me'), 'own_accounts')
    refused({ type: 'type', ref: 't', text: 'two\nlines' }, composer('Only me'), 'own_accounts')
  })
})

describe('round 2: naming a target never exempts a non-person submit', () => {
  const publicButton = el('b', 'Audience: Public', { role: 'button', groupId: FORM })
  it.each(['', 'Save', 'Done', 'Submit', 'Next', 'Create'])('refuses "%s" with a target beside a visible Public audience', (name) => {
    const submit = el('e1', name, { groupId: FORM, contextText: '@teen15' })
    refused(CLICK_TEEN, view([postBox, publicButton, submit]), 'nothing_public')
  })
  it('refuses them with no audience control at all, and allows them with a private one', () => {
    const submit = el('e1', 'Save', { groupId: FORM, contextText: '@teen15' })
    refused(CLICK_TEEN, view([postBox, submit]), 'nothing_public')
    allowed(CLICK_TEEN, view([postBox, audienceSelect('Only me'), submit]))
  })
  it('still lets a person word to a proven test account through', () => {
    for (const name of ['Send', 'Message']) {
      allowed(CLICK_TEEN, view([postBox, publicButton, el('e1', name, { groupId: FORM, contextText: '@teen15' })]))
    }
  })
})

describe('round 2: a handle runs to the end of its server', () => {
  const SERVER_ACCOUNT: SafetyContext = { ...CTX, accounts: [account('Teen 15', ['@teen15@home.social']), ADULT] }
  it('refuses a stranger on another server who shares the name', () => {
    refused(CLICK_TEEN, one('Follow', { contextText: '@teen15@evil.social Follow' }), 'own_accounts')
    refused(CLICK_TEEN, one('Follow', { contextText: 'Remote @teen15@evil.social Follow' }, { url: 'https://app.test/@teen15' }), 'own_accounts')
    refused(CLICK_TEEN, one('Follow', { contextText: 'teen15@evil Follow' }, { url: 'https://app.test/u/teen15' }), 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: 'hi @teen15@evil.social' }, one('Search', { tag: 'input', inputType: 'text' }), 'own_accounts')
  })
  it('a handle stored with a server matches only that exact handle', () => {
    allowed(CLICK_TEEN, one('Follow', { contextText: '@teen15@home.social Follow' }), SERVER_ACCOUNT)
    allowed(CLICK_TEEN, one('Follow', { contextText: '@Teen15@Home.Social Follow' }), SERVER_ACCOUNT)
    refused(CLICK_TEEN, one('Follow', { contextText: '@teen15 Follow' }), 'own_accounts', SERVER_ACCOUNT)
    refused(CLICK_TEEN, one('Follow', { contextText: '@teen15@evil.social Follow' }), 'own_accounts', SERVER_ACCOUNT)
    allowed({ type: 'type', ref: 'e1', text: 'hi @teen15@home.social' }, one('Search', { tag: 'input', inputType: 'text' }), SERVER_ACCOUNT)
  })
  it('a handle stored without a server matches only a bare mention', () => {
    allowed(CLICK_TEEN, one('Follow', { contextText: '@teen15 Follow' }))
    allowed(CLICK_TEEN, one('Follow', { contextText: '@teen15, Follow' }))
  })
  it('an address is not a mention', () => {
    allowed({ type: 'type', ref: 'e1', text: 'mail a@b.com' }, one('Search', { tag: 'input', inputType: 'text' }))
  })
})

describe('round 2: the recipient field counts as context', () => {
  const compose = (value: string | undefined, extra: Partial<Parameters<typeof view>[1]> = {}) =>
    view(
      [
        el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, contextText: 'To Message Send', state: value === undefined ? {} : { value } }),
        el('msg', 'Message', { role: 'textbox', tag: 'textarea', groupId: FORM, contextText: 'To Message Send' }),
        el('send', 'Send', { groupId: FORM, contextText: 'To Message Send' }),
      ],
      { url: 'https://app.test/messages/new?to=teen15', ...extra },
    )
  it('lets the adult type and send to the teen when the To value is exactly the teen handle', () => {
    for (const value of ['teen15', '@teen15', ' TEEN15 ']) {
      allowed({ type: 'type', ref: 'msg', text: 'hi' }, compose(value))
      allowed({ type: 'click', ref: 'send', target: 'Teen 15' }, compose(value))
    }
  })
  it('refuses a stranger, two handles, a server handle or nothing', () => {
    for (const value of ['stranger', 'teen15, stranger', 'teen15 stranger', 'teen15;stranger', 'teen15@evil.social', '']) {
      refused({ type: 'type', ref: 'msg', text: 'hi' }, compose(value), 'own_accounts')
      refused({ type: 'click', ref: 'send', target: 'Teen 15' }, compose(value), 'own_accounts')
    }
    refused({ type: 'type', ref: 'msg', text: 'hi' }, compose(undefined), 'own_accounts')
  })
  it('refuses the teen as recipient when the context also shows a stranger', () => {
    const v = view([
      el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value: 'teen15' } }),
      el('send', 'Send', { groupId: FORM, contextText: '@stranger' }),
    ])
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, v, 'own_accounts')
  })
  it('never lets the query string prove a target', () => {
    const v = view([el('send', 'Send', { groupId: FORM, contextText: 'To Message Send' })], { url: 'https://app.test/messages/new?to=teen15' })
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, v, 'own_accounts')
  })
  it('only a recipient-named input counts, and only inside the same form', () => {
    const other = view([
      el('to', 'Nickname', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value: 'teen15' } }),
      el('send', 'Send', { groupId: FORM }),
    ])
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, other, 'own_accounts')
    const apart = view([
      el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: 'g2', state: { value: 'teen15' } }),
      el('send', 'Send', { groupId: FORM }),
    ])
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, apart, 'own_accounts')
  })
  it.each(['To', 'Recipient', 'Recipients', 'Send to'])('counts the input labelled "%s"', (label) => {
    const v = view([
      el('to', label, { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value: 'teen15' } }),
      el('send', 'Send', { groupId: FORM }),
    ])
    allowed({ type: 'click', ref: 'send', target: 'Teen 15' }, v)
  })
  it('the To account in use is not a valid recipient', () => {
    refused({ type: 'type', ref: 'msg', text: 'hi' }, compose('adult_a'), 'own_accounts')
  })
})

describe('round 2: smaller fixes', () => {
  it('refuses a relative link that resolves under a destructive directory', () => {
    refused({ type: 'open_link', ref: 'e1' }, one('Continue', { role: 'link', href: 'step2' }, { url: 'https://app.test/account/deactivate/' }), 'destructive')
  })
  it.each(['\u0085', '\v', '\f'])('refuses typed text holding the line-break character %j', (ch) => {
    refused({ type: 'type', ref: 'e1', text: `a${ch}b` }, one('Search', { tag: 'input', inputType: 'text' }), 'own_accounts')
  })
  it('keeps the unrelated click allowed', () => {
    allowed(CLICK, one('Settings'))
    expect(checkAction({ type: 'back' }, view([]), CTX)).toEqual({ allowed: true })
  })
})

describe('round 2: look-alike continuations and audiences', () => {
  it.each(['@teen15\u200b_x', '@teen15\u200dx', '@teen15\u00adx', '@teen15\u0301'])('refuses %j, a longer name made of invisible or combining marks', (ctx) => {
    refused(CLICK_TEEN, one('Message', { contextText: `${ctx} Message` }), 'own_accounts')
  })
  it('still reads the plain handle', () => {
    allowed(CLICK_TEEN, one('Message', { contextText: '@teen15 Message' }))
  })
  it.each(['Unlisted (private link)', 'Private unlisted', 'Private link', 'Private, visible to all', 'Private, visible to members', 'Private for all members', 'Private group', 'Private, visible to everyone'])('does not take "%s" as private', (value) => {
    refused({ type: 'click', ref: 'p' }, composer(value), 'nothing_public')
  })
  it('a link is not an audience control', () => {
    const link = el('l', 'Privacy: Private', { role: 'link', groupId: FORM, state: { selected: true } })
    refused({ type: 'click', ref: 'p' }, view([postBox, link, postButton]), 'nothing_public')
  })
  it.each(['/follow-user?id=1', '/send_message', '/graphql?query=mutation', '/graphql'])('refuses open_link to the acting address %s', (path) => {
    refused({ type: 'open_link', url: `https://app.test${path}` }, view([]), 'destructive')
  })
  it.each(['/followers', '/author', '/settings'])('allows open_link to %s', (path) => {
    allowed({ type: 'open_link', url: `https://app.test${path}` }, view([]))
  })
})
describe('round 2: typing on a sign-in page', () => {
  it('a box beside a person word is still typing to a person on a sign-in page', () => {
    const v = view(
      [
        el('e1', 'Notes', { tag: 'input', inputType: 'text', groupId: 'g1' }),
        el('s', 'Send', { groupId: 'g1' }),
        el('p', 'Password', { tag: 'input', inputType: 'password', groupId: 'g1' }),
      ],
      { url: 'https://app.test/login', hasPasswordField: true },
    )
    refused({ type: 'type', ref: 'e1', text: 'hi' }, v, 'own_accounts')
  })
})
describe('round 2: more recipient and audience-choice cases', () => {
  const toInput = (ref: string, value: string, extra = {}) =>
    el(ref, 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value }, ...extra })
  const send = (extra = {}) => el('send', 'Send', { groupId: FORM, ...extra })
  it('refuses two recipient fields that hold different handles', () => {
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, view([toInput('t1', 'teen15'), toInput('t2', 'stranger'), send()]), 'own_accounts')
    allowed({ type: 'click', ref: 'send', target: 'Teen 15' }, view([toInput('t1', 'teen15'), toInput('t2', 'TEEN15'), send()]))
  })
  it('reads the recipient value of the box being typed into', () => {
    allowed({ type: 'type', ref: 't1', text: '@teen15' }, view([toInput('t1', 'teen15'), send()]))
    refused({ type: 'type', ref: 't1', text: '@teen15' }, view([toInput('t1', 'stranger'), send()]), 'own_accounts')
  })
  it('ignores an empty recipient field when the surroundings prove the target', () => {
    for (const value of ['', '   ']) {
      allowed({ type: 'click', ref: 'send', target: 'Teen 15' }, view([toInput('t1', value), send({ contextText: '@teen15' })]))
    }
  })
  it('does not read the value of a select or a button labelled To', () => {
    const select = el('t1', 'To', { role: 'combobox', tag: 'select', groupId: FORM, state: { value: 'teen15' } })
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, view([select, send()]), 'own_accounts')
    const button = el('t1', 'To', { role: 'button', tag: 'button', groupId: FORM, state: { value: 'teen15' } })
    refused({ type: 'click', ref: 'send', target: 'Teen 15' }, view([button, send()]), 'own_accounts')
  })
  it('only a click, toggle or select can choose a private option', () => {
    const box = el('e1', 'Only me', { tag: 'textarea', role: 'textbox', contextText: 'Audience @stranger' })
    refused({ type: 'type', ref: 'e1', text: 'hi' }, view([box]), 'own_accounts')
  })
  it('a control named Private or Only me counts only as an option control inside an audience context (round 4)', () => {
    const textBoxMate = el('t', 'Say something', { tag: 'textarea', role: 'textbox', groupId: FORM })
    refused(CLICK, view([el('e1', 'Private message', { groupId: FORM }), textBoxMate]), 'own_accounts')
    refused(CLICK, view([el('e1', 'Only me', { groupId: FORM }), textBoxMate]), 'own_accounts')
    refused(CLICK, view([el('e1', 'Only me', { groupId: FORM, contextText: 'Audience' }), textBoxMate]), 'own_accounts')
    refused(CLICK, view([el('e1', 'Audience: Only me', { groupId: FORM }), textBoxMate]), 'own_accounts')
    refused(CLICK, view([el('e1', 'Only me', { role: 'radio', groupId: FORM }), textBoxMate]), 'own_accounts')
    allowed(CLICK, view([el('e1', 'Only me', { role: 'radio', groupId: FORM, contextText: 'Audience' }), textBoxMate]))
    allowed(CLICK, view([el('e1', 'Only me', { role: 'option', groupId: FORM, contextText: 'Audience' }), textBoxMate]))
    refused({ type: 'toggle', ref: 'e1' }, view([el('e1', 'Only me', { role: 'switch', groupId: FORM, contextText: 'Audience' }), textBoxMate]), 'own_accounts')
  })
  it('a form-ending name takes the publishing path even when it also holds a person word', () => {
    const publicButton = el('b', 'Audience: Public', { role: 'button', groupId: FORM })
    for (const name of ['Next message', 'Done sending', 'Save reply']) {
      refused(CLICK_TEEN, view([postBox, publicButton, el('e1', name, { groupId: FORM, contextText: '@teen15' })]), 'nothing_public')
    }
  })
})

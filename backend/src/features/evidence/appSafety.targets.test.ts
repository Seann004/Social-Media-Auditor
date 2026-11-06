import { describe, expect, it } from 'vitest'
import { checkAction } from './appSafety.js'
import { account, allowed, CLICK, CLICK_TEEN, CTX, el, one, refused, TEEN, view } from './appSafetyTestKit.js'

const PROFILE = { url: 'https://app.test/u/teen15' }

describe('own accounts: targets', () => {
  it('refuses a person action with no target', () => {
    refused(CLICK, one('Message', { contextText: '@teen15' }, PROFILE), 'own_accounts')
  })
  it('refuses a target that is not a test account', () => {
    refused({ ...CLICK, target: 'Stranger' }, one('Message', { contextText: '@teen15' }), 'own_accounts')
  })
  it('refuses targeting the account in use', () => {
    refused({ ...CLICK, target: 'Adult' }, one('Message', { contextText: '@adult_a' }), 'own_accounts')
  })
  it('refuses an account saved with no handles, naming it', () => {
    expect(checkAction({ ...CLICK, target: 'Ghost' }, one('Message', {}, { url: 'https://app.test/u/ghost' }), CTX)).toEqual({
      allowed: false,
      rule: 'own_accounts',
      reason: 'Ghost has no display handle, so nothing can be sent to it.',
    })
  })
  it('does not count a display name as a handle', () => {
    const ctx = { ...CTX, accounts: [account('Teen 15', ['Teen Fifteen'])] }
    const v = one('Message', { contextText: 'Teen Fifteen' }, PROFILE)
    expect(checkAction(CLICK_TEEN, v, ctx)).toMatchObject({ allowed: false, reason: expect.stringContaining('no display handle') })
  })
  it('refuses switch_account and fill_credential for an unknown label', () => {
    refused({ type: 'switch_account', account: 'Nobody' }, view([]), 'own_accounts')
    const f = el('e1', 'Password', { tag: 'input', inputType: 'password' })
    refused({ type: 'fill_credential', ref: 'e1', account: 'Nobody', field: 'password' }, view([f], { hasPasswordField: true }), 'own_accounts')
  })
  it('allows switch_account for a listed label', () => {
    allowed({ type: 'switch_account', account: 'Teen 15' }, view([]))
  })
})

describe('own accounts: proof from the control surroundings', () => {
  it('allows when the handle is the only one around the control', () => {
    allowed(CLICK_TEEN, one('Message', { contextText: 'Teen Fifteen @teen15' }))
  })
  it.each(['@TEEN15', '@teen15.', '@teen15,', '(@teen15)', '＠teen15'])('allows the handle written as %s', (ctx) => {
    allowed(CLICK_TEEN, one('Message', { contextText: ctx }))
  })
  it('refuses a card naming both our account and a stranger', () => {
    refused(CLICK_TEEN, one('Message', { contextText: '@stranger and @teen15 liked this' }), 'own_accounts')
  })
  it('refuses a group chat with a stranger', () => {
    refused(CLICK_TEEN, one('Send', { contextText: 'Group: Teen Fifteen, @stranger' }), 'own_accounts')
  })
  it('refuses a stranger when the handle is only part of a longer one', () => {
    for (const ctx of ['@teen150', '@teen15.real', '@teen15-fan', '@teen15_x', '@xteen15', 'a@teen15.com']) {
      refused(CLICK_TEEN, one('Message', { contextText: ctx }, PROFILE), 'own_accounts')
    }
  })
  it('reads the name of the control too', () => {
    refused(CLICK_TEEN, one('Message @stranger', { contextText: '@teen15' }), 'own_accounts')
  })
  it('refuses a Follow in an article by a stranger even when targeting Teen 15', () => {
    refused(CLICK_TEEN, one('Follow', { contextText: 'Article by @stranger: a long story' }), 'own_accounts')
  })
})

describe('own accounts: proof from the address', () => {
  it('allows on a profile page when the control surroundings name the handle', () => {
    allowed(CLICK_TEEN, one('Message', { contextText: 'teen15' }, PROFILE))
    allowed(CLICK_TEEN, one('Message', { contextText: 'teen15' }, { url: 'https://app.test/@teen15' }))
    allowed(CLICK_TEEN, one('Message', { contextText: 'TEEN15 Message' }, { url: 'https://app.test/u/TEEN15' }))
  })
  it('refuses when the surroundings are empty', () => {
    refused(CLICK_TEEN, one('Message', {}, PROFILE), 'own_accounts')
  })
  it('refuses a suggested stranger known only by display name', () => {
    refused(CLICK_TEEN, one('Follow', { contextText: 'Jamie Smith Follow' }, PROFILE), 'own_accounts')
  })
  it('refuses when the surroundings show another handle', () => {
    refused(CLICK_TEEN, one('Message', { contextText: 'teen15 @stranger' }, PROFILE), 'own_accounts')
  })
  it('refuses look-alike path segments', () => {
    for (const url of ['https://app.test/u/teen15.real', 'https://app.test/u/teen15-fan', 'https://app.test/u/teen150']) {
      refused(CLICK_TEEN, one('Message', { contextText: 'teen15' }, { url }), 'own_accounts')
    }
  })
  it('does not count a query string, a search page or a title', () => {
    refused(CLICK_TEEN, one('Send', { contextText: 'teen15' }, { url: 'https://app.test/messages/new?to=teen15' }), 'own_accounts')
    refused(CLICK_TEEN, one('Follow', { contextText: 'teen15' }, { url: 'https://app.test/search?q=teen15' }), 'own_accounts')
    refused(CLICK_TEEN, one('Message', { contextText: 'teen15' }, { title: 'Chat with teen15' }), 'own_accounts')
  })
  it('does not count the bare name when the page is not that profile', () => {
    refused(CLICK_TEEN, one('Message', { contextText: 'teen15' }), 'own_accounts')
  })
})

describe('own accounts: unknown controls in a person context', () => {
  it.each(['', 'Envoyer', 'Nachricht senden', 'Submit', 'Boost it', 'Whatever', 'Messages'])('refuses "%s" when its surroundings name a handle', (name) => {
    refused(CLICK, one(name, { contextText: '@stranger' }), 'own_accounts')
  })
  it('refuses an unknown control that shares a form with a text box', () => {
    const v = view([el('e1', 'Zap', { groupId: 'g1' }), el('t', 'Say something', { tag: 'textarea', role: 'textbox', groupId: 'g1' })])
    refused(CLICK, v, 'own_accounts')
    const media = view([el('e1', 'Zap', { groupId: 'g1' }), el('m', 'Photo', { tag: 'input', inputType: 'file', groupId: 'g1' })])
    refused(CLICK, media, 'own_accounts')
    const search = view([el('e1', 'Zap', { groupId: 'g1' }), el('t', 'Find', { tag: 'input', inputType: 'search', groupId: 'g1' })])
    refused(CLICK, search, 'own_accounts')
  })
  it.each(['Open', 'View', 'Settings', 'Privacy', 'Privacy settings', 'Back', 'Next page', 'Previous page', 'Menu', 'Close', 'Cancel', 'More', 'Home', 'Profile', 'About', 'Overview', 'Posts', 'Photos', 'Videos', 'Search', 'Help'])(
    'allows "%s" in a person context',
    (name) => {
      allowed(CLICK, one(name, { contextText: '@stranger' }))
      const v = view([el('e1', name, { groupId: 'g1' }), el('t', 'Say something', { tag: 'textarea', role: 'textbox', groupId: 'g1' })])
      allowed(CLICK, v)
    },
  )
  it('allows an unnamed control in a form with no text box and no person around it', () => {
    const v = view([el('e1', '', { groupId: 'g1', contextText: 'toolbar' }), el('c', 'Dark mode', { role: 'switch', groupId: 'g1' })])
    allowed(CLICK, v)
  })
  it('does not stop the sign-in button of a login form', () => {
    const v = view(
      [
        el('e1', 'Log in', { groupId: 'g1' }),
        el('u', 'Username', { tag: 'input', inputType: 'text', groupId: 'g1' }),
        el('p', 'Password', { tag: 'input', inputType: 'password', groupId: 'g1' }),
      ],
      { hasPasswordField: true, url: 'https://app.test/login' },
    )
    allowed(CLICK, v)
  })
  it('does not stop the sign-in button of a login page', () => {
    const v = view([el('e1', 'Continue', { groupId: 'g1' }), el('u', 'Username', { tag: 'input', inputType: 'text', groupId: 'g1' })], { url: 'https://app.test/login' })
    allowed(CLICK, v)
  })
})

describe('own accounts: person words', () => {
  const WORDS = [
    'Message', 'Messages', 'Messaging', 'Send', 'Sending', 'Follow', 'Following', 'Followers', 'Add friend', 'Friend request', 'Invite', 'Invited', 'Inviting',
    'Comment', 'Commenting', 'Reply', 'Replying', 'Tag', 'Tagging', 'Mention', 'Mentioning', 'Chat', 'Chatting', 'DM', 'DMs', 'Connect', 'Poke',
    'Wave', 'Call', 'Calling', 'Video call', 'Friend request', 'Request', 'Accept', 'Join group', 'Like', 'Liking', 'Duet', 'Stitch', 'Remix', 'Envoyer', 'Enviar',
    'Senden', 'Nachricht', 'Mensaje', 'Mensagem', 'Seguir', 'Suivre', 'Folgen', 'Abonner',
  ]
  it.each(WORDS)('"%s" needs a target', (name) => {
    refused(CLICK, one(name), 'own_accounts')
    refused({ type: 'toggle', ref: 'e1' }, one(name, { role: 'switch' }), 'own_accounts')
  })
  it('lets a verified target through for every one of them', () => {
    for (const name of ['Message', 'Follow', 'Reply', 'Poke']) allowed(CLICK_TEEN, one(name, { contextText: '@teen15' }))
  })
  it.each(['To', 'Recipients', 'Send to', 'Share with', 'Add people', 'Contacts', 'CC'])('select "%s" is a recipient field', (name) => {
    refused({ type: 'select', ref: 'e1', option: 'stranger' }, one(name, { role: 'combobox', tag: 'select' }), 'own_accounts')
  })
  it('allows a toggle or select with a verified target', () => {
    allowed({ type: 'toggle', ref: 'e1', target: 'Teen 15' }, one('Follow', { role: 'switch', contextText: '@teen15' }))
  })
})

describe('own accounts: typing', () => {
  const box = (extra = {}) => one('Message box', { tag: 'textarea', role: 'textbox', ...extra })
  it('needs a target for a message box', () => {
    refused({ type: 'type', ref: 'e1', text: 'hi there' }, box(), 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: 'hi there' }, one('Message @stranger', { tag: 'textarea' }), 'own_accounts')
  })
  it('checks the box surroundings against the target', () => {
    refused({ type: 'type', ref: 'e1', text: 'hi' }, box({ contextText: '@stranger' }), 'own_accounts')
  })
  it('refuses a box that shows the account in use, two accounts, or a stranger beside ours', () => {
    for (const contextText of ['@adult_a', '@teen15 @adult_a', '@teen15 @stranger']) {
      refused({ type: 'type', ref: 'e1', text: 'hi' }, box({ contextText }), 'own_accounts')
    }
  })
  it('refuses typing into a composer box that has a send button', () => {
    const v = view([el('e1', 'Write here', { tag: 'textarea', role: 'textbox', groupId: 'g1' }), el('s', 'Send', { groupId: 'g1' })])
    refused({ type: 'type', ref: 'e1', text: 'hi' }, v, 'own_accounts')
  })
  it('allows typing into a plain search box', () => {
    allowed({ type: 'type', ref: 'e1', text: 'cats' }, one('Search', { tag: 'input', inputType: 'search', role: 'searchbox' }))
  })
  it('refuses a stranger mention, in any form, and allows a test account', () => {
    const v = one('Search', { tag: 'input', inputType: 'text' })
    for (const text of ['hi @stranger', 'hi ＠stranger', 'hi @ñandú', 'hi @teen15-fan', 'hi @teen15.real', 'hi @teen150']) {
      refused({ type: 'type', ref: 'e1', text }, v, 'own_accounts')
    }
    for (const text of ['hi @teen15', 'hi @Adult_A', 'mail me at a@b.com', 'hi ＠teen15', 'user1@host', 'a_@host']) allowed({ type: 'type', ref: 'e1', text }, v)
  })
  it('refuses text with a line break', () => {
    const v = one('Search', { tag: 'input', inputType: 'text' })
    for (const text of ['hi\n', 'a\r\nb', 'a b']) refused({ type: 'type', ref: 'e1', text }, v, 'own_accounts')
  })
  it('allows typing to a verified target', () => {
    allowed({ type: 'type', ref: 'e1', text: 'hi @teen15' }, box({ contextText: '@teen15' }))
  })
})

describe('own accounts: shape of the target', () => {
  it('checks a target given on a harmless click too', () => {
    refused({ type: 'click', ref: 'e1', target: 'Stranger' }, one('Settings'), 'own_accounts')
  })
  it('uses TEEN as the fixture account', () => {
    expect(TEEN.handles).toContain('@teen15')
  })
})

describe('own accounts: fine points', () => {
  const textBoxes = [
    ['a textbox role', { role: 'textbox', tag: 'div', inputType: null }],
    ['a textarea', { role: 'generic', tag: 'textarea', inputType: null }],
    ['an input with no type', { role: 'generic', tag: 'input', inputType: null }],
    ['a text input', { role: 'generic', tag: 'input', inputType: 'text' }],
    ['a search input', { role: 'generic', tag: 'input', inputType: 'search' }],
    ['a file input', { role: 'generic', tag: 'input', inputType: 'file' }],
  ] as const
  it.each(textBoxes)('an unknown control beside %s is in a person context', (_name, extra) => {
    const v = view([el('e1', 'Zap', { groupId: 'g1' }), el('t', 'Field', { groupId: 'g1', ...extra })])
    refused(CLICK, v, 'own_accounts')
  })
  it('does not treat other inputs as text boxes', () => {
    const v = view([el('e1', 'Zap', { groupId: 'g1' }), el('t', 'Field', { groupId: 'g1', tag: 'input', inputType: 'checkbox' })])
    allowed(CLICK, v)
  })
  it('a form with a password field is a login form even away from a login address', () => {
    const v = view([
      el('e1', 'Log in', { groupId: 'g1' }),
      el('u', 'Username', { tag: 'input', inputType: 'text', groupId: 'g1' }),
      el('p', 'Password', { tag: 'input', inputType: 'password', groupId: 'g1' }),
    ])
    allowed(CLICK, v)
  })
  it.each(['Send', 'Message', 'Reply', 'Comment'])('typing beside a "%s" button is typing to a person', (name) => {
    const v = view([el('e1', 'Write here', { tag: 'textarea', role: 'textbox', groupId: 'g1' }), el('s', name, { groupId: 'g1' })])
    refused({ type: 'type', ref: 'e1', text: 'hi' }, v, 'own_accounts')
  })
  it.each(['Post', 'Done', 'Share', 'Save'])('typing beside a "%s" button reaches no one (the button is judged when pressed)', (name) => {
    const v = view([el('e1', 'Write here', { tag: 'textarea', role: 'textbox', groupId: 'g1' }), el('s', name, { groupId: 'g1' })])
    allowed({ type: 'type', ref: 'e1', text: 'hi' }, v)
  })
  it('typing a username is refused as an account change, even in a login form', () => {
    const v = view([el('e1', 'Username', { tag: 'input', inputType: 'text', groupId: 'g1' }), el('n', 'Next', { groupId: 'g1' })], { url: 'https://app.test/login' })
    refused({ type: 'type', ref: 'e1', text: 'hi' }, v, 'destructive')
  })
  it('tells the AI a target is needed', () => {
    const verdict = checkAction(CLICK, one('Message'), CTX)
    expect(verdict).toMatchObject({ allowed: false, reason: expect.stringContaining('needs a target') })
  })
  it('refuses a double at-sign mention and a bare carriage return or paragraph separator', () => {
    const v = one('Search', { tag: 'input', inputType: 'text' })
    refused({ type: 'type', ref: 'e1', text: 'hi @@stranger' }, v, 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: 'a\rb' }, v, 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: 'a\u2029b' }, v, 'own_accounts')
  })
  it('reads saved handles with spaces and capitals', () => {
    const ctx = { ...CTX, accounts: [account('Teen 15', ['  @Teen15 '])] }
    expect(checkAction(CLICK_TEEN, one('Message', { contextText: '@teen15' }), ctx)).toEqual({ allowed: true })
  })
  it.each(['xteen15', 'teen15x', 'a.teen15', 'a-teen15', '_teen15', 'teen15_', 'teen15.real', 'teen15-fan', 'teen15.x'])(
    'does not count %s as the name on a profile page',
    (ctx) => {
      refused(CLICK_TEEN, one('Message', { contextText: ctx }, PROFILE), 'own_accounts')
    },
  )
  it.each(['teen15', 'TEEN15 Message', 'by teen15.', 'teen15, Message', '"teen15"', 'ｔｅｅｎ１５'])('counts %s as the name on a profile page', (ctx) => {
    allowed(CLICK_TEEN, one('Message', { contextText: ctx }, PROFILE))
  })
  it('reads a percent-encoded profile address', () => {
    allowed(CLICK_TEEN, one('Message', { contextText: 'teen15' }, { url: 'https://app.test/u/%74een15' }))
  })
})

describe('own accounts: groups and names', () => {
  it('does not treat controls that sit in no form as sharing one', () => {
    const v = view([el('e1', 'Zap'), el('t', 'Field', { tag: 'textarea', role: 'textbox' })])
    allowed(CLICK, v)
  })
  it('does not count a control as its own form mate', () => {
    allowed(CLICK, view([el('e1', 'Zap', { tag: 'textarea', role: 'textbox', groupId: 'g1' })]))
  })
  it('reads a handle in the name of the control', () => {
    refused(CLICK, one('Zap @stranger'), 'own_accounts')
  })
})

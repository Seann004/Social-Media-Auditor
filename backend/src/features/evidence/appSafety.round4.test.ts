import { describe, expect, it } from 'vitest'
import { checkAction } from './appSafety.js'
import { mentionsOf } from './appSafetyText.js'
import { allowed, CLICK, CLICK_TEEN, CTX, el, one, refused, view } from './appSafetyTestKit.js'
import type { AppElement } from './appTypes.js'

const FORM = 'g1'
const box = el('t', 'Write something', { role: 'textbox', tag: 'textarea', groupId: FORM })
const publicButton = el('b', 'Audience: Public', { role: 'button', groupId: FORM })
const audience = (value: string) => el('a', 'Audience', { role: 'combobox', tag: 'select', groupId: FORM, state: { value, options: ['Public', 'Only me'] } })
const post = el('p', 'Post', { groupId: FORM })
const withTarget = (name: string, extra: Partial<AppElement> = {}) => el('e1', name, { groupId: FORM, contextText: '@teen15', ...extra })
const SEARCH = one('Search', { tag: 'input', inputType: 'text' })

describe('I-3: an address proves a direct thread only as /<conversation word>/<handle>', () => {
  it.each(['/popout/teen15/chat', '/teen15/chat', '/u/teen15/messages', '/messages/teen15/stranger', '/teen15/messages/x', '/messages/x/teen15/y'])('refuses Reply on %s', (path) => {
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: `https://app.test${path}` }), 'nothing_public')
  })
  it('refuses Comment on /chat/teen15/posts/9', () => {
    refused(CLICK_TEEN, view([withTarget('Comment')], { url: 'https://app.test/chat/teen15/posts/9' }), 'nothing_public')
  })
  it.each(['/messages/teen15', '/t/teen15', '/dm/TEEN15', '/app/inbox/teen15', '/messages/teen15/'])('allows Reply on %s', (path) => {
    allowed(CLICK_TEEN, view([withTarget('Reply')], { url: `https://app.test${path}` }))
  })
  it('the conversation word must be the segment right before the handle', () => {
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: 'https://app.test/messages/thread/teen15' }), 'nothing_public')
    refused(CLICK_TEEN, view([withTarget('Reply')], { url: 'https://app.test/teen15' }), 'nothing_public')
  })
})

describe('I-4: only a whole private option, on an option control in an audience group, is a private choice', () => {
  it('refuses person-reaching controls whose names merely contain a private word', () => {
    refused(CLICK, one('Send private message', { contextText: '@stranger · Privacy · Send private message' }), 'own_accounts')
    refused(CLICK, one('Private reply', { contextText: '@stranger commented · Visible to everyone' }), 'own_accounts')
    refused(CLICK, one('Private message', { role: 'option', contextText: '@stranger · Audience' }), 'own_accounts')
    refused(CLICK, one('Private message', { role: 'menuitem', contextText: '@stranger · Audience' }), 'own_accounts')
  })
  it('refuses a private option outside an audience group', () => {
    refused(CLICK, one('Private', { role: 'radio', contextText: '@stranger' }), 'own_accounts')
    refused(CLICK, view([box, el('e1', 'Only me', { role: 'radio', groupId: FORM }), post]), 'own_accounts')
  })
  it('refuses a private-sounding control that is not an option, radio, select or menu item', () => {
    refused({ type: 'toggle', ref: 'e1' }, view([box, publicButton, el('e1', 'Private', { role: 'switch', groupId: FORM, contextText: 'Visibility' }), post]), 'own_accounts')
    refused(CLICK, view([box, el('e1', 'Only me', { groupId: FORM, contextText: 'Audience' }), post]), 'own_accounts')
  })
  it('refuses a submit labelled with a private audience', () => {
    refused(CLICK, view([box, el('e1', 'Share with: Only me', { groupId: FORM, inputType: 'submit' })]), 'own_accounts')
    refused(CLICK_TEEN, view([box, el('e1', 'Share with: Only me', { groupId: FORM, inputType: 'submit', contextText: '@teen15' })]), 'nothing_public')
    refused(CLICK_TEEN, view([box, el('e1', 'Visibility: Only me', { groupId: FORM, contextText: '@teen15' })]), 'nothing_public')
    refused(CLICK, view([box, publicButton, el('e1', 'Post privately - Private', { groupId: FORM, contextText: 'Audience' })]), 'nothing_public')
  })
  it.each(['Private (members can see)', 'Only me (and tagged people)', 'Private but searchable', 'Private to my circle', 'Private event', 'Only me and friends', 'Private story', 'Private - shared with 12 people'])(
    '"%s" is not a private option',
    (option) => {
      refused({ type: 'select', ref: 'a', option }, view([box, audience('Public'), post]), 'own_accounts')
      refused({ type: 'click', ref: 'p' }, view([box, audience(option), post]), 'nothing_public')
    },
  )
  // (A radio named "Private story" or "...shared..." holds a publish word, so it is judged as the audience control it is: choosing it publishes nothing, and Post is then refused.)
  it.each(['Private (members can see)', 'Only me (and tagged people)', 'Private but searchable', 'Private to my circle', 'Private event', 'Only me and friends'])(
    'clicking the radio "%s" beside a text box goes through the normal rules',
    (option) => {
      refused({ type: 'click', ref: 'r' }, view([box, el('r', option, { role: 'radio', groupId: FORM, contextText: 'Audience' }), post]), 'own_accounts')
    },
  )
  it.each(['Only me', 'only me.', '  ONLY ME  ', 'Private', 'Just me', 'Me only', 'Only myself', 'Just myself', 'Test accounts only', 'Test account only', 'Only test accounts'])('"%s" is a private option', (option) => {
    allowed({ type: 'select', ref: 'a', option }, view([box, audience('Public'), post]))
    allowed({ type: 'click', ref: 'p' }, view([box, audience(option), post]))
  })
  it.each(['radio', 'option', 'menuitem', 'menuitemradio'])('clicking a %s "Only me" in an audience group is allowed beside a text box', (role) => {
    allowed(CLICK, view([box, el('e1', 'Only me', { role, groupId: FORM, contextText: 'Who can see your posts' }), post]))
  })
  it('an input type=radio counts as a radio', () => {
    allowed(CLICK, view([box, el('e1', 'Only me', { role: 'generic', tag: 'input', inputType: 'radio', groupId: FORM, contextText: 'Audience' }), post]))
  })
  it('a select whose own name is a person, publish or final word is not a private choice', () => {
    const select = (name: string) => el('a', name, { role: 'combobox', tag: 'select', groupId: FORM, contextText: 'Who can see this' })
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([box, select('Send to'), post]), 'own_accounts')
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([box, select('Reply as'), post]), 'own_accounts')
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([box, select('Post'), post]), 'nothing_public')
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([box, select('Save'), post]), 'nothing_public')
  })
  it.each([
    ['a custom combobox', { role: 'combobox', tag: 'div' }],
    ['a listbox', { role: 'listbox', tag: 'div' }],
    ['a select element with another role', { role: 'generic', tag: 'select' }],
  ])('a select on %s counts', (_name, extra) => {
    allowed({ type: 'select', ref: 'a', option: 'Only me' }, view([box, el('a', 'Audience', { groupId: FORM, ...extra }), post]))
  })
  it('a select on a control that is not a list is not a private choice', () => {
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([box, el('a', 'Audience', { role: 'button', groupId: FORM, contextText: '@stranger' }), post]), 'own_accounts')
  })
  it('typing is never a private choice', () => {
    refused({ type: 'type', ref: 'e1', text: 'hi' }, view([el('e1', 'Only me', { role: 'option', contextText: 'Audience @stranger' })]), 'own_accounts')
  })
  it('a select needs an audience-like name or surroundings', () => {
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([box, el('a', 'Sort by', { role: 'combobox', tag: 'select', groupId: FORM }), post]), 'own_accounts')
    allowed({ type: 'select', ref: 'a', option: 'Only me' }, view([box, el('a', 'Choose', { role: 'combobox', tag: 'select', groupId: FORM, contextText: 'Who can see this' }), post]))
  })
})

describe('M-1: a handle followed by @ and no valid server is a stranger', () => {
  it.each(['@teen15@', '@teen15@-x', '@teen15@.x', '@teen15@ evil.social', '@teen15@evil.social@x'])('refuses "%s"', (handle) => {
    refused(CLICK_TEEN, one('Follow', { contextText: `${handle} Follow` }), 'own_accounts')
    expect(mentionsOf(handle)).not.toContain('teen15')
  })
  it('refuses typing it', () => {
    refused({ type: 'type', ref: 'e1', text: 'hi @teen15@' }, SEARCH, 'own_accounts')
  })
  it('still reads a valid server handle and a plain handle', () => {
    expect(mentionsOf('@teen15@evil.social and @teen15.')).toEqual(['teen15@evil.social', 'teen15'])
  })
})

describe('M-2: a mention after a combining mark still counts', () => {
  it('refuses a stranger hidden behind a combining mark', () => {
    refused(CLICK_TEEN, one('Message', { contextText: '@teen15 \u0301@stranger Message' }), 'own_accounts')
    refused(CLICK_TEEN, one('Message', { contextText: '@teen15 Jame\u0301@stranger Message' }), 'own_accounts')
    refused({ type: 'type', ref: 'e1', text: 'hi \u0301@stranger' }, SEARCH, 'own_accounts')
  })
  it('a look-alike is not excused by a plain handle hidden behind a combining mark', () => {
    refused(CLICK_TEEN, one('Message', { contextText: '@\uff54\uff45\uff45\uff4e15 \u0301@teen15 Message' }), 'own_accounts')
  })
  it('a plain handle that only the raw text shows (a mark joins the letter before it) is a stranger', () => {
    refused(CLICK_TEEN, one('Message', { contextText: 'Jame\u0301@teen15 Message' }), 'own_accounts')
  })
  it('a mention after a combining mark is read as that mention: the mark is not part of the handle', () => {
    expect(mentionsOf('x\u0301@teen15')).toEqual(['teen15'])
    allowed(CLICK_TEEN, one('Message', { contextText: 'x\u0301@teen15 Message' }))
  })
})

describe('M-4: Cancel, Close and Back are not form submits unless type=submit', () => {
  const bio = el('bio', 'Bio', { role: 'textbox', tag: 'textarea', groupId: FORM, state: { value: 'hello' } })
  const sw = el('sw', 'Private account', { role: 'switch', groupId: FORM, state: { checked: true } })
  it.each(['Cancel', 'Close', 'Back'])('allows "%s" as the last button of a form with a text box', (name) => {
    allowed(CLICK, view([bio, sw, el('s', 'Save', { groupId: FORM }), el('e1', name, { groupId: FORM })]))
    allowed(CLICK, view([box, publicButton, el('e1', name, { groupId: FORM })]))
  })
  it('refuses them when they are type=submit', () => {
    refused(CLICK, view([box, publicButton, el('e1', 'Cancel', { tag: 'input', inputType: 'submit', groupId: FORM })]), 'own_accounts')
  })
  it('a type=submit Cancel is the submit, so a safe-list button before it is not', () => {
    allowed(CLICK, view([box, publicButton, el('e1', 'Open', { groupId: FORM }), el('c', 'Cancel', { tag: 'input', inputType: 'submit', groupId: FORM })]))
  })
  it('a Cancel after it does not make another safe-list button stop being the submit', () => {
    refused(CLICK, view([box, publicButton, el('e1', 'Open', { groupId: FORM }), el('c', 'Cancel', { groupId: FORM })]), 'own_accounts')
    refused(CLICK_TEEN, view([box, publicButton, withTarget('Open'), el('c', 'Close', { groupId: FORM })]), 'nothing_public')
  })
  it('only a whole Cancel, Close or Back label leaves the form', () => {
    for (const name of ['Go back', 'Back to top', 'Close and post']) {
      expect(checkAction(CLICK, view([box, publicButton, el('o', 'Open', { groupId: FORM }), el('e1', name, { groupId: FORM })]), CTX).allowed).toBe(false)
      allowed({ type: 'click', ref: 'o' }, view([box, publicButton, el('o', 'Open', { groupId: FORM }), el('e1', name, { groupId: FORM })]))
    }
  })
  it('Save in a form with a text box still needs a private audience', () => {
    refused({ type: 'click', ref: 's' }, view([bio, sw, el('s', 'Save', { groupId: FORM }), el('c', 'Cancel', { groupId: FORM })]), 'nothing_public')
  })
})

describe('round 4: intended allows keep working', () => {
  it('the private-account switch and its Save in a form with no text box', () => {
    const settings = (checked: boolean) => view([el('sw', 'Private account', { role: 'switch', groupId: FORM, state: { checked } }), el('s', 'Save', { groupId: FORM })], { url: 'https://app.test/settings' })
    allowed({ type: 'toggle', ref: 'sw' }, settings(false))
    allowed({ type: 'click', ref: 's' }, settings(true))
  })
  it('Send to Teen 15, Block, and a recipient field holding exactly the test handle', () => {
    allowed(CLICK_TEEN, one('Send', { contextText: 'Send to @teen15' }))
    allowed(CLICK, one('Block'))
    const to = el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value: 'teen15' } })
    allowed({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([to, box, el('e1', 'Send', { groupId: FORM })], { url: 'https://app.test/messages/new' }))
  })
})

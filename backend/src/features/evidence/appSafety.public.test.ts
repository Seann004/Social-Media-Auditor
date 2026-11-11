import { describe, expect, it } from 'vitest'
import { audienceIsPrivate } from './appSafety.js'
import { allowed, CLICK, CLICK_TEEN, el, refused, view } from './appSafetyTestKit.js'

const audience = (value: string) => el('s', 'Audience', { role: 'combobox', tag: 'select', groupId: 'g1', state: { value } })
const textBox = el('t', 'What is on your mind', { tag: 'textarea', role: 'textbox', groupId: 'g1' })
const only = el('a', 'Only me', { role: 'radio', groupId: 'g1', contextText: 'Audience', state: { checked: true } })
const pub = el('b', 'Public', { role: 'radio', groupId: 'g1', contextText: 'Audience', state: { checked: true } })
const submit = (name: string, groupId: string | null = 'g1') => el('e1', name, { groupId })

const PUBLISH = [
  'Post', 'Posting', 'Posted', 'Publish', 'Publishing', 'Share', 'Sharing', 'Go live', 'Live', 'Tweet', 'Repost', 'Retweet', 'Upload',
  'Uploading', 'Broadcast', 'Start broadcast', 'Story', 'Add to your story', 'Stories', 'Reel', 'Reels', 'Boost', 'Quote', 'Publicar', 'Publier',
  'Compartir', 'Partager', 'Teilen', 'Veröffentlichen',
]
const FINAL = ['Done', 'Next', 'Create', 'Save', 'Save changes', 'Submit', 'Finish', 'Apply', 'OK']

describe('nothing public: publishing words', () => {
  it.each(PUBLISH)('refuses "%s" with no audience control', (name) => {
    refused(CLICK, view([submit(name), textBox]), 'nothing_public')
    refused(CLICK, view([submit(name), textBox, pub]), 'nothing_public')
    refused({ type: 'toggle', ref: 'e1' }, view([submit(name), textBox]), 'nothing_public')
  })
  it.each(PUBLISH)('allows "%s" when the audience is Only me', (name) => {
    allowed(CLICK, view([submit(name), textBox, audience('Only me')]))
  })
  it('refuses a publish word with no form at all', () => {
    refused(CLICK, view([submit('Post', null), audience('Only me')]), 'nothing_public')
  })
  it('still refuses a publish word with a target, because the audience is not private', () => {
    refused(CLICK_TEEN, view([el('e1', 'Share', { groupId: 'g1', contextText: '@teen15' }), textBox]), 'nothing_public')
  })
})

describe('nothing public: audience', () => {
  it.each(['Only me', 'Just me', 'Private'])('accepts a select showing "%s"', (value) => {
    allowed(CLICK, view([submit('Post'), audience(value)]))
  })
  it('accepts a checked Only me option of an audience group', () => {
    allowed(CLICK, view([submit('Post'), only]))
    allowed(CLICK, view([submit('Post'), { ...only, state: { selected: true } }]))
  })
  it.each(['Public', 'Everyone', 'Anyone', 'Anybody', 'Friends', 'Followers', 'Community', 'World', 'My network', 'Contacts', 'Connections'])(
    'refuses when the audience shows "%s"',
    (value) => {
      refused(CLICK, view([submit('Post'), audience(value)]), 'nothing_public')
      refused(CLICK, view([submit('Post'), only, { ...pub, name: value, state: { checked: true } }]), 'nothing_public')
      refused(CLICK, view([submit('Post'), only, { ...pub, name: value, role: 'button', state: {} }]), 'nothing_public')
    },
  )
  it('refuses when no audience control is shown (unsure means refuse)', () => {
    refused(CLICK, view([submit('Post')]), 'nothing_public')
  })
  it('refuses when both Only me and Public appear selected', () => {
    refused(CLICK, view([submit('Post'), only, pub]), 'nothing_public')
  })
  it('does not count an unchecked option as the audience', () => {
    allowed(CLICK, view([submit('Post'), only, { ...pub, state: { checked: false } }]))
    refused(CLICK, view([submit('Post'), { ...only, state: { checked: false } }]), 'nothing_public')
  })
  it('refuses a private switch outside the composer', () => {
    const sw = el('w', 'Private account', { role: 'switch', groupId: 'g2', state: { checked: true } })
    refused(CLICK, view([submit('Post'), sw]), 'nothing_public')
  })
  it('refuses Only me selected in another form than the button', () => {
    refused(CLICK, view([submit('Post'), { ...only, groupId: 'g2' }]), 'nothing_public')
  })
  it('refuses an unrelated checked private control in the same form', () => {
    const draft = el('d', 'Private draft', { role: 'checkbox', groupId: 'g1', state: { checked: true } })
    refused(CLICK, view([submit('Post'), draft]), 'nothing_public')
    const reply = el('d', 'Private', { role: 'button', groupId: 'g1', state: { checked: true } })
    refused(CLICK, view([submit('Post'), reply]), 'nothing_public')
    const comments = el('c', 'Who can comment', { role: 'combobox', tag: 'select', groupId: 'g1', state: { value: 'Only me' } })
    refused(CLICK, view([submit('Post'), comments]), 'nothing_public')
  })
  it('refuses an Audience: Public button that is not pressed next to an unrelated private box', () => {
    const button = el('a', 'Audience: Public', { role: 'button', groupId: 'g1' })
    const draft = el('b', 'Private draft', { role: 'checkbox', groupId: 'g1', state: { checked: true } })
    refused(CLICK, view([submit('Post'), button, draft]), 'nothing_public')
  })
  it('counts an option whose own name says audience, visibility, privacy or who can see', () => {
    for (const name of ['Audience', 'Visibility', 'Privacy', 'Who can see this', 'Share with', 'Visible to']) {
      const control = el('s', name, { role: 'combobox', tag: 'select', groupId: 'g1', state: { value: 'Only me' } })
      allowed(CLICK, view([submit('Post'), control]))
    }
  })
  it('counts a control whose role says audience', () => {
    allowed(CLICK, view([submit('Post'), el('s', 'Only me', { role: 'audience-picker', groupId: 'g1', state: { selected: true } })]))
    refused(CLICK, view([submit('Post'), el('s', 'Only me', { role: 'picker', groupId: 'g1', state: { selected: true } })]), 'nothing_public')
  })
  it('audienceIsPrivate is false for a control with no group', () => {
    expect(audienceIsPrivate(view([submit('Post', null), audience('Only me')]), submit('Post', null))).toBe(false)
  })
})

describe('nothing public: final-looking buttons', () => {
  it.each(FINAL)('refuses "%s" in a form with a text box and no private audience', (name) => {
    refused(CLICK, view([submit(name), textBox]), 'nothing_public')
    refused(CLICK, view([submit(name), textBox, pub]), 'nothing_public')
  })
  it.each(FINAL)('allows "%s" in a form with a text box and a private audience', (name) => {
    allowed(CLICK, view([submit(name), textBox, audience('Only me')]))
  })
  it.each(FINAL)('refuses "%s" in a form with a media input and no private audience', (name) => {
    const media = el('m', 'Photo', { tag: 'input', inputType: 'file', groupId: 'g1' })
    refused(CLICK, view([submit(name), media]), 'nothing_public')
  })
  it.each(FINAL)('allows "%s" in a settings form with no text box', (name) => {
    allowed(CLICK, view([submit(name), el('c', 'Dark mode', { role: 'switch', groupId: 'g1' })]))
  })
  it.each([...FINAL, ''])('refuses "%s" with no form around it', (name) => {
    refused(CLICK, view([submit(name, null)]), 'nothing_public')
  })
  it('allows Next page, which is navigation', () => {
    allowed(CLICK, view([submit('Next page', null)]))
  })
  it('refuses a form-ending button even with a proven test account as target', () => {
    for (const name of ['Submit', 'Done', 'Save', 'Next']) {
      refused(CLICK_TEEN, view([el('e1', name, { groupId: 'g1', contextText: '@teen15' }), textBox]), 'nothing_public')
      refused(CLICK, view([el('e1', name, { groupId: 'g1' }), textBox]), 'nothing_public')
    }
  })
  it('allows a Send to a proven test account without an audience', () => {
    allowed(CLICK_TEEN, view([el('e1', 'Send', { groupId: 'g1', contextText: '@teen15' }), textBox]))
    refused(CLICK, view([el('e1', 'Done', { groupId: 'g1', contextText: '@teen15' }), textBox]), 'own_accounts')
  })
})

describe('nothing public: fine points', () => {
  it('lets the AI choose the audience: the audience control itself is never refused', () => {
    allowed({ type: 'select', ref: 'e1', option: 'Only me' }, view([el('e1', 'Post audience', { role: 'combobox', tag: 'select', groupId: 'g1', state: { value: 'Public' } })]))
    allowed({ type: 'toggle', ref: 'e1' }, view([el('e1', 'Audience everyone', { role: 'switch', groupId: 'g1', state: { checked: true } })]))
  })
  it('refuses a select or toggle that publishes', () => {
    refused({ type: 'select', ref: 'e1', option: 'On' }, view([el('e1', 'Boost', { role: 'combobox', tag: 'select', groupId: 'g1' })]), 'nothing_public')
    refused({ type: 'toggle', ref: 'e1' }, view([el('e1', 'Go live', { role: 'switch', groupId: 'g1' })]), 'nothing_public')
  })
  it('accepts an option and a shared-with control', () => {
    const option = el('o', 'Only me', { role: 'option', groupId: 'g1', contextText: 'Audience', state: { selected: true } })
    allowed(CLICK, view([submit('Post'), option]))
    const shared = el('s', 'Shared with', { role: 'combobox', tag: 'select', groupId: 'g1', state: { value: 'Only me' } })
    allowed(CLICK, view([submit('Post'), shared]))
  })
  it('does not accept a checkbox that merely sits under an audience heading', () => {
    const box = el('o', 'Only me', { role: 'checkbox', groupId: 'g1', contextText: 'Audience', state: { checked: true } })
    refused(CLICK, view([submit('Post'), box]), 'nothing_public')
  })
  it('does not read a value from a control that is not a select', () => {
    const field = el('s', 'Audience', { role: 'textbox', tag: 'input', groupId: 'g1', state: { value: 'Only me' } })
    refused(CLICK, view([submit('Post'), field]), 'nothing_public')
  })
  it('a control with no form never has a private audience, even beside another with no form', () => {
    const loose = el('s', 'Audience', { role: 'combobox', tag: 'select', groupId: null, state: { value: 'Only me' } })
    refused(CLICK, view([submit('Post', null), loose]), 'nothing_public')
    expect(audienceIsPrivate(view([submit('Post', null), loose]), submit('Post', null))).toBe(false)
  })
  it('lets a sign-in page Next button through', () => {
    const fields = [el('e1', 'Next', { groupId: 'g1' }), el('u', 'Username', { tag: 'input', inputType: 'text', groupId: 'g1' })]
    allowed(CLICK, view(fields, { url: 'https://app.test/login' }))
    refused(CLICK, view(fields), 'nothing_public')
  })
})

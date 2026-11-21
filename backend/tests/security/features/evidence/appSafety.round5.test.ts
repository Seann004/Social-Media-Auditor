import { describe, it } from 'vitest'
import { allowed, CLICK_TEEN, el, refused, view } from '../../../../src/features/evidence/appSafetyTestKit.js'
import type { AppElement } from '../../../../src/features/evidence/appTypes.js'

const FORM = 'g1'
const NEW_MESSAGE = { url: 'https://app.test/messages/new' }
const body = (value?: string) => el('t', 'Write a message', { role: 'textbox', tag: 'textarea', groupId: FORM, state: value === undefined ? {} : { value } })
const to = (value: string) => el('to', 'To', { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: { value } })
const field = (name: string, value?: string, extra: Partial<AppElement> = {}) =>
  el('m', name, { role: 'textbox', tag: 'input', inputType: 'text', groupId: FORM, state: value === undefined ? {} : { value }, ...extra })
const send = (name = 'Send') => el('e1', name, { groupId: FORM })
const SEND_TEEN = { type: 'click' as const, ref: 'e1', target: 'Teen 15' }

describe('A23: in a person-reaching form, every other field must be empty or hold exactly the test handle', () => {
  const PEOPLE = ['Add more', 'Members', 'Add participants', 'Group members', 'Add people', 'Invite', 'Cc', 'Recipients', 'Group name', 'Participants', 'People', 'Invitations']
  it.each(PEOPLE)('refuses Send when "%s" holds a stranger beside To=teen15', (name) => {
    refused(SEND_TEEN, view([to('teen15'), field(name, 'stranger'), body('hi'), send()], NEW_MESSAGE), 'own_accounts')
  })
  it.each(PEOPLE)('refuses typing a stranger into "%s" beside To=teen15', (name) => {
    refused({ type: 'type', ref: 'm', text: 'stranger' }, view([to('teen15'), field(name), body(), send()], NEW_MESSAGE), 'own_accounts')
  })
  it.each(['stranger', '@stranger', 'teen15, stranger', 'adult_a', '', '   ', 'Teen Fifteen', 'teen15@evil.social'])('refuses typing %j into a people field', (text) => {
    refused({ type: 'type', ref: 'm', text }, view([to('teen15'), field('Add people'), body(), send()], NEW_MESSAGE), 'own_accounts')
  })
  it.each(['teen15', '@teen15', ' TEEN15 '])('allows typing exactly the test handle %j into a people field', (text) => {
    allowed({ type: 'type', ref: 'm', text }, view([to('teen15'), field('Add people'), body(), send()], NEW_MESSAGE))
  })
  it('allows Send when a people field holds exactly the same test handle, or is empty', () => {
    allowed(SEND_TEEN, view([to('teen15'), field('Members', '@teen15'), body('hi'), send()], NEW_MESSAGE))
    allowed(SEND_TEEN, view([to('teen15'), field('Members'), body('hi'), send()], NEW_MESSAGE))
  })
  it('refuses any other field with a value, whatever its name', () => {
    refused(SEND_TEEN, view([to('teen15'), field('Subject', 'hello'), body('hi'), send()], NEW_MESSAGE), 'own_accounts')
    refused(SEND_TEEN, view([to('teen15'), field('Who?', 'stranger'), body('hi'), send()], NEW_MESSAGE), 'own_accounts')
    refused(SEND_TEEN, view([to('teen15'), field('Find people', 'stranger', { inputType: 'search', role: 'searchbox' }), body('hi'), send()], NEW_MESSAGE), 'own_accounts')
    for (const inputType of ['email', 'tel', 'url']) {
      refused(SEND_TEEN, view([to('teen15'), field('Website', 'x', { inputType, role: 'generic' }), body('hi'), send()], NEW_MESSAGE), 'own_accounts')
    }
    // An input is never the message body, even when the body box is empty.
    refused(SEND_TEEN, view([to('teen15'), field('Who?', 'stranger'), body(), send()], NEW_MESSAGE), 'own_accounts')
  })
  it('only a button with a person word makes a person form', () => {
    const message = el('t', 'Message', { role: 'textbox', tag: 'textarea', groupId: FORM, state: { value: 'hi' } })
    const follow = el('e1', 'Follow', { role: 'link', tag: 'a', href: '/u/teen15', groupId: FORM, contextText: '@teen15' })
    allowed(SEND_TEEN, view([message, field('Subject', 'hello'), follow]))
  })
  it('allows one message body, and refuses a second body box with a value', () => {
    allowed(SEND_TEEN, view([to('teen15'), body('hi'), send()], NEW_MESSAGE))
    const second = el('t2', 'Notes', { role: 'textbox', tag: 'div', groupId: FORM, state: { value: 'stranger' } })
    refused(SEND_TEEN, view([to('teen15'), body('hi'), second, send()], NEW_MESSAGE), 'own_accounts')
  })
  it('applies to Message and Reply forms too', () => {
    refused(SEND_TEEN, view([to('teen15'), field('Add more', 'stranger'), body('hi'), send('Message')], NEW_MESSAGE), 'own_accounts')
    refused(SEND_TEEN, view([to('teen15'), field('Add more', 'stranger'), body('hi'), send('Reply')], NEW_MESSAGE), 'own_accounts')
  })
  it('a form with no person word keeps its other fields free', () => {
    const post = el('p', 'Post', { groupId: FORM })
    const audience = el('a', 'Audience', { role: 'combobox', tag: 'select', groupId: FORM, state: { value: 'Only me' } })
    const postBox = el('t', "What's on your mind?", { role: 'textbox', tag: 'textarea', groupId: FORM, state: { value: 'hi' } })
    allowed({ type: 'type', ref: 'm', text: 'a caption' }, view([field('Add a caption', 'old'), postBox, audience, post]))
    allowed({ type: 'click', ref: 'p' }, view([field('Add a caption', 'old'), postBox, audience, post]))
  })
})

describe('N-2: the private-option exemption never applies to a recipient or people field', () => {
  it.each(['To', 'Add people and groups', 'Members', 'Recipients'])('selecting "Private" or "Only me" on "%s" goes through the normal rules', (name) => {
    const picker = el('a', name, { role: 'combobox', tag: 'div', groupId: FORM, contextText: 'Share with · Privacy' })
    refused({ type: 'select', ref: 'a', option: 'Private' }, view([picker, body(), send()], NEW_MESSAGE), 'own_accounts')
    refused({ type: 'select', ref: 'a', option: 'Only me' }, view([picker, body(), send()], NEW_MESSAGE), 'own_accounts')
  })
})

describe('N-1: a <button> the reader reports as submit is the form submit, whatever its label', () => {
  it('refuses Cancel or Close that the browser would submit in a Public composer', () => {
    const box = el('t', 'Write something', { role: 'textbox', tag: 'textarea', groupId: FORM })
    const publicButton = el('b', 'Audience: Public', { inputType: 'button', groupId: FORM })
    for (const name of ['Cancel', 'Close', 'Back']) {
      refused({ type: 'click', ref: 'e1' }, view([box, publicButton, el('e1', name, { inputType: 'submit', groupId: FORM })]), 'own_accounts')
      allowed({ type: 'click', ref: 'e1' }, view([box, publicButton, el('e1', name, { inputType: 'button', groupId: FORM })]))
    }
  })
})

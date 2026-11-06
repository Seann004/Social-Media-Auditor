import { describe, expect, it } from 'vitest'
import { audienceIsPrivate, checkAction, detectBlock, type SafetyContext } from './appSafety.js'
import type { AgentAccount, AppAction, AppElement, AppView } from './appTypes.js'

const APP = 'https://app.test/'

function account(label: string, handles: string[]): AgentAccount {
  return { id: label, label, ageGroup: 'under_18', age: 15, handles }
}
const TEEN = account('Teen 15', ['@teen15', 'Teen Fifteen'])
const ADULT = account('Adult', ['adult_a'])
const NOHANDLE = account('Ghost', [])
const CTX: SafetyContext = { accounts: [TEEN, ADULT, NOHANDLE], currentAccount: ADULT, appUrl: APP, loginDomains: ['sso.idp.test'] }

function el(ref: string, name: string, extra: Partial<AppElement> = {}): AppElement {
  return { ref, role: 'button', name, tag: 'button', inputType: null, href: null, groupId: null, state: {}, contextText: '', ...extra }
}
function view(elements: AppElement[], extra: Partial<AppView> = {}): AppView {
  return { url: 'https://app.test/home', title: 'Home', text: 'hello', elements, frameUrls: [], hasPasswordField: false, ...extra }
}
function refused(action: AppAction, v: AppView | null, rule: string, ctx: SafetyContext = CTX) {
  const verdict = checkAction(action, v, ctx)
  expect(verdict).toMatchObject({ allowed: false, rule })
  if (!verdict.allowed) expect(verdict.reason.length).toBeGreaterThan(0)
}
function allowed(action: AppAction, v: AppView | null, ctx: SafetyContext = CTX) {
  expect(checkAction(action, v, ctx)).toEqual({ allowed: true })
}

describe('no account', () => {
  it('refuses everything but switch_account before an account is chosen', () => {
    const none = { ...CTX, currentAccount: null }
    const v = view([el('e1', 'Settings')])
    refused({ type: 'click', ref: 'e1' }, v, 'no_account', none)
    refused({ type: 'back' }, v, 'no_account', none)
    refused({ type: 'finish', observations: 'x', evidenceSteps: [] }, v, 'no_account', none)
    allowed({ type: 'switch_account', account: 'Teen 15' }, v, none)
  })
})

describe('unknown element', () => {
  it('refuses a ref that is not in the view', () => {
    refused({ type: 'click', ref: 'e9' }, view([el('e1', 'Settings')]), 'unknown_element')
    refused({ type: 'click', ref: 'e1' }, null, 'unknown_element')
  })
})

describe('own accounts', () => {
  const msg = el('e1', 'Message', { contextText: 'Teen Fifteen @teen15' })
  it('refuses Message with no target', () => {
    refused({ type: 'click', ref: 'e1' }, view([msg], { url: 'https://app.test/u/teen15' }), 'own_accounts')
  })
  it('refuses Message targeting a label that is not a test account', () => {
    refused({ type: 'click', ref: 'e1', target: 'Stranger' }, view([msg]), 'own_accounts')
  })
  it('refuses Follow in an article by @stranger even when targeting Teen 15', () => {
    const follow = el('e1', 'Follow', { contextText: 'Article by @stranger: a long story' })
    refused({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([follow]), 'own_accounts')
  })
  it('allows Message on /u/teen15 targeting Teen 15', () => {
    const m = el('e1', 'Message')
    allowed({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([m], { url: 'https://app.test/u/teen15' }))
  })
  it('allows Message when the handle is in the element context', () => {
    allowed({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([msg]))
  })
  it('allows Send on /messages/new?to=teen15 targeting Teen 15', () => {
    const send = el('e1', 'Send')
    allowed({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([send], { url: 'https://app.test/messages/new?to=teen15' }))
  })
  it('allows a handle found in the title', () => {
    const send = el('e1', 'Send')
    allowed({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([send], { title: 'Chat with Teen Fifteen' }))
  })
  it('refuses Message on /u/teen15 when its context shows @stranger', () => {
    const m = el('e1', 'Message', { contextText: 'Suggested: @stranger' })
    refused({ type: 'click', ref: 'e1', target: 'Teen 15' }, view([m], { url: 'https://app.test/u/teen15' }), 'own_accounts')
  })
  it('refuses typing "hi @stranger" and allows "hi @teen15"', () => {
    const box = el('e1', 'Message box', { tag: 'textarea', role: 'textbox' })
    refused({ type: 'type', ref: 'e1', text: 'hi @stranger' }, view([box]), 'own_accounts')
    allowed({ type: 'type', ref: 'e1', text: 'hi @teen15' }, view([box]))
    allowed({ type: 'type', ref: 'e1', text: 'mail me at a@b.com' }, view([box]))
  })
  it('refuses switch_account and fill_credential for an unknown label', () => {
    const f = el('e1', 'Password', { tag: 'input', inputType: 'password' })
    refused({ type: 'switch_account', account: 'Nobody' }, view([f]), 'own_accounts')
    refused({ type: 'fill_credential', ref: 'e1', account: 'Nobody', field: 'password' }, view([f]), 'own_accounts')
  })
  it('refuses targeting the current account itself', () => {
    const m = el('e1', 'Message', { contextText: '@adult_a' })
    refused({ type: 'click', ref: 'e1', target: 'Adult' }, view([m]), 'own_accounts')
  })
  it('refuses Message on /u/teen15 targeting an account saved with no handles', () => {
    const m = el('e1', 'Message')
    const verdict = checkAction({ type: 'click', ref: 'e1', target: 'Ghost' }, view([m], { url: 'https://app.test/u/ghost' }), CTX)
    expect(verdict).toEqual({ allowed: false, rule: 'own_accounts', reason: 'Ghost has no display handle, so nothing can be sent to it.' })
  })
})

describe('credentials', () => {
  it('refuses a password fill into a text field, a search box or a message box', () => {
    const els = [
      el('e1', 'Name', { tag: 'input', inputType: 'text' }),
      el('e2', 'Search', { tag: 'input', inputType: 'search' }),
      el('e3', 'Message box', { tag: 'textarea', inputType: null }),
    ]
    for (const ref of ['e1', 'e2', 'e3']) {
      refused({ type: 'fill_credential', ref, account: 'Teen 15', field: 'password' }, view(els), 'credentials')
    }
  })
  it('refuses a login fill into a password field or a search box', () => {
    const els = [el('e1', 'Password', { tag: 'input', inputType: 'password' }), el('e2', 'Search', { tag: 'input', inputType: 'search' })]
    refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, view(els), 'credentials')
    refused({ type: 'fill_credential', ref: 'e2', account: 'Teen 15', field: 'login' }, view(els), 'credentials')
  })
  it('allows a login fill into a text, email or typeless input', () => {
    for (const inputType of ['text', 'email', 'tel', null]) {
      allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, view([el('e1', 'Email', { tag: 'input', inputType })]))
    }
  })
  it('refuses type into a password field', () => {
    const f = el('e1', 'Password', { tag: 'input', inputType: 'password' })
    const verdict = checkAction({ type: 'type', ref: 'e1', text: 'hunter2' }, view([f]), CTX)
    expect(verdict).toMatchObject({ allowed: false, rule: 'credentials' })
    if (!verdict.allowed) expect(verdict.reason).toContain('use fill_credential')
  })
})

describe('destructive', () => {
  it.each(['Delete account', 'Deactivate', 'Change password', 'Change email', 'Add payment card', 'Buy coins', 'Log out', 'Sign out of other sessions'])('refuses %s', (name) => {
    refused({ type: 'click', ref: 'e1' }, view([el('e1', name)]), 'destructive')
    refused({ type: 'toggle', ref: 'e1' }, view([el('e1', name)]), 'destructive')
  })
  it('refuses open_link to /settings/delete-account and /settings/delete_account', () => {
    refused({ type: 'open_link', url: 'https://app.test/settings/delete-account' }, view([]), 'destructive')
    refused({ type: 'open_link', ref: 'e1' }, view([el('e1', 'Account', { role: 'link', href: 'https://app.test/settings/delete_account' })]), 'destructive')
  })
  it.each(['New email', 'New phone'])('refuses typing into a field named "%s"', (name) => {
    refused({ type: 'type', ref: 'e1', text: 'x' }, view([el('e1', name, { tag: 'input', inputType: 'text' })]), 'destructive')
  })
  it('allows fill_credential into the Password field of a login form', () => {
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'password' }, view([el('e1', 'Password', { tag: 'input', inputType: 'password' })]))
  })
  it('allows an ordinary click', () => {
    allowed({ type: 'click', ref: 'e1' }, view([el('e1', 'Settings')]))
  })
})

describe('nothing public', () => {
  const post = (g: string | null = 'g1') => el('p', 'Post', { groupId: g })
  const only = el('a', 'Only me', { role: 'radio', groupId: 'g1', state: { checked: true } })
  const pub = el('b', 'Public', { role: 'radio', groupId: 'g1', state: { checked: true } })
  it.each(['Post', 'Publish', 'Share', 'Go live', 'Upload'])('refuses %s with audience Public', (name) => {
    const v = view([el('p', name, { groupId: 'g1' }), pub])
    refused({ type: 'click', ref: 'p' }, v, 'nothing_public')
  })
  it('allows Post when the audience select shows Only me', () => {
    const sel = el('s', 'Audience', { role: 'combobox', tag: 'select', groupId: 'g1', state: { value: 'Only me' } })
    allowed({ type: 'click', ref: 'p' }, view([post(), sel]))
    allowed({ type: 'click', ref: 'p' }, view([post(), only]))
  })
  it('refuses Post when no audience control is shown (unsure means refuse)', () => {
    refused({ type: 'click', ref: 'p' }, view([post()]), 'nothing_public')
    refused({ type: 'click', ref: 'p' }, view([post(null)]), 'nothing_public')
  })
  it('refuses Post when both Only me and Public appear selected', () => {
    refused({ type: 'click', ref: 'p' }, view([post(), only, pub]), 'nothing_public')
  })
  it('refuses Post when the only private-looking control is a checked "Private account" switch outside the composer', () => {
    const sw = el('w', 'Private account', { role: 'switch', groupId: 'g2', state: { checked: true } })
    refused({ type: 'click', ref: 'p' }, view([post(), sw]), 'nothing_public')
  })
  it('refuses Post when Only me is selected in another form than the Post button', () => {
    const other = el('a', 'Only me', { role: 'radio', groupId: 'g2', state: { checked: true } })
    refused({ type: 'click', ref: 'p' }, view([post(), other]), 'nothing_public')
  })
  it('audienceIsPrivate ignores unchecked private options', () => {
    const off = el('a', 'Only me', { role: 'radio', groupId: 'g1', state: { checked: false } })
    expect(audienceIsPrivate(view([post(), off]), post())).toBe(false)
  })
})

describe('stay on platform', () => {
  it('refuses open_link to example.org, and to javascript: and mailto: hrefs', () => {
    refused({ type: 'open_link', url: 'https://example.org/' }, view([]), 'stay_on_platform')
    refused({ type: 'open_link', ref: 'e1' }, view([el('e1', 'Out', { href: 'https://example.org/x' })]), 'stay_on_platform')
    refused({ type: 'open_link', ref: 'e1' }, view([el('e1', 'Out', { href: 'javascript:void(0)' })]), 'stay_on_platform')
    refused({ type: 'open_link', ref: 'e1' }, view([el('e1', 'Out', { href: 'mailto:a@b.com' })]), 'stay_on_platform')
  })
  it('allows open_link to /settings and to a listed login domain', () => {
    allowed({ type: 'open_link', url: 'https://app.test/settings' }, view([]))
    allowed({ type: 'open_link', url: 'https://sso.idp.test/login' }, view([]))
    allowed({ type: 'open_link', ref: 'e1' }, view([el('e1', 'Settings', { href: '/settings' })]))
  })
})

describe('detectBlock', () => {
  const longText = Array.from({ length: 300 }, () => 'word').join(' ')
  it.each([
    ['captcha frame', view([], { frameUrls: ['https://www.google.com/recaptcha/api2/anchor'], text: longText })],
    ['Just a moment title', view([], { title: 'Just a moment...' })],
    ['short 2-factor page', view([], { text: 'Enter the code from your authenticator app' })],
    ['suspicious activity page', view([], { text: 'We noticed unusual activity on your account' })],
    ['code input', view([el('c', 'Verification code', { tag: 'input', inputType: 'text' })], { text: `${longText} two-factor` })],
  ])('stops on %s', (_name, v) => {
    const reason = detectBlock(v)
    expect(reason).not.toBeNull()
    expect(reason!.length).toBeGreaterThan(0)
  })
  it('does not stop on a long settings page that mentions two-factor authentication', () => {
    expect(detectBlock(view([], { title: 'Settings', text: `${longText} Two-factor authentication is off` }))).toBeNull()
  })
  it('does not stop on an ordinary page', () => {
    expect(detectBlock(view([]))).toBeNull()
  })
})

describe('refusals', () => {
  it('every refusal carries a non-empty plain reason and its rule', () => {
    const verdicts = [
      checkAction({ type: 'click', ref: 'zz' }, view([]), CTX),
      checkAction({ type: 'switch_account', account: 'Nobody' }, view([]), CTX),
      checkAction({ type: 'click', ref: 'e1' }, view([el('e1', 'Delete account')]), CTX),
      checkAction({ type: 'open_link', url: 'https://example.org' }, view([]), CTX),
    ]
    for (const verdict of verdicts) {
      expect(verdict.allowed).toBe(false)
      if (!verdict.allowed) {
        expect(verdict.rule.length).toBeGreaterThan(0)
        expect(verdict.reason).toMatch(/\S/)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { checkAction } from './appSafety.js'
import { allowed, CLICK, CLICK_TEEN, el, one, refused, view } from './appSafetyTestKit.js'

const DESTRUCTIVE = [
  'Delete account', 'Delete', 'Deleting', 'Deactivate', 'Deactivating', 'Erase history', 'Remove photo', 'Remove account', 'Disable notifications',
  'Suspend', 'Revoke access', 'Close account', 'Close my account', 'Cancel subscription', 'Cancel my membership', 'Cancel account', 'Cancel order',
  'Pause account', 'Pause my profile', 'Take a break', 'Change password', 'Reset password', 'Forgot password', 'Forget password', 'Update password',
  'Edit email', 'Update email', 'Change email', 'New email', 'Edit phone', 'Change username', 'New phone', 'Set password', 'Email address', 'Phone',
  'Pay', 'Pay now', 'Payment', 'Payments', 'Billing', 'Card', 'Cards', 'Credit card', 'Add payment card', 'Purchase', 'Purchases', 'Buy', 'Buy coins',
  'Checkout', 'Subscribe', 'Subscription', 'Upgrade', 'Donate', 'Gift', 'Gifts', 'Coins', 'Get coins', 'Tip', 'Tips', 'Tipping', 'Leave a tip', 'Top up',
  'Topup', 'Recharge', 'Order', 'Place order', 'Ordering', 'Unlock', 'Membership', 'Report', 'Reporting', 'Confirm', 'Unsend', 'Unfollow', 'Leave group',
  'Leaving', 'Clear history', 'Permanently remove', 'Permanent', 'Log out', 'Logout', 'Log off', 'Sign out', 'Signout', 'Sign Out', 'End session',
  'Other sessions', 'Sign out of other sessions', 'Log out of all devices', 'Remove device', 'Supprimer le compte', 'Eliminar', 'Borrar', 'Löschen',
  'Entfernen', 'Pagar', 'Comprar', 'Payer', 'Acheter', 'Kaufen', 'Bezahlen', 'Cerrar sesión', 'Déconnexion', 'Abmelden', 'deleteAccount', 'DeactivateNow', 'closeMyAccount', 'step2CloseAccount',
  'Premium for $4.99/month', 'Go premium $4.99', 'Pro 9 USD', 'Plan per month', 'Plan per year', 'Only €5', '£3', '$5/mo', '5/year',
]

describe('destructive: labels', () => {
  it.each(DESTRUCTIVE)('refuses "%s"', (name) => {
    refused(CLICK, one(name), 'destructive')
    refused({ type: 'toggle', ref: 'e1' }, one(name, { role: 'switch' }), 'destructive')
    refused({ type: 'select', ref: 'e1', option: 'x' }, one(name, { role: 'combobox', tag: 'select' }), 'destructive')
  })
  it.each(['Settings', 'Privacy', 'Notifications', 'Search', 'Profile photo', 'Dark mode', 'Language', 'Help'])('allows "%s"', (name) => {
    allowed(CLICK, one(name))
  })
  it('refuses typing into a field named for a destructive thing', () => {
    refused({ type: 'type', ref: 'e1', text: 'x' }, one('Delete reason', { tag: 'input', inputType: 'text' }), 'destructive')
  })
  it.each(['New email', 'New phone', 'Email', 'E-mail', 'Username', 'User name', 'Phone', 'Mobile', 'Mobile number', 'Date of birth', 'Birthday', 'DOB'])('refuses typing into "%s"', (name) => {
    refused({ type: 'type', ref: 'e1', text: 'x' }, one(name, { tag: 'input', inputType: 'text' }), 'destructive')
  })
  it('refuses a click whose link goes to a destructive address', () => {
    refused(CLICK, one('Help', { role: 'link', href: 'https://app.test/settings/delete-account' }), 'destructive')
  })
  it('allows clicking links named Email or Username, which are only sections of the settings', () => {
    for (const name of ['Email', 'Username']) allowed(CLICK, one(name))
  })
  it('does not stumble on a label with a stray percent sign', () => {
    allowed(CLICK, one('Zoom 100%'))
  })
  it('reads an encoded price', () => {
    refused(CLICK, one('%245'), 'destructive')
  })
  it('refuses a click on a priced link', () => {
    refused(CLICK, one('Learn more', { role: 'link', href: 'https://app.test/plans?price=$5' }), 'destructive')
  })
})

describe('destructive: addresses', () => {
  const OPEN = (url: string) => ({ type: 'open_link' as const, url })
  it.each([
    '/settings/delete-account', '/settings/delete_account', '/settings/deleteAccount', '/settings/account?action=delete', '/accounts/remove/request/permanent',
    '/logout', '/log-out', '/signout', '/billing', '/checkout', '/settings/payment', '/membership', '/u/someone/report', '/settings/email/change',
    '/plans?price=$5', '/plans/$5',
  ])('refuses open_link to %s', (path) => {
    refused(OPEN(`https://app.test${path}`), view([]), 'destructive')
  })
  it.each(['/api/follow?user=stranger', '/api/anything', '/intent/post?text=hi', '/follow/stranger', '/send', '/share', '/compose', '/page?action=go', '/page?text=hi', '/page?message=x', '/page?follow=1'])(
    'refuses open_link to the acting address %s',
    (path) => {
      refused(OPEN(`https://app.test${path}`), view([]), 'destructive')
    },
  )
  it.each(['/settings', '/messages/new?to=teen15', '/u/teen15', '/post/123', '/privacy', '/'])('allows open_link to %s', (path) => {
    allowed(OPEN(`https://app.test${path}`), view([]))
  })
  it('refuses an open_link through an element with a destructive address, a relative one included', () => {
    refused({ type: 'open_link', ref: 'e1' }, one('Account', { role: 'link', href: '/settings/delete_account' }), 'destructive')
  })
  it.each(['/settings/logOut', '/settings/closeAccount', '/settings/step2CloseAccount', '/settings/signOut', '/settings/log%20out', '/settings/account?do=delete', '/settings/delete%E0%A4%A'])(
    'refuses open_link to %s, read as words',
    (path) => {
      refused(OPEN(`https://app.test${path}`), view([]), 'destructive')
    },
  )
  it('refuses a click on a link that acts when opened', () => {
    refused(CLICK, one('Check', { role: 'link', href: 'https://app.test/api/follow?user=stranger' }), 'destructive')
    refused(CLICK, one('Check', { role: 'link', href: '/page?action=go' }), 'destructive')
  })
  it('refuses an open_link with neither address nor element', () => {
    refused({ type: 'open_link' }, view([]), 'unknown_element')
  })
})

describe('credentials', () => {
  const login = { hasPasswordField: true, url: 'https://app.test/login' }
  const field = (name: string, inputType: string | null, tag = 'input', extra = {}) => one(name, { tag, inputType, ...extra }, login)
  it('allows a password into the password field of a login form, and a login into text, email, tel or no type', () => {
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'password' }, field('Password', 'password'))
    for (const type of ['text', 'email', 'tel', null]) allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, field('Email', type))
  })
  it('refuses a password fill into a text field, a search box or a message box', () => {
    for (const [type, tag] of [['text', 'input'], ['search', 'input'], [null, 'textarea'], ['email', 'input']] as const) {
      refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'password' }, field('Box', type, tag), 'credentials')
    }
  })
  it('refuses a login fill into a password field, a search box, a number box or a textarea', () => {
    for (const [type, tag] of [['password', 'input'], ['search', 'input'], ['number', 'input'], [null, 'textarea']] as const) {
      refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, field('Box', type, tag), 'credentials')
    }
  })
  it.each(['New password', 'Confirm password', 'Current password', 'Old password', 'Repeat password', 'Re-enter password', 'Change password', 'Update password', 'Reset password'])(
    'refuses a fill into "%s"',
    (name) => {
      refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'password' }, field(name, 'password'), 'credentials')
    },
  )
  it('refuses a fill into a form with two password fields', () => {
    const v = view([el('e1', 'Password', { tag: 'input', inputType: 'password', groupId: 'g1' }), el('p', 'Again', { tag: 'input', inputType: 'password', groupId: 'g1' })], login)
    refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'password' }, v, 'credentials')
  })
  it('refuses a password fill into something that is not an input', () => {
    refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'password' }, one('Password', { tag: 'div', inputType: 'password' }, login), 'credentials')
  })
  it('counts a page with a password field as a login page, whatever its address and title', () => {
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }, { hasPasswordField: true, url: 'https://app.test/start' }))
  })
  it('refuses a fill on a page that is not a login page', () => {
    refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }), 'credentials')
    refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Change email', { tag: 'input', inputType: 'email' }, { url: 'https://app.test/settings' }), 'credentials')
  })
  it('allows a fill on the first step of a sign-in, by address or by title', () => {
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }, { url: 'https://app.test/sign-in' }))
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }, { title: 'Sign in to App' }))
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }, { title: 'Log in' }))
  })
  it('refuses type into a password field, with the reason "use fill_credential"', () => {
    const verdict = checkAction({ type: 'type', ref: 'e1', text: 'hunter2' }, field('Password', 'password'), {
      ...{ accounts: [], currentAccount: { id: 'a', label: 'A', ageGroup: 'adult', age: 30, handles: ['a'] }, appUrl: 'https://app.test/', loginDomains: [] },
    })
    expect(verdict).toMatchObject({ allowed: false, rule: 'credentials' })
    if (!verdict.allowed) expect(verdict.reason).toContain('use fill_credential')
  })
})

describe('stay on platform', () => {
  it('refuses open_link to example.org, and to javascript:, mailto: and data: addresses', () => {
    refused({ type: 'open_link', url: 'https://example.org/' }, view([]), 'stay_on_platform')
    for (const href of ['https://example.org/x', 'javascript:void(0)', 'mailto:a@b.com', 'data:text/html,hi', 'ftp://app.test/x']) {
      refused({ type: 'open_link', ref: 'e1' }, one('Out', { href }), 'stay_on_platform')
    }
  })
  it('allows http addresses of the app', () => {
    allowed({ type: 'open_link', url: 'http://app.test/settings' }, view([]))
  })
  it('resolves a relative address against the page it is on', () => {
    refused({ type: 'open_link', ref: 'e1' }, one('Back', { href: '/settings' }, { url: 'https://example.org/page' }), 'stay_on_platform')
  })
  it('allows open_link to /settings and to a listed login domain', () => {
    allowed({ type: 'open_link', url: 'https://app.test/settings' }, view([]))
    allowed({ type: 'open_link', url: 'https://sso.idp.test/login' }, view([]))
    allowed({ type: 'open_link', ref: 'e1' }, one('Settings', { href: '/settings' }))
  })
  it('checks both the address and the element', () => {
    refused({ type: 'open_link', ref: 'e1', url: 'https://app.test/settings' }, one('Out', { href: 'https://example.org/' }), 'stay_on_platform')
    refused({ type: 'open_link', ref: 'e1', url: 'https://example.org/' }, one('Settings', { href: '/settings' }), 'stay_on_platform')
  })
})

describe('rule order: the first refusal wins', () => {
  const OFFSITE = { href: 'https://example.org/' }
  it('no_account before unknown_element', () => {
    refused(CLICK, view([]), 'no_account', { ...{ accounts: [], appUrl: 'https://app.test/', loginDomains: [] }, currentAccount: null })
  })
  it('unknown_element before own_accounts', () => {
    refused({ type: 'click', ref: 'zz', target: 'Stranger' }, view([]), 'unknown_element')
  })
  it('own_accounts before credentials', () => {
    refused({ type: 'type', ref: 'e1', text: 'hi @stranger' }, one('Password', { tag: 'input', inputType: 'password' }), 'own_accounts')
    refused({ type: 'fill_credential', ref: 'e1', account: 'Nobody', field: 'password' }, one('Box', { tag: 'input', inputType: 'text' }), 'own_accounts')
  })
  it('credentials before destructive', () => {
    refused({ type: 'type', ref: 'e1', text: 'x' }, one('Change password', { tag: 'input', inputType: 'password' }), 'credentials')
  })
  it('own_accounts before destructive', () => {
    refused(CLICK_TEEN, one('Send gift', { contextText: '@stranger' }), 'own_accounts')
    refused(CLICK, one('Send gift'), 'own_accounts')
  })
  it('own_accounts before nothing_public', () => {
    refused(CLICK, one('Share', { contextText: '@stranger' }), 'own_accounts')
  })
  it('destructive before nothing_public', () => {
    refused(CLICK, view([el('e1', 'Delete post', { groupId: 'g1' })]), 'destructive')
    refused(CLICK, view([el('e1', 'Pay and publish', { groupId: 'g1' })]), 'destructive')
  })
  it('destructive before stay_on_platform', () => {
    refused({ type: 'open_link', url: 'https://example.org/delete' }, view([]), 'destructive')
    refused({ type: 'open_link', ref: 'e1' }, one('Delete', OFFSITE), 'destructive')
  })
  it('stay_on_platform applies to open_link even for publish-looking links', () => {
    refused({ type: 'open_link', ref: 'e1' }, one('Post', OFFSITE), 'stay_on_platform')
  })
  it('every refusal carries a non-empty plain reason and its rule', () => {
    const verdicts = [
      checkAction({ type: 'click', ref: 'zz' }, view([]), { accounts: [], currentAccount: null, appUrl: 'https://app.test/', loginDomains: [] }),
      checkAction({ type: 'click', ref: 'e1' }, one('Delete account'), { accounts: [], currentAccount: { id: 'a', label: 'A', ageGroup: 'adult', age: 30, handles: ['a'] }, appUrl: 'https://app.test/', loginDomains: [] }),
    ]
    for (const verdict of verdicts) {
      expect(verdict.allowed).toBe(false)
      if (!verdict.allowed) expect(verdict.reason).toMatch(/\S/)
    }
  })
  it('allows back and finish once an account is chosen', () => {
    allowed({ type: 'back' }, view([]))
    allowed({ type: 'finish', observations: 'x', evidenceSteps: [] }, view([]))
  })
  it('refuses everything but switch_account before an account is chosen', () => {
    const none = { accounts: [], currentAccount: null, appUrl: 'https://app.test/', loginDomains: [] }
    refused({ type: 'back' }, view([]), 'no_account', none)
    refused({ type: 'finish', observations: 'x', evidenceSteps: [] }, view([]), 'no_account', none)
    allowed({ type: 'switch_account', account: 'Teen 15' }, view([]), { ...none, accounts: [{ id: 't', label: 'Teen 15', ageGroup: 'under_18', age: 15, handles: ['teen15'] }] })
  })
})

describe('credentials: sign-in addresses', () => {
  it.each(['/login', '/log-in', '/signin', '/sign-in', '/sso', '/auth', '/auth/start'])('treats %s as a sign-in page', (path) => {
    allowed({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }, { url: `https://app.test${path}` }))
  })
  it.each(['/author', '/settings/auth-apps', '/blog'])('does not treat %s as a sign-in page', (path) => {
    refused({ type: 'fill_credential', ref: 'e1', account: 'Teen 15', field: 'login' }, one('Email', { tag: 'input', inputType: 'email' }, { url: `https://app.test${path}` }), 'credentials')
  })
})

import { describe, expect, it } from 'vitest'
import { detectBlock } from '../../../../src/features/evidence/appSafety.js'
import { el, LONG_TEXT, view } from '../../../../src/features/evidence/appSafetyTestKit.js'

const stops = (v: ReturnType<typeof view>) => {
  const reason = detectBlock(v)
  expect(reason).not.toBeNull()
  expect(reason).toMatch(/\S/)
}

describe('detectBlock: frames', () => {
  it.each([
    'https://www.google.com/recaptcha/api2/anchor', 'https://newassets.hcaptcha.com/captcha', 'https://challenges.cloudflare.com/turnstile/x',
    'https://x.arkoselabs.com/fc', 'https://client-api.funcaptcha.com/', 'https://static.geetest.com/x', 'https://geo.captcha-delivery.com/captcha/',
    'https://ct.datadome.co/x', 'https://abc.token.awswaf.com/captcha', 'https://client.perimeterx.net/x', 'https://www.fbsbx.com/captcha/recaptcha/iframe/', 'https://www.fbsbx.com/captcha/x', 'https://challenges.cloudflare.com/cdn-cgi/x', 'https://client.px-cdn.net/x',
    'https://www.google.com/recaptcha', 'https://x.turnstile.example/',
  ])('stops on a %s frame whatever else is on the page', (frame) => {
    stops(view([], { frameUrls: [frame], text: LONG_TEXT }))
  })
})

describe('detectBlock: titles', () => {
  it.each([
    'Just a moment...', 'Attention Required! | Cloudflare', 'Access denied', 'Are you a robot?', 'Security check', 'Security Verification',
    'Human verification', 'Verify you are human', "Verify you're human", 'Verify it’s you',
  ])('stops on the title "%s"', (title) => {
    stops(view([], { title, text: LONG_TEXT }))
  })
})

describe('detectBlock: text on a short page', () => {
  it.each([
    'Verify you are human', "Verify you're human", 'Verify you’re human', 'Verify you‘re human', 'Verify youʼre human', 'Press & Hold to confirm you are a human (and not a bot).', 'Checking your browser',
    'Unusual traffic from your network', 'Enable JavaScript and cookies to continue', 'Please complete the captcha',
    'Enter the code from your authenticator app', 'Authenticator app required', 'Enter the code', 'The code we sent expires soon', 'Use your log-in code', 'Your confirmation code', 'Enter the 6 digit code', 'Enter the 6-digit code', 'We noticed unusual sign-ins', 'Two-factor authentication required', '2-step verification', 'Two-step verification',
    'Enter the verification code', 'Enter the security code', 'Enter the 6-digit code we sent to your phone', 'Enter login code',
    'Enter the confirmation code we sent to t***@x.com', 'Enter the code we sent you', 'Enter your one-time code', 'Enter your passcode',
    'We noticed unusual activity on your account', 'Suspicious activity on your account', 'Unusual activity detected', 'Help us confirm it’s you',
    "Confirm it's you", "Verify it's you", 'Your account is locked', 'Your account has been temporarily locked', 'Account locked',
    'We suspended your account', 'Your account was suspended', 'Your account has been disabled', 'We have locked your account',
  ])('stops on "%s"', (text) => {
    stops(view([], { text }))
  })
})

describe('detectBlock: long pages', () => {
  it('stops on a captcha or human check wherever it stands on the page', () => {
    stops(view([], { text: `${LONG_TEXT} Type the characters you see. captcha` }))
    stops(view([], { text: `${LONG_TEXT} Press & hold to verify` }))
    stops(view([], { text: `${LONG_TEXT} Verify you’re human` }))
    stops(view([], { text: `${LONG_TEXT} Checking your browser before accessing` }))
    stops(view([], { text: `${LONG_TEXT} Please confirm you are a human` }))
  })
  it('does not stop on a long settings page that mentions two-factor authentication or a locked account', () => {
    expect(detectBlock(view([], { title: 'Settings', text: `${LONG_TEXT} Two-factor authentication is off. Unusual activity alerts. Account locked` }))).toBeNull()
  })
  it('does not stop on a long settings page with a promo, postal, zip or country code field', () => {
    for (const name of ['Promo code', 'Postal code', 'ZIP code', 'Country code', 'Coupon code', 'Discount code', 'Voucher code', 'Area code']) {
      expect(detectBlock(view([el('c', name, { tag: 'input', inputType: 'text' })], { text: `${LONG_TEXT} Two-factor authentication` }))).toBeNull()
    }
  })
  it('does not stop on an ordinary page', () => {
    expect(detectBlock(view([]))).toBeNull()
  })
  it('does not stop on a short ordinary page', () => {
    expect(detectBlock(view([], { text: 'Welcome back. Your feed is empty.' }))).toBeNull()
  })
})

describe('detectBlock: code inputs make even a long page a block', () => {
  it.each(['Verification code', 'Security code', 'Code', 'OTP', 'One-time OTP', 'Digit 1', 'Enter digit', 'Verification'])('stops on a field named "%s"', (name) => {
    for (const inputType of [null, 'text', 'tel', 'number', 'password', 'search']) {
      stops(view([el('c', name, { tag: 'input', inputType })], { text: `${LONG_TEXT} Enter the code from your authenticator app` }))
    }
  })
  it('does not count an ordinary input on a long page', () => {
    expect(detectBlock(view([el('c', 'Search', { tag: 'input', inputType: 'text' })], { text: `${LONG_TEXT} Two-factor authentication` }))).toBeNull()
  })
  it('does not count a code field that is not an input, or a checkbox', () => {
    expect(detectBlock(view([el('c', 'Security code', { tag: 'div' })], { text: `${LONG_TEXT} Two-factor authentication` }))).toBeNull()
    expect(detectBlock(view([el('c', 'Security code', { tag: 'input', inputType: 'checkbox' })], { text: `${LONG_TEXT} Two-factor authentication` }))).toBeNull()
  })
})

describe('detectBlock: dialogs', () => {
  it('stops on a block pattern inside a dialog, whatever the page length', () => {
    for (const role of ['dialog', 'alertdialog']) {
      stops(view([el('d', 'Confirm it’s you', { role })], { text: LONG_TEXT }))
      stops(view([el('d', 'Security', { role, contextText: 'Enter the code from your authenticator app' })], { text: LONG_TEXT }))
      stops(view([el('d', 'Security', { role, contextText: 'Verify you are human captcha' })], { text: LONG_TEXT }))
      stops(view([el('d', 'Account', { role, contextText: 'Your account has been suspended' })], { text: LONG_TEXT }))
    }
  })
  it('does not stop on an ordinary dialog or a block word outside a dialog on a long page', () => {
    expect(detectBlock(view([el('d', 'Share', { role: 'dialog', contextText: 'Copy link' })], { text: LONG_TEXT }))).toBeNull()
    expect(detectBlock(view([el('d', 'Confirm it’s you', { role: 'region' })], { text: LONG_TEXT }))).toBeNull()
  })
})

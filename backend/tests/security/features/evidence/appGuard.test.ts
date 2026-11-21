import { describe, expect, it } from 'vitest'
import { createAppGuard, isInAppScope } from '../../../../src/features/evidence/appGuard.js'
import { createUrlGuard, type LookupFn } from '../../../../src/features/evidence/urlGuard.js'

const APP = 'https://app.test/'
const LOGIN_DOMAINS = ['sso.idp.test']
const OUTSIDE = 'This address is outside the app and its login domains.'

/** Every name resolves to a public address, apart from those listed as private. */
function fakeLookup(privateHosts: string[] = []): LookupFn {
  return async (host) => [{ address: privateHosts.includes(host) ? '10.0.0.5' : '93.184.216.34' }]
}

describe('isInAppScope', () => {
  it.each([
    ['https://app.test/x', true],
    ['https://m.app.test/x', true],
    ['https://www.app.test/', true],
    ['http://app.test/x', true],
    ['https://APP.test./x', true],
    ['https://sso.idp.test/login', true],
    ['https://eu.sso.idp.test/login', true],
    ['https://evilapp.test/', false],
    ['https://app.test.evil.com/', false],
    ['https://example.org/', false],
    ['https://idp.test/', false],
    ['ftp://app.test/x', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('scope of %s is %s', (url, expected) => {
    expect(isInAppScope(url, APP, LOGIN_DOMAINS)).toBe(expected)
  })

  it('strips www. from the app address, so the bare domain and its subdomains are in scope', () => {
    expect(isInAppScope('https://app.test/', 'https://www.app.test/home', [])).toBe(true)
    expect(isInAppScope('https://m.app.test/', 'https://www.app.test/home', [])).toBe(true)
  })

  it('matches an IP host only exactly, port included', () => {
    const app = 'http://127.0.0.1:5555/'
    expect(isInAppScope('http://127.0.0.1:5555/home', app, [])).toBe(true)
    expect(isInAppScope('http://127.0.0.1:5556/home', app, [])).toBe(false)
    expect(isInAppScope('http://127.0.0.2:5555/home', app, [])).toBe(false)
    expect(isInAppScope('http://1.127.0.0.1:5555/', app, [])).toBe(false)
    expect(isInAppScope('http://[::1]:7000/x', 'http://[::1]:7000/', [])).toBe(true)
    expect(isInAppScope('http://[::1]:7001/x', 'http://[::1]:7000/', [])).toBe(false)
  })

  it('accepts login domains given with a scheme or a port, and ignores ones it cannot read', () => {
    expect(isInAppScope('https://sso.idp.test/a', APP, ['https://sso.idp.test/'])).toBe(true)
    expect(isInAppScope('http://127.0.0.1:6000/a', APP, ['127.0.0.1:6000'])).toBe(true)
    expect(isInAppScope('http://127.0.0.1:6001/a', APP, ['127.0.0.1:6000'])).toBe(false)
    expect(isInAppScope('https://example.org/', APP, ['', '::bad::'])).toBe(false)
  })

  it('puts nothing in scope when the app address cannot be read', () => {
    expect(isInAppScope('https://app.test/', 'not a url', [])).toBe(false)
  })
})

describe('createAppGuard', () => {
  it('refuses an address outside the scope without asking the base guard', async () => {
    let asked = 0
    const base = { check: async () => ((asked += 1), { allowed: true as const }) }
    const guard = createAppGuard(base, APP, LOGIN_DOMAINS)

    expect(await guard.check('https://example.org/')).toEqual({ allowed: false, reason: OUTSIDE })
    expect(asked).toBe(0)
    expect(await guard.check('https://sso.idp.test/login')).toEqual({ allowed: true })
    expect(asked).toBe(1)
  })

  it('refuses a private address inside scope unless it is in allowedPrivateHosts', async () => {
    const lookup = fakeLookup(['app.test'])
    const strict = createAppGuard(createUrlGuard({ lookup }), APP, LOGIN_DOMAINS)
    const allowing = createAppGuard(createUrlGuard({ lookup, allowedPrivateHosts: ['app.test:443'] }), APP, LOGIN_DOMAINS)

    expect(await strict.check('https://app.test/home')).toEqual({ allowed: false, reason: 'Host resolves to a non-public address' })
    expect(await allowing.check('https://app.test/home')).toEqual({ allowed: true })
    // Allowed as a private host, and still outside the app.
    const outside = createAppGuard(createUrlGuard({ lookup, allowedPrivateHosts: ['other.test:443'] }), APP, LOGIN_DOMAINS)
    expect(await outside.check('https://other.test/')).toEqual({ allowed: false, reason: OUTSIDE })
  })

  it('keeps the base guard’s other refusals in scope', async () => {
    const guard = createAppGuard(createUrlGuard({ lookup: fakeLookup() }), APP, LOGIN_DOMAINS)
    expect(await guard.check('https://user:pw@app.test/')).toEqual({ allowed: false, reason: 'URLs with credentials are not allowed' })
  })
})

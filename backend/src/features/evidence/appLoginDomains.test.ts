import { describe, expect, it } from 'vitest'
import { checkLoginDomains, isPublicSuffix } from './appLoginDomains.js'

describe('isPublicSuffix', () => {
  it.each(['github.io', 'CO.UK', 'amazonaws.com', 'compute.amazonaws.com', 'com.np', 'vercel.app'])('%s is a shared ending', (host) => {
    expect(isPublicSuffix(host)).toBe(true)
  })

  it.each(['user.github.io', 'example.co.uk', 'example.com', 'my-bucket.s3.amazonaws.com.example.org'])('%s is not', (host) => {
    expect(isPublicSuffix(host)).toBe(false)
  })
})

describe('checkLoginDomains', () => {
  it('accepts a tenant of a shared ending and an ordinary sign-in host', () => {
    expect(checkLoginDomains(['user.github.io', 'accounts.example.com'])).toEqual({
      ok: true,
      domains: ['user.github.io', 'accounts.example.com'],
    })
  })

  it('refuses reserved names whatever their depth', () => {
    for (const host of ['a.b.localhost', 'x.lan', 'nas.home.arpa', 'host.localdomain']) {
      expect(checkLoginDomains([host]).ok, host).toBe(false)
    }
  })
})

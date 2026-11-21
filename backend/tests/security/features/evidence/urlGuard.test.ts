import { describe, it, expect, vi } from 'vitest'
import { createUrlGuard, type LookupFn } from '../../../../src/features/evidence/urlGuard.js'

const publicLookup: LookupFn = async () => [{ address: '93.184.216.34' }]

describe('urlGuard', () => {
  const guard = createUrlGuard({ lookup: publicLookup })

  it.each([
    'http://127.0.0.1/', 'http://localhost:3000/', 'http://10.0.0.5/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[fc00::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://[::127.0.0.1]/', 'http://[::a9fe:a9fe]/', 'http://0x7f.0.0.1/',
    'file:///etc/passwd', 'ftp://example.com/', 'http://user:pw@example.com/', 'not a url',
  ])('blocks %s', async (u) => {
    expect((await guard.check(u)).allowed).toBe(false)
  })

  it('blocks a public name that resolves to a private address', async () => {
    const g = createUrlGuard({ lookup: async () => [{ address: '10.0.0.1' }] })
    expect((await g.check('https://evil.example.com/')).allowed).toBe(false)
  })

  it('blocks when ANY resolved address is private', async () => {
    const g = createUrlGuard({ lookup: async () => [{ address: '8.8.8.8' }, { address: '10.0.0.1' }] })
    expect((await g.check('https://mixed.example.com/')).allowed).toBe(false)
  })

  it('blocks when the name does not resolve', async () => {
    const g = createUrlGuard({ lookup: async () => { throw new Error('ENOTFOUND') } })
    const r = await g.check('https://nope.example.com/')
    expect(r.allowed).toBe(false)
  })

  it('blocks when the name resolves to nothing', async () => {
    const g = createUrlGuard({ lookup: async () => [] })
    expect((await g.check('https://empty.example.com/')).allowed).toBe(false)
  })

  it('allows a public https url', async () => {
    expect(await guard.check('https://example.com/page')).toEqual({ allowed: true })
  })

  it('allows only the exact host:port in allowedPrivateHosts', async () => {
    const g = createUrlGuard({ allowedPrivateHosts: ['127.0.0.1:4000'], lookup: publicLookup })
    expect((await g.check('http://127.0.0.1:4000/')).allowed).toBe(true)
    expect((await g.check('http://127.0.0.1:4001/')).allowed).toBe(false)
    expect((await g.check('http://127.0.0.1/')).allowed).toBe(false)
  })

  it('blocks a name resolving to a ::/96 IPv4-compatible address', async () => {
    const g = createUrlGuard({ lookup: async () => [{ address: '::7f00:1' }] })
    expect((await g.check('https://v6.example.com/')).allowed).toBe(false)
  })

  it('allows a normal public IPv6 address', async () => {
    expect((await guard.check('http://[2606:4700:4700::1111]/')).allowed).toBe(true)
    const g = createUrlGuard({ lookup: async () => [{ address: '2606:4700:4700::1111' }] })
    expect((await g.check('https://v6.example.com/')).allowed).toBe(true)
  })

  it('caches lookups per guard instance', async () => {
    const lookup = vi.fn<LookupFn>(publicLookup)
    const g = createUrlGuard({ lookup })
    await g.check('https://example.com/a')
    await g.check('https://example.com/b')
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})

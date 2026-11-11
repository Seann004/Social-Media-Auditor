import { describe, expect, it } from 'vitest'
import { highlightGuard } from './capture.js'
import type { RobotsChecker } from './robots.js'
import type { UrlGuard } from './urlGuard.js'

const allowAll: UrlGuard = { check: async () => ({ allowed: true }) }
const refuseInternal: UrlGuard = {
  check: async (url) => (url.includes('169.254') ? { allowed: false, reason: 'private address' } : { allowed: true }),
}
const robots = (disallowed: string[]): RobotsChecker => ({
  isAllowed: async (url) =>
    disallowed.some((d) => url.includes(d)) ? { allowed: false, reason: 'robots.txt does not allow this page.' } : { allowed: true, reason: null },
})

describe('highlightGuard', () => {
  it('allows the page itself and other addresses on its site', async () => {
    const guard = highlightGuard('https://www.example.com/privacy', allowAll, null)
    expect((await guard.check('https://www.example.com/privacy')).allowed).toBe(true)
    expect((await guard.check('https://help.example.com/x')).allowed).toBe(true)
  })

  it('refuses an address on another site, as a followed link would be', async () => {
    const guard = highlightGuard('https://example.com/privacy', allowAll, null)
    expect((await guard.check('https://evil.test/x')).allowed).toBe(false)
  })

  it('refuses what the url guard refuses', async () => {
    const guard = highlightGuard('https://example.com/privacy', refuseInternal, null)
    const verdict = await guard.check('https://example.com/http://169.254.169.254/')
    expect(verdict.allowed).toBe(false)
  })

  it('applies robots.txt when a checker is given, and not when it is null', async () => {
    const blocked = highlightGuard('https://example.com/private', allowAll, robots(['/private']))
    expect((await blocked.check('https://example.com/private')).allowed).toBe(false)
    const free = highlightGuard('https://example.com/private', allowAll, null)
    expect((await free.check('https://example.com/private')).allowed).toBe(true)
  })
})

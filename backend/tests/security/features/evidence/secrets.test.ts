import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  parseSecretKey,
  secretAad,
  encryptSecret,
  decryptSecret,
  redactUrl,
  SecretUnreadableError,
} from '../../../../src/features/evidence/secrets.js'

const key = randomBytes(32)
const aad = secretAad('proj-1', 'acc-1')
const PW = 'Teen-Pass-111'

function swapLast(part: string): string {
  return part.slice(0, -2) + (part.endsWith('AA') ? 'BB' : 'AA')
}

describe('secrets', () => {
  it('builds the aad from project and account', () => expect(aad).toBe('proj-1/acc-1'))

  it('round-trips a password', () => expect(decryptSecret(encryptSecret(PW, key, aad), key, aad)).toBe(PW))

  it('uses a fresh IV, so the same password encrypts differently each time', () => {
    expect(encryptSecret(PW, key, aad)).not.toBe(encryptSecret(PW, key, aad))
  })

  it('the blob never contains the password', () => {
    const blob = encryptSecret(PW, key, aad)
    expect(blob).not.toContain(PW)
    expect(blob.startsWith('v1.')).toBe(true)
    expect(blob.split('.')).toHaveLength(4)
  })

  const cases: Array<[string, () => { blob: string; key: Buffer; aad: string }]> = [
    ['wrong key', () => ({ blob: encryptSecret(PW, key, aad), key: randomBytes(32), aad })],
    ['other account aad', () => ({ blob: encryptSecret(PW, key, aad), key, aad: secretAad('proj-1', 'acc-2') })],
    ['tampered tag', () => {
      const p = encryptSecret(PW, key, aad).split('.')
      p[2] = swapLast(p[2])
      return { blob: p.join('.'), key, aad }
    }],
    ['tampered ciphertext', () => {
      const p = encryptSecret(PW, key, aad).split('.')
      p[3] = swapLast(p[3])
      return { blob: p.join('.'), key, aad }
    }],
    ['not a blob', () => ({ blob: 'not a blob', key, aad })],
    ['a v2 version', () => {
      const p = encryptSecret(PW, key, aad).split('.')
      p[0] = 'v2'
      return { blob: p.join('.'), key, aad }
    }],
    ['a short IV', () => {
      const p = encryptSecret(PW, key, aad).split('.')
      p[1] = p[1].slice(0, 8)
      return { blob: p.join('.'), key, aad }
    }],
    ['a 4-byte tag', () => {
      const p = encryptSecret(PW, key, aad).split('.')
      p[2] = Buffer.from(p[2], 'base64url').subarray(0, 4).toString('base64url')
      return { blob: p.join('.'), key, aad }
    }],
  ]
  it.each(cases)('throws SecretUnreadableError on %s, without echoing the blob', (_n, make) => {
    const c = make()
    let caught: unknown
    try { decryptSecret(c.blob, c.key, c.aad) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(SecretUnreadableError)
    const msg = (caught as Error).message
    expect(msg).toBe('The saved password cannot be read with the current key.')
    expect(msg).not.toContain(c.blob)
  })

  describe('parseSecretKey', () => {
    it('is null when unset or blank', () => {
      expect(parseSecretKey(undefined)).toBeNull()
      expect(parseSecretKey('')).toBeNull()
      expect(parseSecretKey('   ')).toBeNull()
    })
    it('returns a 32-byte Buffer for a valid key', () => {
      const k = parseSecretKey(randomBytes(32).toString('base64'))
      expect(Buffer.isBuffer(k)).toBe(true)
      expect(k?.length).toBe(32)
    })
    it('rejects stray characters that would still decode to 32 bytes', () => {
      const msg = 'EVIDENCE_SECRET_KEY must be 32 random bytes, base64 encoded'
      const good = randomBytes(32).toString('base64')
      expect(() => parseSecretKey(`${good.slice(0, 10)}-${good.slice(11)}`)).toThrow(msg)
      expect(() => parseSecretKey(`${good.slice(0, 10)} ${good.slice(11)}`)).toThrow(msg)
    })
    it('throws for 16 bytes or non-base64', () => {
      const msg = 'EVIDENCE_SECRET_KEY must be 32 random bytes, base64 encoded'
      expect(() => parseSecretKey(randomBytes(16).toString('base64'))).toThrow(msg)
      expect(() => parseSecretKey('!!!not base64!!!')).toThrow(msg)
    })
  })

  describe('redactUrl', () => {
    it('blanks password-like query values and credentials', () => {
      expect(redactUrl('https://app.test/login?user=a&password=Teen-Pass-111&next=/home'))
        .toBe('https://app.test/login?user=a&password=redacted&next=%2Fhome')
      expect(redactUrl('https://u:p@app.test/x')).toBe('https://app.test/x')
    })
    it('redacts every matching name, case-insensitively, including repeats', () => {
      const out = redactUrl('https://a.test/?Token=1&api_secret=2&otp=3&code=4&auth=5&pwd=6&token=7&q=ok')
      expect(out).toBe('https://a.test/?Token=redacted&api_secret=redacted&otp=redacted&code=redacted&auth=redacted&pwd=redacted&token=redacted&q=ok')
    })
    it('drops the fragment entirely', () => {
      expect(redactUrl('https://a.test/p#access_token=abc')).toBe('https://a.test/p')
      expect(redactUrl('https://a.test/#/login?password=zz')).toBe('https://a.test/')
    })
    it('redacts key-like names as whole names only', () => {
      const out = redactUrl('https://a.test/?api_key=1&apikey=2&key=3&sid=4&session=5&jwt=6&signature=7&monkey=ok&Key=8')
      expect(out).toBe('https://a.test/?api_key=redacted&apikey=redacted&key=redacted&sid=redacted&session=redacted&jwt=redacted&signature=redacted&monkey=ok&Key=redacted')
    })
    it('redacts pw, pwd and passwd, and leaves names that only contain pw', () => {
      const out = redactUrl('https://a.test/?pw=1&PW=2&pwd=3&passwd=4&upwards=ok')
      expect(out).toBe('https://a.test/?pw=redacted&PW=redacted&pwd=redacted&passwd=redacted&upwards=ok')
    })
    it('returns a placeholder for an unreadable address', () => {
      expect(redactUrl('not a url')).toBe('[unreadable address]')
    })
  })
})

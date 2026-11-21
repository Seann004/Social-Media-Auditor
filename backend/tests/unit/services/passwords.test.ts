import { describe, expect, it } from 'vitest'
import { hashPassword, isPasswordHash, verifyPassword } from '../../../src/services/passwords.js'

// The browser already sends SHA-256(password); the server stores a salted bcrypt hash of that value (NFR-05).
const SHA = 'a'.repeat(64)

describe('passwords', () => {
  it('stores a salted bcrypt hash, never the value it was given', async () => {
    const stored = await hashPassword(SHA)
    expect(stored).not.toBe(SHA)
    expect(stored).toMatch(/^\$2[aby]\$\d{2}\$/)
    expect(isPasswordHash(stored)).toBe(true)
  })

  it('gives a different hash each time for the same password (salt)', async () => {
    expect(await hashPassword(SHA)).not.toBe(await hashPassword(SHA))
  })

  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword(SHA)
    expect(await verifyPassword(SHA, stored)).toBe(true)
    expect(await verifyPassword('b'.repeat(64), stored)).toBe(false)
  })

  it('treats a legacy (unsalted) value or nothing as not a bcrypt hash', async () => {
    expect(isPasswordHash(SHA)).toBe(false)
    expect(isPasswordHash(null)).toBe(false)
    expect(isPasswordHash(undefined)).toBe(false)
    expect(await verifyPassword(SHA, SHA)).toBe(false)
    expect(await verifyPassword(SHA, null)).toBe(false)
  })

  it('refuses an empty password when hashing', async () => {
    await expect(hashPassword('')).rejects.toThrow('A password is required.')
  })
})

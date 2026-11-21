import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRpc, resetTables } from '../../helpers/fakeSupabase.js'
import { coreWorld, U } from '../../fixtures/coreWorld.js'
import { loadCoreServer, quietConsole } from '../../helpers/coreServer.js'

vi.mock('dotenv/config', () => ({}))
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }))
vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

// Security finding S-4: password guessing on POST /api/auth/login is limited to 20 attempts per client per 15 minutes.
// The limiter lives in the module, so this file loads its own copy of the app and counts from zero.
const { app } = await loadCoreServer()

const LIMIT = 20
let checks = 0

beforeEach(() => {
  resetTables(coreWorld())
  checks = 0
  onRpc('verify_user_login', ({ p_password }) => {
    checks++
    return p_password === 'right'
      ? { data: [{ userId: U.aud, userName: 'Ali Auditor', role: 'auditor' }], error: null }
      : { data: [], error: null }
  })
  quietConsole()
})
afterEach(() => vi.restoreAllMocks())

describe('login rate limit (S-4)', () => {
  it('answers 429 to the 21st attempt from one client without checking the password, and keeps other routes open', async () => {
    for (let i = 1; i <= LIMIT; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'aud@example.test', password: `guess-${i}` })
      expect(res.status, `attempt ${i}`).toBe(401)
      expect(res.headers['ratelimit-limit']).toBe(String(LIMIT))
      expect(res.headers['ratelimit-remaining']).toBe(String(LIMIT - i))
    }
    expect(checks).toBe(LIMIT)

    const blocked = await request(app).post('/api/auth/login').send({ email: 'aud@example.test', password: 'right' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many login attempts. Please try again later.' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(15 * 60)
    // The right password is not even checked once the client is blocked.
    expect(checks).toBe(LIMIT)

    // Only the login is limited: the rest of the API still answers this client.
    expect((await request(app).get('/api/health')).status).toBe(200)
  })
})

import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessions, requireSession, sessionsFromEnv, type Sessions } from '../../../../src/features/auth/session.js'

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long'
/** What the app login (`POST /api/auth/login`) puts in its token. */
const MAIN_CLAIMS = { userId: 'u-1', userName: 'Ada', role: 'auditor' }

function makeApp(sessions: Sessions | null = createSessions(SECRET)) {
  const app = express()
  app.get('/protected', requireSession(sessions), (_req, res) => {
    res.json({ session: res.locals.session })
  })
  return { app, sessions }
}

afterEach(() => vi.restoreAllMocks())

describe('tokens from the app login', () => {
  const sessions = createSessions(SECRET)

  it('accepts a JWT_SECRET token in the app login shape { userId, userName, role }', () => {
    const token = jwt.sign(MAIN_CLAIMS, SECRET, { expiresIn: '12h' })
    expect(sessions.verify(token)).toEqual({ userId: 'u-1', role: 'auditor' })
  })

  it('accepts a token from the real signToken of middleware/auth.ts', async () => {
    vi.resetModules()
    const saved = process.env.JWT_SECRET
    process.env.JWT_SECRET = SECRET
    try {
      const { signToken } = await import('../../../../src/middleware/auth.js')
      const token = signToken({ userId: 'u-9', userName: 'Bo', role: 'admin' })
      expect(sessions.verify(token)).toEqual({ userId: 'u-9', role: 'admin' })
    } finally {
      if (saved === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = saved
    }
  })

  it('rejects a token in the right shape signed with another secret', () => {
    const other = 'another-secret-that-is-also-32-chars-or-more'
    expect(sessions.verify(jwt.sign(MAIN_CLAIMS, other, { expiresIn: '12h' }))).toBeNull()
  })

  it('rejects a tampered token, an expired token and an alg:none token', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const good = sessions.sign({ userId: 'u-1', role: 'auditor' })
    expect(sessions.verify(good)).toEqual({ userId: 'u-1', role: 'auditor' })
    const [h, , s] = good.split('.')
    const forged = b64({ userId: 'admin-1', role: 'admin', exp: 9999999999 })
    expect(sessions.verify(`${h}.${forged}.${s}`)).toBeNull()
    expect(sessions.verify(jwt.sign(MAIN_CLAIMS, SECRET, { expiresIn: -10 }))).toBeNull()
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...MAIN_CLAIMS, exp: 9999999999 })}.`
    expect(sessions.verify(noneToken)).toBeNull()
  })

  it('rejects another algorithm, a missing userId or role, no expiry, and garbage, without throwing', () => {
    expect(sessions.verify(jwt.sign(MAIN_CLAIMS, SECRET, { expiresIn: 60, algorithm: 'HS512' }))).toBeNull()
    expect(sessions.verify(jwt.sign({ role: 'auditor' }, SECRET, { expiresIn: 60 }))).toBeNull()
    expect(sessions.verify(jwt.sign({ userId: 'u-1' }, SECRET, { expiresIn: 60 }))).toBeNull()
    // The old evidence-only shape carried the user in `sub`; only the app login shape is accepted now.
    expect(sessions.verify(jwt.sign({ role: 'auditor' }, SECRET, { subject: 'u-1', expiresIn: 60 }))).toBeNull()
    expect(sessions.verify(jwt.sign(MAIN_CLAIMS, SECRET, { noTimestamp: true }))).toBeNull()
    expect(sessions.verify('not-a-token')).toBeNull()
    expect(sessions.verify('')).toBeNull()
  })

  it('signs HS256 tokens in the app login shape with an expiry of SESSION_HOURS', () => {
    const decoded = jwt.decode(sessions.sign({ userId: 'u-1', role: 'auditor' }), { complete: true }) as {
      header: { alg: string }
      payload: { exp: number; iat: number; userId: string; role: string; sub?: string }
    }
    expect(decoded.header.alg).toBe('HS256')
    expect(decoded.payload.exp - decoded.payload.iat).toBe(12 * 3600)
    expect(decoded.payload).toMatchObject({ userId: 'u-1', role: 'auditor' })
    expect(decoded.payload.sub).toBeUndefined()
  })

  it('createSessions throws for a short secret', () => {
    expect(() => createSessions('short')).toThrow(/at least 32/)
  })
})

describe('sessionsFromEnv', () => {
  it('reads JWT_SECRET', () => {
    const sessions = sessionsFromEnv({ JWT_SECRET: SECRET })
    expect(sessions).not.toBeNull()
    expect(sessions!.verify(jwt.sign(MAIN_CLAIMS, SECRET, { expiresIn: '12h' }))).toEqual({
      userId: 'u-1',
      role: 'auditor',
    })
  })

  it('turns evidence off with one console.error, without throwing, when JWT_SECRET is unset, empty or short', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(sessionsFromEnv({})).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    expect(sessionsFromEnv({ JWT_SECRET: '' })).toBeNull()
    expect(error).toHaveBeenCalledTimes(2)
    expect(() => sessionsFromEnv({ JWT_SECRET: 'short' })).not.toThrow()
    expect(sessionsFromEnv({ JWT_SECRET: 'x'.repeat(31) })).toBeNull()
    expect(error).toHaveBeenCalledTimes(4)
    expect(String(error.mock.calls[3][0])).toMatch(/JWT_SECRET/)
    expect(String(error.mock.calls[3][0])).not.toContain('x'.repeat(31))
  })

  it('ignores SESSION_SECRET', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(sessionsFromEnv({ SESSION_SECRET: SECRET })).toBeNull()
  })
})

describe('requireSession', () => {
  it('returns 401 without a Bearer token, and for bad ones, with one message', async () => {
    const { app } = makeApp()
    const bodies: unknown[] = []
    const foreign = jwt.sign(MAIN_CLAIMS, 'y'.repeat(40), { expiresIn: 60 })
    for (const header of [undefined, 'Bearer', 'Bearer junk', 'Basic abc', `Bearer ${foreign}`]) {
      const req = request(app).get('/protected')
      const r = header ? await req.set('Authorization', header) : await req
      expect(r.status).toBe(401)
      bodies.push(r.body)
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
  })

  it('rejects odd Authorization shapes', async () => {
    const { app, sessions } = makeApp()
    const t = sessions!.sign({ userId: 'u-1', role: 'auditor' })
    for (const header of [`Bearer  ${t}`, `Bearer	${t}`, `Bearer ${t} ${t}`]) {
      const r = await request(app).get('/protected').set('Authorization', header)
      expect(r.status, header.slice(0, 12)).toBe(401)
    }
  })

  it('accepts the app login token with a case-insensitive scheme and sets only the token claims', async () => {
    const { app } = makeApp()
    const token = jwt.sign(MAIN_CLAIMS, SECRET, { expiresIn: '12h' })
    const res = await request(app)
      .get('/protected?userId=evil&role=admin')
      .set('Authorization', `bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.session).toEqual({ userId: 'u-1', role: 'auditor' })
  })

  it('answers 503 when sessions are off', async () => {
    const { app } = makeApp(null)
    const res = await request(app).get('/protected').set('Authorization', 'Bearer x')
    expect(res.status).toBe(503)
  })
})

import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthRouter, verifyLoginWithSupabase, type VerifyLogin } from './routes.js'
import { createSessions, requireSession, sessionsFromEnv } from './session.js'

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long'
const USER = { userId: 'u-1', userName: 'Ada', role: 'auditor' }
const HASH = 'a'.repeat(64)

function makeApp(verifyLogin: VerifyLogin, secret: string | null = SECRET) {
  const sessions = secret === null ? null : createSessions(secret)
  const app = express()
  app.use(createAuthRouter({ verifyLogin, sessions }))
  app.get('/protected', requireSession(sessions), (_req, res) => {
    res.json({ session: res.locals.session })
  })
  return { app, sessions }
}

afterEach(() => vi.restoreAllMocks())

describe('login', () => {
  it('returns a token that verifies to the user id and role from the database', async () => {
    const verifyLogin = vi.fn(async () => USER)
    const { app, sessions } = makeApp(verifyLogin)
    const res = await request(app).post('/auth/login').send({ email: '  Ada@Example.COM ', password: HASH })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ userId: 'u-1', userName: 'Ada', role: 'auditor' })
    expect(sessions!.verify(res.body.token)).toEqual({ userId: 'u-1', role: 'auditor' })
    expect(verifyLogin).toHaveBeenCalledWith('ada@example.com', HASH)
  })

  it('ignores any role or userId sent by the client', async () => {
    const { app, sessions } = makeApp(async () => USER)
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.co', password: HASH, role: 'admin', userId: 'evil' })
    expect(res.status).toBe(200)
    expect(sessions!.verify(res.body.token)).toEqual({ userId: 'u-1', role: 'auditor' })
  })

  it('returns 401 with one generic message for a wrong password and an unknown email', async () => {
    const { app } = makeApp(async () => null)
    const a = await request(app).post('/auth/login').send({ email: 'a@b.co', password: HASH })
    const b = await request(app).post('/auth/login').send({ email: 'nobody@b.co', password: 'x' })
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(a.body).toEqual(b.body)
    expect(typeof a.body.error).toBe('string')
  })

  it('returns 400 for a malformed body and never calls verifyLogin', async () => {
    const verifyLogin = vi.fn(async () => USER)
    const { app } = makeApp(verifyLogin)
    const bodies = [
      {},
      { email: 'a@b.co' },
      { email: 5, password: HASH },
      { email: 'a@b.co', password: '' },
      { email: 'x'.repeat(500), password: HASH },
    ]
    for (const body of bodies) {
      const res = await request(app).post('/auth/login').send(body)
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.body)).not.toContain('xxxx')
    }
    expect(verifyLogin).not.toHaveBeenCalled()
  })

  it('returns 429 after 10 attempts', async () => {
    const { app } = makeApp(async () => null)
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/auth/login').send({ email: 'a@b.co', password: HASH })
      expect(r.status).toBe(401)
    }
    const res = await request(app).post('/auth/login').send({ email: 'a@b.co', password: HASH })
    expect(res.status).toBe(429)
    expect(typeof res.body.error).toBe('string')
  })

  it('returns 503, not 401, when verifyLogin throws, and logs no password or full email', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app } = makeApp(async () => {
      throw new Error('db down')
    })
    const res = await request(app).post('/auth/login').send({ email: 'a@b.co', password: HASH })
    expect(res.status).toBe(503)
    expect(err).toHaveBeenCalled()
    expect(JSON.stringify(err.mock.calls)).not.toContain(HASH)
    expect(JSON.stringify(err.mock.calls)).not.toContain('a@b.co')
  })

  it('answers 503 without calling verifyLogin when sessions are off', async () => {
    const verifyLogin = vi.fn(async () => USER)
    const { app } = makeApp(verifyLogin, null)
    const res = await request(app).post('/auth/login').send({ email: 'a@b.co', password: HASH })
    expect(res.status).toBe(503)
    expect(verifyLogin).not.toHaveBeenCalled()
    expect((await request(app).get('/protected')).status).toBe(503)
  })
})

describe('login limiter', () => {
  const attempt = (app: express.Express, password = HASH) =>
    request(app).post('/auth/login').send({ email: 'a@b.co', password })

  it('does not count successful logins', async () => {
    const { app } = makeApp(async () => USER)
    for (let i = 0; i < 11; i++) expect((await attempt(app)).status).toBe(200)
  })

  it('does not count malformed bodies or 503s', async () => {
    let fail = true
    const { app } = makeApp(async () => {
      if (fail) throw new Error('down')
      return null
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 11; i++) expect((await request(app).post('/auth/login').send({})).status).toBe(400)
    for (let i = 0; i < 11; i++) expect((await attempt(app)).status).toBe(503)
    fail = false
    expect((await attempt(app)).status).toBe(401)
  })

  it('blocks the 11th wrong password before verifyLogin is called', async () => {
    const verifyLogin = vi.fn(async () => null)
    const { app } = makeApp(verifyLogin)
    for (let i = 0; i < 10; i++) expect((await attempt(app)).status).toBe(401)
    expect((await attempt(app)).status).toBe(429)
    expect(verifyLogin).toHaveBeenCalledTimes(10)
  })
})

describe('bad bodies', () => {
  it('answers malformed JSON with a plain 400 and no detail', async () => {
    const { app } = makeApp(async () => USER)
    const res = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{bad')
    expect(res.status).toBe(400)
    expect(res.type).toBe('application/json')
    expect(Object.keys(res.body)).toEqual(['error'])
    expect(res.text).not.toMatch(/at |node_modules|SyntaxError/)
  })

  it('answers an oversize body with a plain 413 and no detail', async () => {
    const { app } = makeApp(async () => USER)
    const res = await request(app).post('/auth/login').send({ email: 'a@b.co', password: 'p'.repeat(500_000) })
    expect(res.status).toBe(413)
    expect(Object.keys(res.body)).toEqual(['error'])
    expect(res.text).not.toMatch(/node_modules|\.js:/)
  })
})

describe('log hygiene', () => {
  it('logs only a plain domain, else "unknown"', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app } = makeApp(async () => {
      throw new Error('down')
    })
    const secretish = 'hunter2-my-password@' + 'x'.repeat(100)
    await request(app).post('/auth/login').send({ email: secretish, password: HASH })
    await request(app).post('/auth/login').send({ email: 'a@evil.com\nFAKE LOG LINE', password: HASH })
    await request(app).post('/auth/login').send({ email: 'a@School.Edu', password: HASH })
    const lines = err.mock.calls.map((c) => String(c[0]))
    expect(lines[0]).toContain('unknown')
    expect(lines[0]).not.toContain('xxxx')
    expect(lines[1]).toContain('unknown')
    expect(lines[1]).not.toContain('FAKE')
    expect(lines[2]).toContain('school.edu')
  })
})

describe('tokens', () => {
  const sessions = createSessions(SECRET)
  const claims = { role: 'auditor' }
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

  it('rejects a tampered token, an expired token and an alg:none token', () => {
    const good = sessions.sign({ userId: 'u-1', role: 'auditor' })
    expect(sessions.verify(good)).toEqual({ userId: 'u-1', role: 'auditor' })
    const [h, , s] = good.split('.')
    const forged = b64({ sub: 'admin-1', role: 'admin', exp: 9999999999 })
    expect(sessions.verify(`${h}.${forged}.${s}`)).toBeNull()
    expect(sessions.verify(jwt.sign(claims, SECRET, { subject: 'u-1', expiresIn: -10 }))).toBeNull()
    const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u-1', ...claims, exp: 9999999999 })}.`
    expect(sessions.verify(noneToken)).toBeNull()
  })

  it('rejects another secret, another algorithm, a missing sub, and garbage, without throwing', () => {
    const other = 'another-secret-that-is-also-32-chars-or-more'
    expect(sessions.verify(jwt.sign(claims, other, { subject: 'u-1', expiresIn: 60 }))).toBeNull()
    expect(sessions.verify(jwt.sign(claims, SECRET, { subject: 'u-1', expiresIn: 60, algorithm: 'HS512' }))).toBeNull()
    expect(sessions.verify(jwt.sign(claims, SECRET, { expiresIn: 60 }))).toBeNull()
    expect(sessions.verify(jwt.sign({}, SECRET, { subject: 'u-1', expiresIn: 60 }))).toBeNull()
    expect(sessions.verify(jwt.sign({ ...claims }, SECRET, { subject: 'u-1', noTimestamp: true }))).toBeNull()
    expect(sessions.verify('not-a-token')).toBeNull()
    expect(sessions.verify('')).toBeNull()
  })

  it('signs HS256 with an expiry of SESSION_HOURS', () => {
    const decoded = jwt.decode(sessions.sign({ userId: 'u-1', role: 'auditor' }), { complete: true }) as {
      header: { alg: string }
      payload: { exp: number; iat: number }
    }
    expect(decoded.header.alg).toBe('HS256')
    expect(decoded.payload.exp - decoded.payload.iat).toBe(12 * 3600)
  })

  it('throws at startup for a short secret', () => {
    expect(() => createSessions('short')).toThrow()
    expect(() => sessionsFromEnv({ SESSION_SECRET: 'short' })).toThrow()
  })

  it('sessionsFromEnv gives null with one warning when the secret is unset or empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(sessionsFromEnv({})).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(sessionsFromEnv({ SESSION_SECRET: '' })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(sessionsFromEnv({ SESSION_SECRET: SECRET })).not.toBeNull()
  })
})

describe('requireSession', () => {
  it('returns 401 without a Bearer token, and for bad ones, with one message', async () => {
    const { app } = makeApp(async () => USER)
    const bodies: unknown[] = []
    const foreign = jwt.sign({ role: 'x' }, 'y'.repeat(40), { subject: 'u' })
    for (const header of [undefined, 'Bearer', 'Bearer junk', 'Basic abc', `Bearer ${foreign}`]) {
      const req = request(app).get('/protected')
      const r = header ? await req.set('Authorization', header) : await req
      expect(r.status).toBe(401)
      bodies.push(r.body)
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
  })

  it('rejects odd Authorization shapes', async () => {
    const { app, sessions } = makeApp(async () => USER)
    const t = sessions!.sign({ userId: 'u-1', role: 'auditor' })
    for (const header of [`Bearer  ${t}`, `Bearer	${t}`, `Bearer ${t} ${t}`]) {
      const r = await request(app).get('/protected').set('Authorization', header)
      expect(r.status, header.slice(0, 12)).toBe(401)
    }
  })

  it('gives the same 401 body for a wrong password and an unknown email from separate fakes', async () => {
    const wrong = await request(makeApp(async () => null).app).post('/auth/login').send({ email: 'a@b.co', password: HASH })
    const unknown = await request(makeApp(async () => null).app).post('/auth/login').send({ email: 'z@q.co', password: 'zz' })
    expect(wrong.status).toBe(401)
    expect(wrong.body).toEqual(unknown.body)
  })

  it('accepts a case-insensitive scheme and sets only the token claims', async () => {
    const { app, sessions } = makeApp(async () => USER)
    const token = sessions!.sign({ userId: 'u-1', role: 'auditor' })
    const res = await request(app)
      .get('/protected?userId=evil&role=admin')
      .set('Authorization', `bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.session).toEqual({ userId: 'u-1', role: 'auditor' })
  })
})

describe('verifyLoginWithSupabase', () => {
  it('maps the RPC row, returns null for no row, and throws on an RPC error', async () => {
    const rpc = vi.fn()
    const client = { rpc } as never
    rpc.mockResolvedValueOnce({ data: [{ userId: 'u-1', userName: 'Ada', role: 'auditor', extra: 1 }], error: null })
    expect(await verifyLoginWithSupabase('a@b.co', HASH, client)).toEqual(USER)
    expect(rpc).toHaveBeenCalledWith('verify_user_login', { p_email: 'a@b.co', p_password: HASH })
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await verifyLoginWithSupabase('a@b.co', HASH, client)).toBeNull()
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(verifyLoginWithSupabase('a@b.co', HASH, client)).rejects.toThrow()
  })

  it('imports without any key set', async () => {
    vi.resetModules()
    const saved = { ...process.env }
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    try {
      await expect(import('./routes.js')).resolves.toBeDefined()
    } finally {
      process.env = saved
    }
  })
})

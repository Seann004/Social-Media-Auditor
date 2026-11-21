import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long'

/** auth.ts reads JWT_SECRET when it is loaded, so each test loads a fresh copy with the secret it needs. */
async function loadAuth(secret: string | undefined) {
  vi.resetModules()
  const saved = process.env.JWT_SECRET
  if (secret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = secret
  try {
    return await import('../../../src/middleware/auth.js')
  } finally {
    if (saved === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = saved
  }
}

function appWith(auth: Awaited<ReturnType<typeof loadAuth>>) {
  const app = express()
  app.get('/optional', auth.optionalAuth, (req, res) => { res.json({ user: req.user ?? null }) })
  app.get('/required', auth.requireAuth, (req, res) => { res.json({ user: req.user }) })
  app.get('/admin', auth.requireAuth, auth.requireRole('admin', 'head_auditor'), (_req, res) => { res.json({ ok: true }) })
  app.get('/role-without-auth', auth.requireRole('admin'), (_req, res) => { res.json({ ok: true }) })
  return app
}

afterEach(() => vi.restoreAllMocks())

describe('signToken', () => {
  it('signs an HS256 token that expires after 12 hours', async () => {
    const auth = await loadAuth(SECRET)
    const decoded = jwt.decode(auth.signToken({ userId: 'u1', userName: 'A', role: 'auditor' }), { complete: true }) as any
    expect(decoded.header.alg).toBe('HS256')
    expect(decoded.payload.exp - decoded.payload.iat).toBe(12 * 3600)
  })

  it('throws when JWT_SECRET is not set', async () => {
    const auth = await loadAuth(undefined)
    expect(() => auth.signToken({ userId: 'u1', userName: 'A', role: 'auditor' })).toThrow('JWT_SECRET is not configured')
  })
})

describe('optionalAuth, requireAuth and requireRole', () => {
  it('optionalAuth sets the user from a good token and passes without one', async () => {
    const auth = await loadAuth(SECRET)
    const app = appWith(auth)
    const token = auth.signToken({ userId: 'u1', userName: 'A', role: 'auditor' })
    const withToken = await request(app).get('/optional').set('Authorization', `Bearer ${token}`)
    expect(withToken.body.user).toMatchObject({ userId: 'u1', role: 'auditor' })
    expect((await request(app).get('/optional')).body.user).toBeNull()
    expect((await request(app).get('/optional').set('Authorization', 'Bearer junk')).body.user).toBeNull()
  })

  it('requireAuth refuses a token signed with HS512 even with the right secret', async () => {
    const auth = await loadAuth(SECRET)
    const hs512 = jwt.sign({ userId: 'u1', userName: 'A', role: 'admin' }, SECRET, { algorithm: 'HS512' })
    expect((await request(appWith(auth)).get('/required').set('Authorization', `Bearer ${hs512}`)).status).toBe(401)
  })

  it('requireAuth refuses every token when JWT_SECRET is not set', async () => {
    const auth = await loadAuth(undefined)
    const token = jwt.sign({ userId: 'u1', userName: 'A', role: 'admin' }, SECRET)
    expect((await request(appWith(auth)).get('/required').set('Authorization', `Bearer ${token}`)).status).toBe(401)
  })

  it('requireRole lets the listed roles in and answers 403 to others or without a user', async () => {
    const auth = await loadAuth(SECRET)
    const app = appWith(auth)
    const as = (role: 'admin' | 'head_auditor' | 'auditor') => `Bearer ${auth.signToken({ userId: 'u1', userName: 'A', role })}`
    expect((await request(app).get('/admin').set('Authorization', as('admin'))).status).toBe(200)
    expect((await request(app).get('/admin').set('Authorization', as('head_auditor'))).status).toBe(200)
    const denied = await request(app).get('/admin').set('Authorization', as('auditor'))
    expect(denied.status).toBe(403)
    expect(denied.body.error).toBe('You do not have permission to perform this action')
    expect((await request(app).get('/role-without-auth')).status).toBe(403)
  })
})

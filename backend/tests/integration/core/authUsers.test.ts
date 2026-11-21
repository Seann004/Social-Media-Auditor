import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failNext, onRpc, resetTables, tables } from '../../helpers/fakeSupabase.js'
import { coreWorld, id, U } from '../../fixtures/coreWorld.js'
import { loadCoreServer, quietConsole, TEST_SECRET } from '../../helpers/coreServer.js'
import { hashPassword, isPasswordHash, verifyPassword } from '../../../src/services/passwords.js'

vi.mock('dotenv/config', () => ({}))
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }))
vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

const { app, bearer } = await loadCoreServer()

beforeEach(() => {
  resetTables(coreWorld())
  quietConsole()
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/health', () => {
  it('answers ok without a token', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false)
  })
})

describe('POST /api/auth/login', () => {
  it('answers 400 without an email or a password', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'a@b.c' })).status).toBe(400)
    expect((await request(app).post('/api/auth/login').send({ password: 'x' })).status).toBe(400)
  })

  it('answers 401 for wrong credentials, a database error and an unknown function', async () => {
    onRpc('verify_user_login', () => ({ data: [], error: null }))
    const wrong = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'nope' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toBe('Incorrect email or password.')

    onRpc('verify_user_login', () => ({ data: null, error: { message: 'boom' } }))
    expect((await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' })).status).toBe(401)
  })

  it('normalises the email, and answers a 12 hour token in the app login shape', async () => {
    const seen: unknown[] = []
    onRpc('verify_user_login', (args) => {
      seen.push(args)
      return { data: [{ userId: U.aud, userName: 'Ali Auditor', role: 'auditor', userEmail: 'aud@example.test' }], error: null }
    })
    const res = await request(app).post('/api/auth/login').send({ email: '  Aud@Example.TEST ', password: 'pw' })
    expect(res.status).toBe(200)
    expect(seen).toEqual([{ p_email: 'aud@example.test', p_password: 'pw' }])
    expect(res.body.user).toEqual({ userId: U.aud, userName: 'Ali Auditor', role: 'auditor' })
    const claims = jwt.verify(res.body.token, TEST_SECRET) as any
    expect(claims).toMatchObject({ userId: U.aud, userName: 'Ali Auditor', role: 'auditor' })
    expect(claims.exp - claims.iat).toBe(12 * 3600)
  })

  it('checks a bcrypt-stored password on the server without the database function (NFR-05)', async () => {
    const rpc: unknown[] = []
    onRpc('verify_user_login', (args) => { rpc.push(args); return { data: [], error: null } })
    tables.User.find((u) => u.userId === U.aud)!.userPassword = await hashPassword('sha-of-right')

    const ok = await request(app).post('/api/auth/login').send({ email: 'Aud@example.test', password: 'sha-of-right' })
    expect(ok.status).toBe(200)
    expect(ok.body.user).toEqual({ userId: U.aud, userName: 'Ali Auditor', role: 'auditor' })

    const wrong = await request(app).post('/api/auth/login').send({ email: 'aud@example.test', password: 'sha-of-wrong' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).toBe('Incorrect email or password.')
    expect(rpc).toEqual([])
  })

  it('upgrades a legacy unsalted password to bcrypt after one successful login', async () => {
    tables.User.find((u) => u.userId === U.aud)!.userPassword = 'legacy-sha'
    onRpc('verify_user_login', (args: any) => ({
      data: args.p_password === 'legacy-sha' ? [{ userId: U.aud, userName: 'Ali Auditor', role: 'auditor' }] : [],
      error: null,
    }))

    expect((await request(app).post('/api/auth/login').send({ email: 'aud@example.test', password: 'legacy-sha' })).status).toBe(200)
    const stored = tables.User.find((u) => u.userId === U.aud)!.userPassword as string
    expect(isPasswordHash(stored)).toBe(true)
    expect(await verifyPassword('legacy-sha', stored)).toBe(true)

    // The next login is checked against the bcrypt hash, so the old function is no longer needed.
    onRpc('verify_user_login', () => ({ data: [], error: null }))
    expect((await request(app).post('/api/auth/login').send({ email: 'aud@example.test', password: 'legacy-sha' })).status).toBe(200)
  })

  it('answers 401 for an email with no account', async () => {
    onRpc('verify_user_login', () => ({ data: [], error: null }))
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'x' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Incorrect email or password.')
  })

  it('answers 400 for a body that is not valid JSON', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Request body is not valid JSON.')
  })
})

describe('authentication on the core routes', () => {
  const routes: [string, string][] = [
    ['get', '/api/users'],
    ['get', '/api/projects'],
    ['get', `/api/projects/${id(21)}`],
    ['post', '/api/projects'],
    ['get', '/api/guidelines'],
    ['get', '/api/reports'],
    ['post', '/api/generator/process-chunk'],
  ]

  it.each(routes)('%s %s answers 401 without a token', async (method, path) => {
    const res = await (request(app) as any)[method](path)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Authentication required')
  })

  it('answers 401 for a token signed with another secret, an expired token and a non-Bearer header', async () => {
    const foreign = jwt.sign({ userId: U.admin, userName: 'x', role: 'admin' }, 'another-secret-that-is-at-least-32-chars!!')
    const expired = jwt.sign({ userId: U.admin, userName: 'x', role: 'admin' }, TEST_SECRET, { expiresIn: -10 })
    for (const header of [`Bearer ${foreign}`, `Bearer ${expired}`, 'Basic abc', 'Bearer not-a-token']) {
      expect((await request(app).get('/api/users').set('Authorization', header)).status).toBe(401)
    }
  })
})

describe('CORS', () => {
  it('lets the configured origin in and refuses another with 403', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')
    expect(ok.status).toBe(200)
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    const bad = await request(app).get('/api/health').set('Origin', 'https://evil.example')
    expect(bad.status).toBe(403)
    expect(bad.body.error).toBe('Not allowed by CORS')
  })
})

describe('the evidence routes without a service-role key', () => {
  it('answer 503 instead of reaching a database', async () => {
    const res = await request(app).get(`/api/projects/${id(21)}/evidence-runs/latest`).set('Authorization', bearer(U.head, 'head_auditor'))
    expect(res.status).toBe(503)
  })
})

describe('GET /api/users', () => {
  it('shows emails to an admin only', async () => {
    const asAdmin = await request(app).get('/api/users').set('Authorization', bearer(U.admin, 'admin'))
    expect(asAdmin.status).toBe(200)
    expect(asAdmin.body).toHaveLength(6)
    expect(asAdmin.body[0].userEmail).toBeDefined()

    const asAuditor = await request(app).get('/api/users').set('Authorization', bearer(U.aud, 'auditor'))
    expect(asAuditor.status).toBe(200)
    expect(asAuditor.body).toHaveLength(6)
    expect(asAuditor.body.every((u: any) => u.userEmail === undefined && u.userName)).toBe(true)
  })

  it('answers 500 with a generic message when the database fails', async () => {
    failNext('User', 'select', { code: 'XX000', details: 'secret detail', message: 'internal' })
    const res = await request(app).get('/api/users').set('Authorization', bearer(U.admin, 'admin'))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Something went wrong while saving. Please try again.')
    expect(JSON.stringify(res.body)).not.toContain('secret detail')
  })
})

describe('POST /api/users', () => {
  const newId = id(99)
  const valid = { userId: newId, userName: 'New Person', userEmail: '  New@Example.TEST ', role: 'auditor', userPassword: 'pw-123456' }

  it('answers 400 for missing fields, a non-UUID id and an unknown role', async () => {
    expect((await request(app).post('/api/users').send({ ...valid, userPassword: undefined })).status).toBe(400)
    const badId = await request(app).post('/api/users').send({ ...valid, userId: 'abc' })
    expect(badId.status).toBe(400)
    expect(badId.body.error).toBe('userId must be a UUID.')
    const badRole = await request(app).post('/api/users').send({ ...valid, role: 'root' })
    expect(badRole.status).toBe(400)
    expect(tables.User).toHaveLength(6)
  })

  it('registers an auditor without a token and answers a token for them', async () => {
    const res = await request(app).post('/api/users').send(valid)
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(jwt.verify(res.body.token, TEST_SECRET)).toMatchObject({ userId: newId, role: 'auditor' })
    expect(tables.User.find((u) => u.userId === newId)?.userEmail).toBe('new@example.test')
  })

  it('stores a salted bcrypt hash of the password, not the value sent (NFR-05)', async () => {
    expect((await request(app).post('/api/users').send(valid)).status).toBe(201)
    const stored = tables.User.find((u) => u.userId === newId)?.userPassword as string
    expect(stored).not.toBe(valid.userPassword)
    expect(isPasswordHash(stored)).toBe(true)
    expect(await verifyPassword(valid.userPassword, stored)).toBe(true)
  })

  it('refuses a self-registered admin with 403, and lets an admin create one', async () => {
    const self = await request(app).post('/api/users').send({ ...valid, role: 'admin' })
    expect(self.status).toBe(403)
    const asAuditor = await request(app).post('/api/users').set('Authorization', bearer(U.aud, 'auditor')).send({ ...valid, role: 'admin' })
    expect(asAuditor.status).toBe(403)
    expect(tables.User).toHaveLength(6)

    const asAdmin = await request(app).post('/api/users').set('Authorization', bearer(U.admin, 'admin')).send({ ...valid, role: 'admin' })
    expect(asAdmin.status).toBe(201)
    expect(tables.User.find((u) => u.userId === newId)?.role).toBe('admin')
  })

  it('answers 409 for a user that already exists', async () => {
    const res = await request(app).post('/api/users').send({ ...valid, userId: U.aud })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('That record already exists.')
  })
})

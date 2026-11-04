import cors from 'cors'
import express, { type Express } from 'express'
import request from 'supertest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessions } from '../auth/session.js'
import { createEvidenceModule, NOT_CONFIGURED_MESSAGE } from './index.js'

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long'
const CONFIGURED = { SESSION_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests', GROQ_API_KEY: 'gsk_test' }
const fakeAdmin = () => ({}) as SupabaseClient

/** Wired in the same order as server.ts: cors, the module under /api, then the global parser, then the old routes. */
function makeApp(env: Record<string, string | undefined>, requestsPerMinute?: number): Express {
  const app = express()
  app.use(cors())
  const evidence = createEvidenceModule(env, { admin: fakeAdmin, requestsPerMinute })
  app.use('/api', ...evidence.routers)
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ limit: '50mb', extended: true }))
  app.get('/api/projects/:id', (req, res) => {
    res.json({ old: true, id: req.params.id })
  })
  app.post('/api/projects/:projectId/results/:itemId/evidence', (req, res) => {
    res.json({ bytes: JSON.stringify(req.body).length, keys: Object.keys(req.body) })
  })
  app.post('/api/echo', (req, res) => {
    res.json({ got: req.body })
  })
  return app
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe.each([
  ['configured', CONFIGURED],
  ['unconfigured', {}],
])('the old routes, with the module %s', (_name, env) => {
  it('reaches an old GET with no token', async () => {
    const res = await request(makeApp(env)).get('/api/projects/abc')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ old: true, id: 'abc' })
  })

  it('takes a 1 MB body on an old POST, parsed by the global parser', async () => {
    const data = 'x'.repeat(1024 * 1024)
    const res = await request(makeApp(env)).post('/api/projects/p-1/results/i-1/evidence').send({ data })
    expect(res.status).toBe(200)
    expect(res.body.keys).toEqual(['data'])
    expect(res.body.bytes).toBeGreaterThan(1024 * 1024)
  })

  it('takes a 5 MB body on an old POST, far past the small limit of the evidence routes', async () => {
    const data = 'y'.repeat(5 * 1024 * 1024)
    const res = await request(makeApp(env)).post('/api/projects/p-1/results/i-1/evidence').send({ data })
    expect(res.status).toBe(200)
  })

  it('takes a urlencoded body on an old POST', async () => {
    const res = await request(makeApp(env)).post('/api/echo').type('form').send({ a: '1' })
    expect(res.body).toEqual({ got: { a: '1' } })
  })

  it('counts no old request toward any limiter, even with a valid token', async () => {
    const app = makeApp(env, 2)
    const token = createSessions(SECRET).sign({ userId: 'u-1', role: 'auditor' })
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).get('/api/projects/abc').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    }
  })

  it('still lets the global parser reject bad JSON on an old route as it always did', async () => {
    const res = await request(makeApp(env)).post('/api/echo').set('Content-Type', 'application/json').send('{"a":')
    expect(res.status).toBe(400)
  })
})

describe('configured', () => {
  it('answers bad JSON to an evidence route with a JSON error, not an HTML stack', async () => {
    const token = createSessions(SECRET).sign({ userId: 'u-1', role: 'auditor' })
    const res = await request(makeApp(CONFIGURED))
      .post('/api/projects/p-1/evidence-sources')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"startUrls": [')
    expect(res.status).toBe(400)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.body).toEqual({ error: 'Invalid request' })
  })

  it('answers bad JSON to the login route with JSON as well', async () => {
    const res = await request(makeApp(CONFIGURED)).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":')
    expect(res.status).toBe(400)
    expect(res.headers['content-type']).toMatch(/json/)
  })

  it('requires a token on the evidence routes and mounts login', async () => {
    const app = makeApp(CONFIGURED)
    expect((await request(app).get('/api/projects/p-1/suggestions')).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400)
  })
})

describe('unconfigured', () => {
  it.each([
    ['post', '/api/auth/login'],
    ['get', '/api/projects/p-1/suggestions'],
    ['get', '/api/projects/p-1/evidence-sources'],
    ['post', '/api/projects/p-1/evidence-sources'],
    ['put', '/api/projects/p-1/evidence-permission'],
    ['post', '/api/projects/p-1/evidence-runs'],
    ['get', '/api/projects/p-1/evidence-runs/latest'],
    ['post', '/api/projects/p-1/evidence-runs/r-1/reassess'],
    ['post', '/api/suggestions/s-1/decision'],
    ['get', '/api/evidence/screenshots/page/x-1'],
    ['get', '/api/evidence/screenshots/quote/x-1'],
  ] as const)('%s %s answers 503', async (method, path) => {
    const res = await request(makeApp({}))[method](path)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: NOT_CONFIGURED_MESSAGE })
  })

  it('answers only evidence paths: an unknown path is still 404', async () => {
    const res = await request(makeApp({})).get('/api/projects/p-1/other')
    expect(res.status).toBe(404)
  })
})

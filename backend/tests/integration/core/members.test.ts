import { EventEmitter } from 'events'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables, tables } from '../../helpers/fakeSupabase.js'
import { coreWorld, id, LOCKED, P, U } from '../../fixtures/coreWorld.js'
import { loadCoreServer, quietConsole } from '../../helpers/coreServer.js'

vi.mock('dotenv/config', () => ({}))
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }))
vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

// The Brevo assignment email goes out with https.request: capture it here instead of sending it.
const sent = vi.hoisted(() => [] as { options: any; body: string }[])
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>()
  const fakeRequest = (options: any, onResponse: (res: any) => void) => {
    const req = new EventEmitter() as any
    let body = ''
    req.write = (chunk: string) => { body += chunk }
    req.end = () => {
      sent.push({ options, body })
      const res = new EventEmitter() as any
      res.statusCode = 201
      onResponse(res)
      res.emit('data', '{}')
      res.emit('end')
    }
    return req
  }
  return { ...actual, default: { ...(actual as any).default, request: fakeRequest }, request: fakeRequest }
})

const { app, bearer } = await loadCoreServer()

const as = {
  head: bearer(U.head, 'head_auditor'),
  headOther: bearer(U.headOther, 'head_auditor'),
  aud: bearer(U.aud, 'auditor'),
}

/** The email is sent in the background after the answer: wait for it to settle. */
const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  resetTables(coreWorld())
  sent.length = 0
  process.env.BREVO_API_KEY = 'test-brevo-key'
  process.env.BREVO_SENDER_EMAIL = 'audit@example.test'
  quietConsole()
})
afterEach(() => {
  delete process.env.BREVO_API_KEY
  delete process.env.BREVO_SENDER_EMAIL
  vi.restoreAllMocks()
})

const memberIds = (projectId: string) => tables.Project_Member.filter((m) => m.projectId === projectId).map((m) => m.userId).sort()

describe('POST /api/projects/:id/members', () => {
  it('replaces the members and emails only the newly added auditor', async () => {
    const res = await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.head).send({ userIds: [U.aud, U.outsider] })
    expect(res.status).toBe(200)
    expect(memberIds(P)).toEqual([U.aud, U.outsider].sort())
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0].options).toMatchObject({ hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST' })
    expect(sent[0].options.headers['api-key']).toBe('test-brevo-key')
    const email = JSON.parse(sent[0].body)
    expect(email.to).toEqual([{ email: 'out@example.test', name: 'Out Sider' }])
    expect(email.subject).toBe('New Project Assignment: TikTok 2026')
    expect(email.htmlContent).toContain('Hana Head')
  })

  it('does not email a head auditor who is added as a member', async () => {
    const res = await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.head).send({ userIds: [U.aud, U.aud2, U.headOther] })
    expect(res.status).toBe(200)
    await settle()
    expect(sent).toHaveLength(0)
  })

  it('answers 400 for a bad body', async () => {
    expect((await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.head).send({ userIds: 'x' })).status).toBe(400)
    expect((await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.head).send({ userIds: [1] })).status).toBe(400)
  })

  it('answers 500 naming an unknown user, and changes nothing', async () => {
    const res = await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.head).send({ userIds: [id(777)] })
    expect(res.status).toBe(500)
    expect(res.body.error).toContain(id(777))
    expect(memberIds(P)).toEqual([U.aud, U.aud2].sort())
  })

  it('answers 403 to another head auditor, to an auditor and while the audit is locked', async () => {
    expect((await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.headOther).send({ userIds: [] })).status).toBe(403)
    expect((await request(app).post(`/api/projects/${P}/members`).set('Authorization', as.aud).send({ userIds: [] })).status).toBe(403)
    const locked = await request(app).post(`/api/projects/${LOCKED}/members`).set('Authorization', as.head).send({ userIds: [] })
    expect(locked.status).toBe(403)
    expect(memberIds(LOCKED)).toEqual([U.aud])
  })
})

describe('POST /api/projects/:id/members/add', () => {
  it('adds one member and emails them', async () => {
    const res = await request(app).post(`/api/projects/${P}/members/add`).set('Authorization', as.head).send({ userId: U.outsider })
    expect(res.status).toBe(200)
    expect(memberIds(P)).toContain(U.outsider)
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('treats an existing member as already added', async () => {
    const res = await request(app).post(`/api/projects/${P}/members/add`).set('Authorization', as.head).send({ userId: U.aud })
    expect(res.status).toBe(200)
    expect(memberIds(P)).toEqual([U.aud, U.aud2].sort())
  })

  it('skips the email when Brevo is not configured', async () => {
    delete process.env.BREVO_API_KEY
    const res = await request(app).post(`/api/projects/${P}/members/add`).set('Authorization', as.head).send({ userId: U.outsider })
    expect(res.status).toBe(200)
    await settle()
    expect(sent).toHaveLength(0)
  })

  it('answers 400 without a userId and 403 for another head auditor', async () => {
    expect((await request(app).post(`/api/projects/${P}/members/add`).set('Authorization', as.head).send({})).status).toBe(400)
    expect((await request(app).post(`/api/projects/${P}/members/add`).set('Authorization', as.headOther).send({ userId: U.outsider })).status).toBe(403)
  })
})

describe('DELETE /api/projects/:id/members/:userId', () => {
  it('removes the member', async () => {
    const res = await request(app).delete(`/api/projects/${P}/members/${U.aud2}`).set('Authorization', as.head)
    expect(res.status).toBe(200)
    expect(memberIds(P)).toEqual([U.aud])
  })

  it('answers 403 to an auditor', async () => {
    expect((await request(app).delete(`/api/projects/${P}/members/${U.aud2}`).set('Authorization', as.aud)).status).toBe(403)
    expect(memberIds(P)).toHaveLength(2)
  })
})

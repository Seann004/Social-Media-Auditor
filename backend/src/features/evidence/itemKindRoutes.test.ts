import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessions } from '../auth/session.js'
import { createItemKindRouter, type ItemKindRouterDeps } from './itemKindRoutes.js'
import type { ClassifyResult, ItemKindAnswer, KindItem } from './itemKinds.js'
import { P1, P2, SECRET, USERS, makeAudit, type TestUser } from './routesTestKit.js'

const AI_NOT_CONFIGURED = 'AI assessment is not configured on this server: GROQ_API_KEY is missing.'

const answer = (kind: ItemKindAnswer['kind'], confidence: ItemKindAnswer['confidence'], reason = 'Because.'): ItemKindAnswer => ({ kind, reason, confidence })
const result = (answers: [string, ItemKindAnswer][]): ClassifyResult => ({ answers: new Map(answers), tokens: 10, failedCalls: 0, stoppedByCap: false })

function setup(over: Partial<ItemKindRouterDeps> = {}) {
  const sessions = createSessions(SECRET)
  const classify = vi.fn(async (_items: KindItem[]) => result([['item-1', answer('app', 'high', 'A setting a user can see.')], ['item-2', answer('both', 'low')]]))
  const deps: ItemKindRouterDeps = { audit: makeAudit(), sessions, aiConfigured: true, apiKey: 'gsk_test', model: 'model-a', classify, ...over }
  const app = express()
  app.use('/api', createItemKindRouter(deps))
  const auth = (user: TestUser) => ({ Authorization: `Bearer ${sessions.sign(user)}` })
  return { app, classify: deps.classify as typeof classify, auth }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/projects/:id/item-kinds', () => {
  it('gives the high-confidence kinds of the checklist, by item id', async () => {
    const { app, classify, auth } = setup()
    const res = await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kinds: { 'item-1': { kind: 'app', reason: 'A setting a user can see.' } } })
    expect(classify).toHaveBeenCalledTimes(1)
    const [items, opts] = classify.mock.calls[0] as unknown as [KindItem[], { apiKey: string; model: string }]
    expect(items).toEqual([
      { id: 'item-1', text: 'Is it private?', name: 'Item 1', category: 'Privacy', helpText: '' },
      { id: 'item-2', text: 'Is it safe?', name: 'Item 2', category: 'Privacy', helpText: '' },
    ])
    expect(opts).toMatchObject({ apiKey: 'gsk_test', model: 'model-a' })
  })

  it('lets the Head Auditor of the project ask too', async () => {
    const { app, auth } = setup()
    expect((await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.head))).status).toBe(200)
  })

  it('needs a token', async () => {
    const { app, classify } = setup()
    expect((await request(app).post(`/api/projects/${P1}/item-kinds`)).status).toBe(401)
    expect(classify).not.toHaveBeenCalled()
  })

  it.each([
    ['an auditor of another project', USERS.auditorP2],
    ['a Head Auditor of another project', USERS.headP2],
    ['an admin', USERS.admin],
    ['a stranger', USERS.stranger],
  ])('refuses %s', async (_name, user) => {
    const { app, classify, auth } = setup()
    const res = await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(user))
    expect(res.status).toBe(403)
    expect(classify).not.toHaveBeenCalled()
  })

  it('answers 503 when the AI is not configured, as the run routes do', async () => {
    const { app, classify, auth } = setup({ aiConfigured: false })
    const res = await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.auditor))
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: AI_NOT_CONFIGURED })
    expect(classify).not.toHaveBeenCalled()
  })

  it('answers no kinds when the AI gave none, so the screen shows no hint', async () => {
    const { app, auth } = setup({ classify: vi.fn(async () => ({ answers: new Map(), tokens: 0, failedCalls: 1, stoppedByCap: false })) })
    const res = await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.auditor))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kinds: {} })
  })

  it('refuses an id with an unexpected shape', async () => {
    const { app, auth } = setup()
    expect((await request(app).post('/api/projects/p_1!/item-kinds').set(auth(USERS.auditor))).status).toBe(400)
  })

  it('has the same per-user rate limit as the other evidence routes', async () => {
    const { app, auth } = setup({ requestsPerMinute: 1 })
    expect((await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.auditor))).status).toBe(200)
    expect((await request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.auditor))).status).toBe(429)
  })

  it('sorts one project at a time, so a second request waits and can use the first one\'s answers', async () => {
    let active = 0
    let most = 0
    const classify = vi.fn(async () => {
      active += 1
      most = Math.max(most, active)
      await new Promise((r) => setTimeout(r, 20))
      active -= 1
      return result([])
    })
    const { app, auth } = setup({ classify })
    await Promise.all([
      request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.auditor)),
      request(app).post(`/api/projects/${P1}/item-kinds`).set(auth(USERS.head)),
    ])
    expect(classify).toHaveBeenCalledTimes(2)
    expect(most).toBe(1)
  })

  it('keeps the projects apart', async () => {
    const { app, auth } = setup()
    expect((await request(app).post(`/api/projects/${P2}/item-kinds`).set(auth(USERS.auditor))).status).toBe(403)
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'
import express from 'express'
import request from 'supertest'
import { createSessions } from '../auth/session.js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createEvidenceModule, NOT_CONFIGURED_MESSAGE } from './index.js'
import { createMemoryRepository } from './memoryRepository.js'
import { makeAudit } from './routesTestKit.js'

const CONFIGURED = { SESSION_SECRET: 'a-test-secret-that-is-at-least-32-chars-long', SUPABASE_SERVICE_ROLE_KEY: 'k', GROQ_API_KEY: 'gsk_x' }
const admin = () => ({}) as SupabaseClient

let errors: MockInstance
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

function moduleWith(repo = createMemoryRepository(), env: Record<string, string | undefined> = CONFIGURED) {
  return createEvidenceModule(env, { admin, repo, screenshots: repo, audit: makeAudit() })
}

describe('createEvidenceModule', () => {
  it.each([
    ['SESSION_SECRET', { SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['SUPABASE_SERVICE_ROLE_KEY', { SESSION_SECRET: CONFIGURED.SESSION_SECRET }],
    ['both', {}],
  ])('logs one startup error and returns one router when %s is missing', (_name, env) => {
    const m = createEvidenceModule(env, { admin })
    expect(m.routers).toHaveLength(1)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0][0])).toContain(NOT_CONFIGURED_MESSAGE)
  })

  it('is off when the service client cannot be built', () => {
    const m = createEvidenceModule(CONFIGURED, { admin: () => null })
    expect(m.routers).toHaveLength(1)
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('the unconfigured module starts and cleans up without doing anything', async () => {
    const m = createEvidenceModule({}, { admin })
    await expect(m.start()).resolves.toBeUndefined()
    await expect(m.removeProjectScreenshots('p-1')).resolves.toBeUndefined()
  })

  it('throws for a secret that is set but too short', () => {
    expect(() => createEvidenceModule({ ...CONFIGURED, SESSION_SECRET: 'short' }, { admin })).toThrow(/at least 32/)
  })

  it('returns the login router and the evidence router when configured', () => {
    expect(moduleWith().routers).toHaveLength(2)
    expect(errors).not.toHaveBeenCalled()
  })

  it('warns once, and still starts, without a Groq key', () => {
    const m = moduleWith(undefined, { ...CONFIGURED, GROQ_API_KEY: undefined })
    expect(m.routers).toHaveLength(2)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0][0])).toContain('GROQ_API_KEY')
  })

  it('start fails the runs a restart left in progress', async () => {
    const repo = createMemoryRepository()
    const run = await repo.createRun({ projectId: 'p-1', startedBy: null, scope: 'all' })
    await moduleWith(repo).start()
    expect((await repo.getRun(run.id))?.status).toBe('failed')
  })

  it('start logs and does not throw when the database is down', async () => {
    const repo = createMemoryRepository()
    vi.spyOn(repo, 'markInterruptedRuns').mockRejectedValue(new Error('connect ETIMEDOUT'))
    await expect(moduleWith(repo).start()).resolves.toBeUndefined()
    expect(String(errors.mock.calls[0][1])).toContain('ETIMEDOUT')
  })

  it('removeProjectScreenshots removes the project folder', async () => {
    const repo = createMemoryRepository()
    const remove = vi.spyOn(repo, 'removeProject')
    await moduleWith(repo).removeProjectScreenshots('p-1')
    expect(remove).toHaveBeenCalledWith('p-1')
  })

  it('removeProjectScreenshots logs and does not throw when storage fails', async () => {
    const repo = createMemoryRepository()
    vi.spyOn(repo, 'removeProject').mockRejectedValue(new Error('storage down'))
    await expect(moduleWith(repo).removeProjectScreenshots('p-1')).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalled()
  })

  it.each(['', '../other', 'a/b', 'a'.repeat(65)])('removeProjectScreenshots refuses the odd id %j', async (id) => {
    const repo = createMemoryRepository()
    const remove = vi.spyOn(repo, 'removeProject')
    await moduleWith(repo).removeProjectScreenshots(id)
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('how the module is wired', () => {
  const sessions = createSessions(CONFIGURED.SESSION_SECRET)
  const head = { Authorization: `Bearer ${sessions.sign({ userId: 'u-aud', role: 'auditor' })}` }

  function build(env: Record<string, string | undefined>, runJob = vi.fn(async () => undefined)) {
    const repo = createMemoryRepository()
    const m = createEvidenceModule(env, { admin, repo, screenshots: repo, audit: makeAudit(), runJob })
    const app = express()
    app.use('/api', ...m.routers)
    return { app, repo, runJob }
  }

  it('starts a run on the queue with the key, the model and a guard built from the allow-list', async () => {
    const env = { ...CONFIGURED, GROQ_MODEL: 'my-model', EVIDENCE_ALLOWED_PRIVATE_HOSTS: ' localhost:8080 , other.test:9 ' }
    const { app, repo, runJob } = build(env)
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    const res = await request(app).post('/api/projects/p-1/evidence-runs').set(head)
    expect(res.status).toBe(202)
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1))
    const [runId, deps] = runJob.mock.calls[0] as unknown as [string, { apiKey: string; model: string; guard: { check(u: string): Promise<{ allowed: boolean }> } }]
    expect(runId).toBe(res.body.run.id)
    expect(deps.apiKey).toBe('gsk_x')
    expect(deps.model).toBe('my-model')
    expect((await deps.guard.check('http://localhost:8080/')).allowed).toBe(true)
    expect((await deps.guard.check('http://localhost:9999/')).allowed).toBe(false)
  })

  it('uses the same default model as the older Groq routes', async () => {
    const { app, repo, runJob } = build(CONFIGURED)
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    await request(app).post('/api/projects/p-1/evidence-runs').set(head)
    await vi.waitFor(() => expect(runJob).toHaveBeenCalled())
    expect((runJob.mock.calls[0] as unknown as [string, { model: string }])[1].model).toBe('llama-3.3-70b-versatile')
  })

  it('answers 503 and runs nothing when GROQ_API_KEY is missing', async () => {
    const { app, repo, runJob } = build({ ...CONFIGURED, GROQ_API_KEY: undefined })
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    const res = await request(app).post('/api/projects/p-1/evidence-runs').set(head)
    expect(res.status).toBe(503)
    expect(runJob).not.toHaveBeenCalled()
  })

  it('checks start addresses against the allow-list from the environment, and only that', async () => {
    const body = { startUrls: ['http://localhost:8080/'] }
    const closed = build(CONFIGURED)
    expect((await request(closed.app).post('/api/projects/p-1/evidence-sources').set(head).send(body)).status).toBe(400)
    const open = build({ ...CONFIGURED, EVIDENCE_ALLOWED_PRIVATE_HOSTS: 'localhost:8080' })
    expect((await request(open.app).post('/api/projects/p-1/evidence-sources').set(head).send(body)).status).toBe(200)
  })

  it('throws for a short secret even when the service key is also missing', () => {
    expect(() => createEvidenceModule({ SESSION_SECRET: 'short' }, { admin })).toThrow(/at least 32/)
  })
})

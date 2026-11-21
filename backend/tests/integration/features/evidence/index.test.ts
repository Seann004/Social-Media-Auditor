import type { SupabaseClient } from '@supabase/supabase-js'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createSessions } from '../../../../src/features/auth/session.js'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createEvidenceModule, NOT_CONFIGURED_MESSAGE } from '../../../../src/features/evidence/index.js'
import { createMemoryAppRepository } from '../../../../src/features/evidence/memoryAppRepository.js'
import { createMemoryRepoRepository } from '../../../../src/features/evidence/memoryRepoRepository.js'
import { createMemoryRepository } from '../../../../src/features/evidence/memoryRepository.js'
import { makeAudit } from '../../../../src/features/evidence/routesTestKit.js'

const SECRET_KEY = Buffer.alloc(32, 5)
const CONFIGURED = {
  JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  GROQ_API_KEY: 'gsk_x',
  EVIDENCE_SECRET_KEY: SECRET_KEY.toString('base64'),
}
const KEY_MISSING_LINE = '[evidence] EVIDENCE_SECRET_KEY is not set: test accounts and app runs are unavailable.'
const admin = () => ({}) as SupabaseClient

let errors: MockInstance
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

function moduleWith(repo = createMemoryRepository(), env: Record<string, string | undefined> = CONFIGURED) {
  return createEvidenceModule(env, { admin, repo, screenshots: repo, audit: makeAudit(), appRepo: createMemoryAppRepository() })
}

describe('createEvidenceModule', () => {
  it('logs one startup error and returns one router when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    const m = createEvidenceModule({ JWT_SECRET: CONFIGURED.JWT_SECRET }, { admin })
    expect(m.routers).toHaveLength(1)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0][0])).toContain(NOT_CONFIGURED_MESSAGE)
  })

  it.each([
    ['missing', { SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['empty', { SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: '' }],
    ['short', { SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'short' }],
    ['31 characters', { SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'x'.repeat(31) }],
    ['missing, with no service key either', {}],
  ])('turns evidence off without throwing, naming JWT_SECRET, when JWT_SECRET is %s', (_name, env) => {
    let m: ReturnType<typeof createEvidenceModule> | null = null
    expect(() => {
      m = createEvidenceModule(env, { admin })
    }).not.toThrow()
    expect(m!.routers).toHaveLength(1)
    const lines = errors.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('JWT_SECRET'))).toBe(true)
    expect(lines.some((l) => l.includes(NOT_CONFIGURED_MESSAGE))).toBe(true)
  })

  it('a short JWT_SECRET leaves the evidence routes answering 503, and never mounts a login route', async () => {
    const m = createEvidenceModule({ ...CONFIGURED, JWT_SECRET: 'short' }, { admin })
    const app = express()
    app.use('/api', ...m.routers)
    const res = await request(app).get('/api/projects/p-1/ai-suggestions')
    expect(res.status).toBe(503)
    expect(res.body.error).toBe(NOT_CONFIGURED_MESSAGE)
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(404)
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

  it('returns the evidence, app, repo and item kinds routers when configured, and no login router', async () => {
    const m = moduleWith()
    expect(m.routers).toHaveLength(4) // evidence, app, repo and item kinds
    const app = express()
    app.use('/api', ...m.routers)
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(404)
    expect(errors).not.toHaveBeenCalled()
  })

  it('warns once, and still starts, without a Groq key', () => {
    const m = moduleWith(undefined, { ...CONFIGURED, GROQ_API_KEY: undefined })
    expect(m.routers).toHaveLength(4) // evidence, app, repo and item kinds
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0][0])).toContain('GROQ_API_KEY')
  })

  it('logs one startup line, and still starts, without EVIDENCE_SECRET_KEY', () => {
    const m = moduleWith(undefined, { ...CONFIGURED, EVIDENCE_SECRET_KEY: undefined })
    expect(m.routers).toHaveLength(4) // evidence, app, repo and item kinds
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0]).toEqual([KEY_MISSING_LINE])
  })

  it.each(['not base64!', Buffer.alloc(16, 1).toString('base64')])('a malformed EVIDENCE_SECRET_KEY throws at module creation (%j)', (key) => {
    expect(() => moduleWith(undefined, { ...CONFIGURED, EVIDENCE_SECRET_KEY: key })).toThrow(/EVIDENCE_SECRET_KEY must be 32 random bytes/)
    // A mistake to fix whatever else is missing, and the error names no key.
    expect(() => createEvidenceModule({ EVIDENCE_SECRET_KEY: key }, { admin })).toThrow(/EVIDENCE_SECRET_KEY/)
    let thrown: unknown = null
    try {
      moduleWith(undefined, { ...CONFIGURED, EVIDENCE_SECRET_KEY: key })
    } catch (err) {
      thrown = err
    }
    expect(String(thrown)).not.toContain(key)
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
  const sessions = createSessions(CONFIGURED.JWT_SECRET)
  const head = { Authorization: `Bearer ${sessions.sign({ userId: 'u-aud', role: 'auditor' })}` }

  function build(env: Record<string, string | undefined>, runJob = vi.fn(async () => undefined), audit = makeAudit()) {
    const repo = createMemoryRepository()
    const appRepo = createMemoryAppRepository()
    const repoRepo = createMemoryRepoRepository()
    const m = createEvidenceModule(env, { admin, repo, screenshots: repo, audit, runJob, appRepo, repoRepo })
    const app = express()
    app.use('/api', ...m.routers)
    return { app, repo, appRepo, repoRepo, runJob }
  }

  async function readyForAppRun(appRepo: ReturnType<typeof createMemoryAppRepository>): Promise<void> {
    await appRepo.saveAppSource('p-1', { appUrl: 'https://example.com/', loginDomains: [] }, null)
    await appRepo.addTestAccount({
      id: 'a-1',
      projectId: 'p-1',
      label: 'Teen 15',
      ageGroup: 'under_18',
      age: 15,
      loginName: 'teen',
      handles: [],
      passwordCiphertext: 'x',
      createdBy: null,
    })
  }

  it('starts a run on the queue with the key, the model and a guard built from the allow-list', async () => {
    const env = { ...CONFIGURED, EVIDENCE_GROQ_MODEL: 'my-model', GROQ_MODEL: 'llama-3.1-8b-instant', EVIDENCE_ALLOWED_PRIVATE_HOSTS: ' localhost:8080 , other.test:9 ' }
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

  it('passes the repo repository to every run as its code wiring', async () => {
    const { app, repo, repoRepo, runJob } = build(CONFIGURED)
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    await request(app).post('/api/projects/p-1/evidence-runs').set(head)
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1))
    const deps = (runJob.mock.calls[0] as unknown as [string, { code: { repoRepo: unknown; fetcher?: unknown } }])[1]
    expect(deps.code.repoRepo).toBe(repoRepo)
    expect(deps.code.fetcher).toBeUndefined()
  })

  it('gives the reassess route the repo repository, so a repo run with nothing unfinished is refused as such', async () => {
    const { app, repo, repoRepo } = build(CONFIGURED)
    const from = await repo.createRun({ projectId: 'p-1', startedBy: 'u-aud', scope: 'all', source: 'repo', checkedItemIds: ['item-1'] })
    await repo.updateRun(from.id, { status: 'completed', finishedAt: new Date().toISOString() })
    await repoRepo.addPieces([{ runId: from.id, itemId: 'item-1', pageId: 'pg', path: 'a.ts', startLine: 1, endLine: 2, commitSha: 'a'.repeat(40), round: 1 }])
    await repo.addSuggestion({ runId: from.id, projectId: 'p-1', itemId: 'item-1', suggestedResult: 'yes', reason: 'r', confidence: 'high', flags: [], passageIdsSent: [], source: 'repo', quotes: [] })
    const res = await request(app).post(`/api/projects/p-1/evidence-runs/${from.id}/reassess`).set(head).send({ scope: 'unfinished' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Nothing is unfinished.')
  })

  it('defaults the model to openai/gpt-oss-120b when EVIDENCE_GROQ_MODEL is unset, ignoring GROQ_MODEL', async () => {
    const { app, repo, runJob } = build({ ...CONFIGURED, GROQ_MODEL: 'llama-3.1-8b-instant' })
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    await request(app).post('/api/projects/p-1/evidence-runs').set(head)
    await vi.waitFor(() => expect(runJob).toHaveBeenCalled())
    expect((runJob.mock.calls[0] as unknown as [string, { model: string }])[1].model).toBe('openai/gpt-oss-120b')
  })

  it('starts an app run with the app repository and the secret key in the runner deps', async () => {
    const { app, appRepo, runJob } = build(CONFIGURED)
    await readyForAppRun(appRepo)
    const res = await request(app).post('/api/projects/p-1/app-runs').set(head).send({ itemIds: ['item-1'] })
    expect(res.status).toBe(202)
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1))
    const deps = (runJob.mock.calls[0] as unknown as [string, { app: { appRepo: unknown; secretKey: Buffer | null } }])[1]
    expect(deps.app.appRepo).toBe(appRepo)
    expect(deps.app.secretKey?.equals(SECRET_KEY)).toBe(true)
  })

  it('a page run and an app run share one lock across the two routers', async () => {
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let calls = 0
    const base = makeAudit()
    const audit = {
      ...base,
      async getSubmissionStatus(projectId: string) {
        calls += 1
        if (calls === 1) await gate
        return base.getSubmissionStatus(projectId)
      },
    }
    const { app, repo, appRepo } = build(CONFIGURED, vi.fn(async () => undefined), audit)
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    await readyForAppRun(appRepo)
    const first = request(app).post('/api/projects/p-1/evidence-runs').set(head).then((r) => r)
    await vi.waitFor(() => expect(calls).toBe(1))
    const second = await request(app).post('/api/projects/p-1/app-runs').set(head).send({ itemIds: ['item-1'] })
    expect(second.status).toBe(409)
    open()
    expect((await first).status).toBe(202)
  })

  it('app runs answer 503 without EVIDENCE_SECRET_KEY', async () => {
    const { app, appRepo, runJob } = build({ ...CONFIGURED, EVIDENCE_SECRET_KEY: undefined })
    await readyForAppRun(appRepo)
    const res = await request(app).post('/api/projects/p-1/app-runs').set(head).send({ itemIds: ['item-1'] })
    expect(res.status).toBe(503)
    expect(runJob).not.toHaveBeenCalled()
  })

  it('answers 503 and runs nothing when GROQ_API_KEY is missing', async () => {
    const { app, repo, runJob } = build({ ...CONFIGURED, GROQ_API_KEY: undefined })
    await repo.saveSource('p-1', ['https://example.com/'], 'u-aud')
    const res = await request(app).post('/api/projects/p-1/evidence-runs').set(head)
    expect(res.status).toBe(503)
    expect(runJob).not.toHaveBeenCalled()
  })

  it('answers 503 on the item kinds route when GROQ_API_KEY is missing', async () => {
    const { app } = build({ ...CONFIGURED, GROQ_API_KEY: undefined })
    const res = await request(app).post('/api/projects/p-1/item-kinds').set(head)
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'AI assessment is not configured on this server: GROQ_API_KEY is missing.' })
  })

  it('checks start addresses against the allow-list from the environment, and only that', async () => {
    const body = { startUrls: ['http://localhost:8080/'] }
    const closed = build(CONFIGURED)
    expect((await request(closed.app).post('/api/projects/p-1/evidence-sources').set(head).send(body)).status).toBe(400)
    const open = build({ ...CONFIGURED, EVIDENCE_ALLOWED_PRIVATE_HOSTS: 'localhost:8080' })
    expect((await request(open.app).post('/api/projects/p-1/evidence-sources').set(head).send(body)).status).toBe(200)
  })

  it('accepts a token from the app login: { userId, userName, role } signed with JWT_SECRET', async () => {
    const { app } = build(CONFIGURED)
    const token = jwt.sign({ userId: 'u-aud', userName: 'Ada', role: 'auditor' }, CONFIGURED.JWT_SECRET, { expiresIn: '12h' })
    const res = await request(app).get('/api/projects/p-1/ai-suggestions').set({ Authorization: `Bearer ${token}` })
    expect(res.status).toBe(200)
  })

  it('rejects an app-login-shaped token signed with another secret', async () => {
    const { app } = build(CONFIGURED)
    const token = jwt.sign({ userId: 'u-aud', userName: 'Ada', role: 'auditor' }, 'b'.repeat(48), { expiresIn: '12h' })
    const res = await request(app).get('/api/projects/p-1/ai-suggestions').set({ Authorization: `Bearer ${token}` })
    expect(res.status).toBe(401)
  })
})

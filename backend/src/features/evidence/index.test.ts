import type { SupabaseClient } from '@supabase/supabase-js'
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

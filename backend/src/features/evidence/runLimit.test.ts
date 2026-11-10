import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_RUNS_PER_PROJECT_PER_DAY, MAX_RUNS_PER_PROJECT_PER_DAY_CEILING, maxRunsPerProjectPerDay } from './config.js'
import { createMemoryRepository } from './memoryRepository.js'
import { createProjectLock } from './routeSupport.js'
import { startRun, type RunStartDeps } from './runStart.js'
import type { RunQueue } from './queue.js'
import { item } from './__fixtures__/runnerWorld.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('maxRunsPerProjectPerDay', () => {
  it('is 5 when EVIDENCE_MAX_RUNS_PER_DAY is not set', () => {
    expect(DEFAULT_MAX_RUNS_PER_PROJECT_PER_DAY).toBe(5)
    expect(maxRunsPerProjectPerDay({})).toBe(5)
  })

  it('uses a whole number from the environment', () => {
    expect(maxRunsPerProjectPerDay({ EVIDENCE_MAX_RUNS_PER_DAY: '20' })).toBe(20)
    expect(maxRunsPerProjectPerDay({ EVIDENCE_MAX_RUNS_PER_DAY: ' 12 ' })).toBe(12)
  })

  it.each(['', '0', '-3', '2.5', 'abc', '1e3', '0x10'])('falls back to 5 for the unusable value %j', (value) => {
    expect(maxRunsPerProjectPerDay({ EVIDENCE_MAX_RUNS_PER_DAY: value })).toBe(5)
  })

  it('never goes above the ceiling, so a typo cannot remove the cost protection', () => {
    expect(maxRunsPerProjectPerDay({ EVIDENCE_MAX_RUNS_PER_DAY: '1000000' })).toBe(MAX_RUNS_PER_PROJECT_PER_DAY_CEILING)
  })
})

describe('the daily cap on starting runs', () => {
  const PROJECT = 'project-1'

  async function startUntilRefused(): Promise<{ started: number; refusal: string | null }> {
    const repo = createMemoryRepository()
    await repo.saveSource(PROJECT, ['https://p.test/'], 'u1')
    const queue: RunQueue = { enqueue: () => undefined, idle: async () => undefined }
    const deps: RunStartDeps = {
      repo,
      audit: { getSubmissionStatus: async () => 'not_submitted', listChecklistItems: async () => [item('i1', 'Privacy', 'Are teen accounts private by default?')] },
      queue,
      acquire: createProjectLock(),
    }
    let started = 0
    for (let i = 0; i < 60; i += 1) {
      const outcome = await startRun(deps, PROJECT, 'u1')
      if (!outcome.ok) return { started, refusal: outcome.error }
      started += 1
      await repo.updateRun(outcome.run.id, { status: 'completed' })
    }
    return { started, refusal: null }
  }

  it('refuses after 5 runs by default', async () => {
    const result = await startUntilRefused()
    expect(result.started).toBe(5)
    expect(result.refusal).toBe('This project has used its 5 runs for today. Try again tomorrow.')
  })

  it('refuses after the number set in EVIDENCE_MAX_RUNS_PER_DAY, and says that number', async () => {
    vi.stubEnv('EVIDENCE_MAX_RUNS_PER_DAY', '8')
    const result = await startUntilRefused()
    expect(result.started).toBe(8)
    expect(result.refusal).toBe('This project has used its 8 runs for today. Try again tomorrow.')
  })
})

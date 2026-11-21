import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld, PROJECT } from '../../../fixtures/runnerWorld.js'
import { createMemoryRepository } from '../../../../src/features/evidence/memoryRepository.js'
import { runEvidenceJob } from '../../../../src/features/evidence/runner.js'
import type { RunStatus } from '../../../../src/features/evidence/types.js'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('a job only runs a run that is still waiting', () => {
  it.each(['failed', 'capturing', 'assessing', 'completed', 'partial'] as RunStatus[])(
    'leaves a %s run as it was and does no work',
    async (status) => {
      const repo = createMemoryRepository()
      const world = await createWorld({ repo })
      const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
      const before = await repo.updateRun(created.id, { status, error: status === 'failed' ? 'lost' : null })

      await runEvidenceJob(created.id, world.deps)

      expect(await repo.getRun(created.id)).toEqual(before)
      expect(world.calls.capture).toHaveLength(0)
      expect(world.calls.browsers).toBe(0)
    },
  )

  it('still runs a queued run to the end', async () => {
    const world = await createWorld()
    const run = await world.run()
    expect(run.status).toBe('completed')
    expect(world.calls.capture).toHaveLength(1)
  })

  it('does not run a run twice when it is queued twice', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo })
    const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    await runEvidenceJob(created.id, world.deps)
    await runEvidenceJob(created.id, world.deps)
    expect(world.calls.capture).toHaveLength(1)
  })
})

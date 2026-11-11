import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorld, item, okPage, page, PROJECT, THREE_CATEGORIES } from './__fixtures__/runnerWorld.js'
import { RUN_UPDATE_RETRY_DELAYS_MS } from './config.js'
import { createMemoryRepository } from './memoryRepository.js'
import { runEvidenceJob } from './runner.js'

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
})
afterEach(() => vi.restoreAllMocks())

/** Fails the first `times` updates whose patch matches. */
function failUpdates(repo: ReturnType<typeof createMemoryRepository>, matches: (patch: Record<string, unknown>) => boolean, times: number) {
  const update = repo.updateRun.bind(repo)
  const seen = { attempts: 0 }
  repo.updateRun = async (id, patch) => {
    if (matches(patch as Record<string, unknown>)) {
      seen.attempts += 1
      if (seen.attempts <= times) throw new Error('network')
    }
    return update(id, patch)
  }
  return seen
}

describe('a run is never left in a working status', () => {
  it('waits about a minute in all before it gives up on an update', () => {
    const total = RUN_UPDATE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(45_000)
    expect(total).toBeLessThanOrEqual(90_000)
  })

  it('retries the final update until it lands', async () => {
    const repo = createMemoryRepository()
    const seen = failUpdates(repo, (p) => p.finishedAt !== undefined, 3)
    const world = await createWorld({ repo })

    const run = await world.run()

    expect(run.status).toBe('completed')
    expect(seen.attempts).toBe(4)
  })

  it('gives up after the last delay without throwing, and says so in the log', async () => {
    const repo = createMemoryRepository()
    const seen = failUpdates(repo, (p) => p.finishedAt !== undefined, 99)
    const world = await createWorld({ repo })
    const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })

    await expect(runEvidenceJob(created.id, world.deps)).resolves.toBeUndefined()

    expect(seen.attempts).toBe(4)
    expect(logged.join('\n')).toMatch(/could not .*run/i)
  })

  it('retries the update that marks a run failed, and sets finishedAt', async () => {
    const repo = createMemoryRepository()
    const seen = failUpdates(repo, (p) => p.status === 'failed', 2)
    const world = await createWorld({ repo, pages: [] })

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.finishedAt).not.toBeNull()
    expect(seen.attempts).toBe(3)
    expect(await repo.activeRun(PROJECT)).toBeNull()
  })

  it('retries a failed first read of the run', async () => {
    const repo = createMemoryRepository()
    const get = repo.getRun.bind(repo)
    let reads = 0
    repo.getRun = async (id) => {
      reads += 1
      if (reads <= 2) throw new Error('network')
      return get(id)
    }
    const world = await createWorld({ repo })

    const run = await world.run()

    expect(run.status).toBe('completed')
  })

  it('marks the run failed when it can never be read but can be written', async () => {
    const repo = createMemoryRepository()
    const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    const get = repo.getRun.bind(repo)
    let broken = true
    repo.getRun = async (id) => {
      if (broken) throw new Error('network')
      return get(id)
    }
    const world = await createWorld({ repo })

    await expect(runEvidenceJob(created.id, world.deps)).resolves.toBeUndefined()
    broken = false

    const run = await repo.getRun(created.id)
    expect(run?.status).toBe('failed')
    expect(run?.error).toMatch(/could not be started/i)
    expect(run?.finishedAt).not.toBeNull()
  })

  it('ends quietly, with nothing in the log, when the run vanishes while an update is retried', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo })
    const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    const get = repo.getRun.bind(repo)
    const update = repo.updateRun.bind(repo)
    let gone = false
    repo.getRun = async (id) => (gone ? null : get(id))
    repo.updateRun = async (id, patch) => {
      if (patch.finishedAt !== undefined) {
        gone = true
        throw new Error('violates foreign key')
      }
      return update(id, patch)
    }

    await expect(runEvidenceJob(created.id, world.deps)).resolves.toBeUndefined()

    expect(logged).toEqual([])
  })
})

describe('a run whose project was deleted while pages were stored', () => {
  it('ends quietly, with nothing in the log', async () => {
    const repo = createMemoryRepository()
    const world = await createWorld({ repo })
    const created = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    const get = repo.getRun.bind(repo)
    let gone = false
    repo.getRun = async (id) => (gone ? null : get(id))
    repo.addPage = async () => {
      gone = true
      throw new Error('violates foreign key')
    }

    await expect(runEvidenceJob(created.id, world.deps)).resolves.toBeUndefined()

    expect(logged).toEqual([])
  })
})

describe('highlights after the time is up', () => {
  it('are not started for the next page', async () => {
    const world = await createWorld({
      items: [item('i1', 'Privacy', 'Are teen accounts private by default?')],
      runTimeoutMs: 80,
      pages: [
        okPage({ url: 'https://p.test/a', finalUrl: 'https://p.test/a', text: 'Alpha page says teen accounts are private by default.' }),
        okPage({ url: 'https://p.test/b', finalUrl: 'https://p.test/b', text: 'Bravo page says teen accounts are private by default.' }),
      ],
      assess: (input) => ({
        results: [
          {
            itemId: 'i1',
            suggestedResult: 'yes' as const,
            reason: 'r',
            quotes: input.passages.map((p) => ({ passageId: p.id, text: p.text })),
            evidenceSufficient: true,
            conflicting: false,
            webAssessable: true,
            confidence: 'high' as const,
          },
        ],
        missingItemIds: [],
        tokensUsed: 1,
      }),
      // The first page's close-ups take until the run is out of time.
      highlights: (opts) => new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve(new Map()))),
    })

    await world.run()

    expect(world.calls.highlights).toHaveLength(1)
  })
})

describe('permission', () => {
  it('respects robots.txt and logs when the permission cannot be read', async () => {
    const repo = createMemoryRepository()
    repo.getPermission = async () => {
      throw new Error('permission table unreachable')
    }
    const world = await createWorld({ repo })

    const run = await world.run()

    expect(run.status).toBe('completed')
    expect(world.calls.capture[0].respectRobots).toBe(true)
    expect(logged.join('\n')).toMatch(/permission/i)
  })
})

describe('one robots checker for the run', () => {
  it('hands the capture the checker that the highlights use', async () => {
    const world = await createWorld({ items: [THREE_CATEGORIES[0]] })

    await world.run()

    expect(world.calls.capture[0].robots).toBeDefined()
    expect(world.calls.capture[0].respectRobots).toBe(true)
  })

  it('hands it none when the Head Auditor recorded permission', async () => {
    const world = await createWorld()
    await world.repo.setPermission(PROJECT, true, 'Emailed approval', 'u1')

    await world.run()

    expect(world.calls.capture[0].respectRobots).toBe(false)
    expect(world.calls.capture[0].robots).toBeUndefined()
  })
})

describe('messages that tell the truth about storage failures', () => {
  it('says the pages could not be saved when every page failed to save', async () => {
    const repo = createMemoryRepository()
    repo.addPage = async () => {
      throw new Error('disk full')
    }
    const world = await createWorld({ repo })

    const run = await world.run()

    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/could not be saved/i)
    expect(run.error).not.toMatch(/login|blocked/i)
    expect(run.finishedAt).not.toBeNull()
  })

  it('carries on when one page cannot be stored', async () => {
    const repo = createMemoryRepository()
    const add = repo.addPage.bind(repo)
    repo.addPage = async (runId, input) => {
      if (input.url.endsWith('/first')) throw new Error('disk hiccup')
      return add(runId, input)
    }
    const world = await createWorld({ repo, pages: [page('https://p.test/first', 'x'), okPage()] })

    const run = await world.run()

    expect(run.status).toBe('completed')
    expect((await repo.listPages(run.id)).map((p) => p.url)).toEqual(['https://p.test/privacy'])
  })

  it('does not blame the AI when the suggestions cannot be saved, and still counts its tokens', async () => {
    const repo = createMemoryRepository()
    repo.addSuggestion = async () => {
      throw new Error('write failed')
    }
    const world = await createWorld({ repo })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.error).toMatch(/2 categories could not be assessed/)
    expect(run.error).not.toMatch(/AI could not/i)
    expect(run.tokensUsed).toBe(200)
  })
})

describe('time', () => {
  it('says the run ran out of time when the only category is cut short', async () => {
    const world = await createWorld({ items: [item('i1', 'Privacy', 'Are teen accounts private by default?')], runTimeoutMs: 60, assess: () => new Promise(() => undefined) })

    const run = await world.run()

    expect(run.status).toBe('partial')
    expect(run.error).toMatch(/ran out of time/i)
  })
})

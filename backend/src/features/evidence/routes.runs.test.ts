import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RUNS_PER_PROJECT_PER_DAY,
  RUN_TIMEOUT_MS,
  STALE_QUEUED_RUN_MS,
  STALE_RUN_MARGIN_MS,
} from './config.js'
import { P1, P2, USERS, makeWorld, seedResult, type World } from './routesTestKit.js'
import type { RunStatus } from './types.js'

const START = `/api/projects/${P1}/evidence-runs`
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

async function withSource(world: World): Promise<void> {
  await world.repo.saveSource(P1, ['https://example.com/'], USERS.head.userId)
}

const post = (world: World, path: string, body?: object) => {
  const req = request(world.app).post(path).set(world.auth(USERS.auditor))
  return body ? req.send(body) : req
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('starting a run', () => {
  it('creates a queued capture run for the caller and queues it', async () => {
    const world = makeWorld()
    await withSource(world)
    const res = await post(world, START)
    expect(res.status).toBe(202)
    expect(res.body.run).toMatchObject({ projectId: P1, status: 'queued', scope: 'all', startedBy: USERS.auditor.userId })
    expect(res.body.run.capturedInRunId).toBe(res.body.run.id)
    expect(world.enqueued).toEqual([res.body.run.id])
  })

  it('a run with no saved source is 400 and creates nothing', async () => {
    const world = makeWorld()
    const res = await post(world, START)
    expect(res.status).toBe(400)
    expect(await world.repo.latestRun(P1)).toBeNull()
    expect(world.enqueued).toEqual([])
  })

  it('returns 409 when a run is already active', async () => {
    const world = makeWorld()
    await withSource(world)
    expect((await post(world, START)).status).toBe(202)
    const second = await post(world, START)
    expect(second.status).toBe(409)
    expect(world.enqueued).toHaveLength(1)
  })

  it.each(['pending_review', 'approved'] as const)('returns 409 for a run on a %s audit', async (status) => {
    const world = makeWorld()
    await withSource(world)
    world.audit.submission.set(P1, status)
    const res = await post(world, START)
    expect(res.status).toBe(409)
    expect(await world.repo.latestRun(P1)).toBeNull()
  })

  it('returns 404 when the project has gone', async () => {
    const world = makeWorld()
    await withSource(world)
    world.audit.submission.set(P1, null)
    expect((await post(world, START)).status).toBe(404)
  })

  it('returns 429 after 5 runs in a day for a project, and not for another project', async () => {
    const world = makeWorld()
    await withSource(world)
    for (let i = 0; i < MAX_RUNS_PER_PROJECT_PER_DAY; i += 1) {
      const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
      await world.repo.updateRun(run.id, { status: 'completed' })
    }
    const res = await post(world, START)
    expect(res.status).toBe(429)
    expect(res.body.error).toEqual(expect.any(String))
    expect(world.enqueued).toEqual([])
    await world.repo.saveSource(P2, ['https://example.com/'], USERS.headP2.userId)
    const other = await request(world.app).post(`/api/projects/${P2}/evidence-runs`).set(world.auth(USERS.auditorP2))
    expect(other.status).toBe(202)
  })

  it('counts a re-assess run toward the daily limit', async () => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1)
    for (let i = 0; i < MAX_RUNS_PER_PROJECT_PER_DAY - 1; i += 1) {
      const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'unfinished', capturedInRunId: seed.run.id })
      await world.repo.updateRun(run.id, { status: 'failed' })
    }
    const res = await post(world, `${START}/${seed.run.id}/reassess`, {})
    expect(res.status).toBe(429)
  })

  it('two simultaneous starts give one run and one 409', async () => {
    const world = makeWorld()
    await withSource(world)
    const createRun = world.repo.createRun.bind(world.repo)
    vi.spyOn(world.repo, 'createRun').mockImplementation(async (input) => {
      await new Promise((r) => setTimeout(r, 25))
      return createRun(input)
    })
    const [a, b] = await Promise.all([post(world, START), post(world, START)])
    expect([a.status, b.status].sort()).toEqual([202, 409])
    expect(world.enqueued).toHaveLength(1)
  })

  it('lets a start through again after a failed one released the lock', async () => {
    const world = makeWorld()
    await withSource(world)
    vi.spyOn(world.repo, 'createRun').mockRejectedValueOnce(new Error('db down'))
    expect((await post(world, START)).status).toBe(500)
    expect((await post(world, START)).status).toBe(202)
  })

  it('answers 503 and creates no run when GROQ_API_KEY is missing, while reads still work', async () => {
    const world = makeWorld({ aiConfigured: false })
    await withSource(world)
    const seed = await seedResult(world.repo, P1)
    const start = await post(world, START)
    expect(start.status).toBe(503)
    expect(start.body.error).toMatch(/GROQ_API_KEY/)
    const re = await post(world, `${START}/${seed.run.id}/reassess`, {})
    expect(re.status).toBe(503)
    expect(world.enqueued).toEqual([])
    const read = await request(world.app).get(`/api/projects/${P1}/ai-suggestions`).set(world.auth(USERS.auditor))
    expect(read.status).toBe(200)
    expect(read.body.suggestions).toHaveLength(1)
  })
})

describe('a run that was lost', () => {
  async function activeRun(world: World, status: RunStatus, ageMs: number, field: 'startedAt' | 'createdAt') {
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await world.repo.updateRun(run.id, { status, [field]: ago(ageMs) })
    if (field === 'startedAt') {
      // Not the same time as createdAt, so that a wrong field would be seen.
      await world.repo.updateRun(run.id, { createdAt: ago(1000) } as never)
    }
    return run
  }

  it.each(['capturing', 'assessing'] as const)('a %s run past its bound is failed and no longer blocks', async (status) => {
    const world = makeWorld()
    await withSource(world)
    const stuck = await activeRun(world, status, RUN_TIMEOUT_MS + STALE_RUN_MARGIN_MS + 60_000, 'startedAt')
    const res = await post(world, START)
    expect(res.status).toBe(202)
    const after = await world.repo.getRun(stuck.id)
    expect(after).toMatchObject({ status: 'failed', error: expect.stringMatching(/lost/i) })
    expect(after?.finishedAt).toBeTruthy()
  })

  it('a working run within its bound still gives 409', async () => {
    const world = makeWorld()
    await withSource(world)
    const live = await activeRun(world, 'capturing', RUN_TIMEOUT_MS - 60_000, 'startedAt')
    expect((await post(world, START)).status).toBe(409)
    expect((await world.repo.getRun(live.id))?.status).toBe('capturing')
  })

  it('a working run without startedAt is judged by createdAt', async () => {
    const world = makeWorld()
    await withSource(world)
    await activeRun(world, 'capturing', RUN_TIMEOUT_MS + STALE_RUN_MARGIN_MS + 60_000, 'createdAt')
    expect((await post(world, START)).status).toBe(202)
  })

  it('a queued run past the much larger bound is failed; a shorter wait still blocks', async () => {
    const world = makeWorld()
    await withSource(world)
    const waiting = await activeRun(world, 'queued', RUN_TIMEOUT_MS + STALE_RUN_MARGIN_MS + 60_000, 'createdAt')
    expect((await post(world, START)).status).toBe(409)
    expect((await world.repo.getRun(waiting.id))?.status).toBe('queued')
    await world.repo.updateRun(waiting.id, { createdAt: ago(STALE_QUEUED_RUN_MS + 60_000) } as never)
    expect((await post(world, START)).status).toBe(202)
    expect((await world.repo.getRun(waiting.id))?.status).toBe('failed')
  })
})

describe('re-assess', () => {
  const path = (runId: string) => `${START}/${runId}/reassess`

  it('defaults to the unfinished categories and reuses the pages of the run it came from', async () => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1, 'partial')
    const res = await post(world, path(seed.run.id), {})
    expect(res.status).toBe(202)
    expect(res.body.run).toMatchObject({ scope: 'unfinished', capturedInRunId: seed.run.id, status: 'queued' })
    expect(res.body.run.id).not.toBe(seed.run.id)
    expect(world.enqueued).toEqual([res.body.run.id])
  })

  describe('when nothing is unfinished', () => {
    /** A completed run with a suggestion for every item on the checklist. */
    async function allDone(world: World) {
      const seed = await seedResult(world.repo, P1)
      const { id: _id, runId: _run, quotes: _quotes, ...rest } = seed.suggestion
      await world.repo.addSuggestion({ ...rest, runId: seed.run.id, itemId: 'item-2', quotes: [] })
      return seed
    }

    it('answers 409 and spends none of the day\'s runs', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      const res = await post(world, path(seed.run.id), { scope: 'unfinished' })
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('Nothing is unfinished.')
      expect(world.enqueued).toEqual([])
      expect((await world.repo.latestRun(P1))?.id).toBe(seed.run.id)
      expect(await world.repo.countRunsSince(P1, ago(60_000))).toBe(1)
    })

    it('says the same when the scope is left to its default', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      expect((await post(world, path(seed.run.id), {})).body.error).toBe('Nothing is unfinished.')
    })

    it('still lets scope all start a run', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      expect((await post(world, path(seed.run.id), { scope: 'all' })).status).toBe(202)
    })

    it('says a run is in progress when one is, since that run may change what is unfinished', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
      const res = await post(world, path(seed.run.id), { scope: 'unfinished' })
      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/in progress/)
    })

    it('starts a run for an item added to the checklist since', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      const list = world.audit.listChecklistItems.bind(world.audit)
      world.audit.listChecklistItems = async (id) => [...(await list(id)), { id: 'item-3', guidelineId: 'g-1', category: 'Safety', name: 'Item 3', text: 'Is it new?', helpText: '' }]
      expect((await post(world, path(seed.run.id), { scope: 'unfinished' })).status).toBe(202)
    })

    it('starts a run when the last run listed a category as not assessed', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      await world.repo.updateRun(seed.run.id, { status: 'partial', unassessedCategories: ['g-1__Privacy'] })
      expect((await post(world, path(seed.run.id), { scope: 'unfinished' })).status).toBe(202)
    })

    it('creates no run when what is unfinished cannot be read', async () => {
      const world = makeWorld()
      const seed = await allDone(world)
      vi.spyOn(world.repo, 'listSuggestions').mockRejectedValue(new Error('down'))
      const res = await post(world, path(seed.run.id), { scope: 'unfinished' })
      expect(res.status).toBe(500)
      expect(world.enqueued).toEqual([])
      expect((await world.repo.latestRun(P1))?.id).toBe(seed.run.id)
    })
  })

  it('takes scope all', async () => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1)
    const res = await post(world, path(seed.run.id), { scope: 'all' })
    expect(res.body.run.scope).toBe('all')
  })

  it('rejects a bad scope with 400', async () => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1)
    expect((await post(world, path(seed.run.id), { scope: 'everything' })).status).toBe(400)
  })

  it('re-assessing a re-assess points at the original capture, not at the re-assess run', async () => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1)
    const first = await post(world, path(seed.run.id), {})
    await world.repo.updateRun(first.body.run.id, { status: 'completed' })
    const second = await post(world, path(first.body.run.id), {})
    expect(second.status).toBe(202)
    expect(second.body.run.capturedInRunId).toBe(seed.run.id)
  })

  it('a run of another project, or one that does not exist, is 404', async () => {
    const world = makeWorld()
    const other = await seedResult(world.repo, P2)
    expect((await post(world, path(other.run.id), {})).status).toBe(404)
    expect((await post(world, path('missing-run'), {})).status).toBe(404)
  })

  it.each(['queued', 'capturing', 'assessing', 'failed'] as const)('a %s run cannot be re-assessed (409)', async (status) => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1)
    // Same capture as the latest results, so only its own status can be the reason.
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'unfinished', capturedInRunId: seed.run.id })
    await world.repo.updateRun(run.id, { status })
    const res = await post(world, path(run.id), {})
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/finished run/i)
  })

  it('refuses a run whose pages are not the latest results (409)', async () => {
    const world = makeWorld()
    const old = await seedResult(world.repo, P1)
    await seedResult(world.repo, P1)
    const res = await post(world, path(old.run.id), {})
    expect(res.status).toBe(409)
    expect(world.enqueued).toEqual([])
  })

  it('is 409 while another run is active and on a submitted audit', async () => {
    const world = makeWorld()
    const seed = await seedResult(world.repo, P1)
    world.audit.submission.set(P1, 'approved')
    expect((await post(world, path(seed.run.id), {})).status).toBe(409)
    world.audit.submission.set(P1, 'not_submitted')
    expect((await post(world, path(seed.run.id), {})).status).toBe(202)
    expect((await post(world, path(seed.run.id), {})).status).toBe(409)
  })
})

describe('review round 1', () => {
  const setAge = (world: World, id: string, patch: Record<string, string>) => world.repo.updateRun(id, patch as never)

  it('the poll returns a lost run as failed with its error, so the UI can start again', async () => {
    const world = makeWorld()
    await withSource(world)
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await world.repo.updateRun(run.id, { status: 'assessing', startedAt: ago(2 * 24 * 60 * 60 * 1000) })
    const latest = () => request(world.app).get(`${START}/latest`).set(world.auth(USERS.auditor))
    const res = await latest()
    expect(res.body.run).toMatchObject({ id: run.id, status: 'failed', error: expect.stringMatching(/lost/i) })
    expect(res.body.run.finishedAt).toBeTruthy()
    expect((await latest()).body.run.status).toBe('failed')
    expect((await post(world, START)).status).toBe(202)
  })

  it('the poll leaves a live run alone', async () => {
    const world = makeWorld()
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await world.repo.updateRun(run.id, { status: 'assessing', startedAt: ago(60_000) })
    const res = await request(world.app).get(`${START}/latest`).set(world.auth(USERS.auditor))
    expect(res.body.run.status).toBe('assessing')
  })

  it('the bound is the run timeout plus the margin: just under blocks, just past frees', async () => {
    const bound = RUN_TIMEOUT_MS + STALE_RUN_MARGIN_MS
    const world = makeWorld()
    await withSource(world)
    const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await world.repo.updateRun(run.id, { status: 'capturing', startedAt: ago(bound - 5_000) })
    expect((await post(world, START)).status).toBe(409)
    await world.repo.updateRun(run.id, { startedAt: ago(bound + 5_000) })
    expect((await post(world, START)).status).toBe(202)
  })

  it('frees the project when more than one lost run is in the way', async () => {
    const world = makeWorld()
    await withSource(world)
    const old = ago(STALE_QUEUED_RUN_MS + 60_000)
    const first = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await setAge(world, first.id, { status: 'queued', createdAt: old })
    const second = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
    await world.repo.updateRun(second.id, { status: 'capturing', startedAt: old })
    expect((await post(world, START)).status).toBe(202)
    expect((await world.repo.getRun(first.id))?.status).toBe('failed')
    expect((await world.repo.getRun(second.id))?.status).toBe('failed')
  })

  it('counts only the last 24 hours toward the daily limit', async () => {
    const world = makeWorld()
    await withSource(world)
    for (let i = 0; i < MAX_RUNS_PER_PROJECT_PER_DAY; i += 1) {
      const run = await world.repo.createRun({ projectId: P1, startedBy: 'u-aud', scope: 'all' })
      await setAge(world, run.id, { status: 'completed', createdAt: ago(25 * 60 * 60 * 1000) })
    }
    expect((await post(world, START)).status).toBe(202)
  })

  it('a rejected audit may be run on again', async () => {
    const world = makeWorld()
    await withSource(world)
    world.audit.submission.set(P1, 'rejected')
    expect((await post(world, START)).status).toBe(202)
  })
})

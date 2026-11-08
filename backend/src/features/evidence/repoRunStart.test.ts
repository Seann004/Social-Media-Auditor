import { beforeEach, describe, expect, it } from 'vitest'
import type { SubmissionStatus } from '../../types/index.js'
import { MAX_RUNS_PER_PROJECT_PER_DAY, REPO_MAX_ITEMS_PER_RUN, REPO_PROMPT_VERSION } from './config.js'
import { createMemoryRepoRepository } from './memoryRepoRepository.js'
import { createMemoryRepository } from './memoryRepository.js'
import type { RunQueue } from './queue.js'
import { startRepoRun } from './repoRunStart.js'
import { unfinishedRepoItems } from './repoRunPlan.js'
import { createProjectLock } from './routeSupport.js'
import { startReassess, startRun, type RunStartDeps } from './runStart.js'
import type { EvidenceRun } from './types.js'
import { item } from './__fixtures__/runnerWorld.js'

const PROJECT = 'project-1'
const ITEMS = [
  item('i1', 'Privacy', 'Are teen accounts private by default?'),
  item('i2', 'Privacy', 'Can teens hide their activity status?'),
  item('i3', 'Messaging', 'Can an adult stranger message a teen account?'),
]

type Deps = RunStartDeps & { repoRepo: ReturnType<typeof createMemoryRepoRepository> }

let repo: ReturnType<typeof createMemoryRepository>
let repoRepo: ReturnType<typeof createMemoryRepoRepository>
let submission: SubmissionStatus | null
let queued: string[]
let deps: Deps

beforeEach(async () => {
  repo = createMemoryRepository()
  repoRepo = createMemoryRepoRepository()
  submission = 'not_submitted'
  queued = []
  const queue: RunQueue = { enqueue: (id) => void queued.push(id), idle: async () => undefined }
  deps = {
    repo,
    repoRepo,
    audit: { getSubmissionStatus: async () => submission, listChecklistItems: async () => [...ITEMS] },
    queue,
    acquire: createProjectLock(),
  }
  await repoRepo.saveRepoSource(PROJECT, { repoUrl: 'https://github.com/acme/social', owner: 'acme', name: 'social', branch: null }, 'u1')
})

/** A finished repo run, as an earlier result. */
async function finishedRepoRun(checked: string[], unchecked: string[]): Promise<EvidenceRun> {
  const run = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all', source: 'repo', checkedItemIds: checked, promptVersion: REPO_PROMPT_VERSION })
  return repo.updateRun(run.id, { status: unchecked.length > 0 ? 'partial' : 'completed', uncheckedItemIds: unchecked, finishedAt: new Date().toISOString() })
}

async function addPieceFor(runId: string, itemId: string): Promise<void> {
  await repoRepo.addPieces([{ runId, itemId, pageId: `page-${itemId}`, path: 'src/a.ts', startLine: 1, endLine: 5, commitSha: 'a'.repeat(40), round: 1 }])
}

async function addSuggestionFor(runId: string, itemId: string, source: 'repo' | 'pages' = 'repo'): Promise<void> {
  await repo.addSuggestion({ runId, projectId: PROJECT, itemId, suggestedResult: 'yes', reason: 'r', confidence: 'high', flags: [], passageIdsSent: [], source, quotes: [] })
}

describe('startRepoRun', () => {
  it('stores checkedItemIds in checklist order, with source repo and the repo prompt version, and queues the run', async () => {
    const outcome = await startRepoRun(deps, PROJECT, 'u1', ['i3', 'i1', 'i3'])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.run).toMatchObject({ source: 'repo', checkedItemIds: ['i1', 'i3'], promptVersion: REPO_PROMPT_VERSION, scope: 'all', startedBy: 'u1' })
    expect(outcome.run.capturedInRunId).toBe(outcome.run.id)
    expect(queued).toEqual([outcome.run.id])
  })

  it.each([
    ['no repository address', 400, 'Save the repository address before starting a code run.', ['i1']],
    ['no item picked', 400, 'Pick at least one checklist item to check in the code.', []],
    [`more than ${REPO_MAX_ITEMS_PER_RUN} items`, 400, `Pick at most ${REPO_MAX_ITEMS_PER_RUN} items for one code run.`, Array.from({ length: REPO_MAX_ITEMS_PER_RUN + 1 }, (_, i) => `x${i}`)],
    ['an item not on the checklist', 400, 'One of the picked items is not on this checklist.', ['i1', 'nope']],
    ['a locked audit', 409, 'The audit has been submitted, so its answers can no longer change.', ['i1']],
    ['a deleted project', 404, 'The project no longer exists.', ['i1']],
  ] as const)('refuses %s with %i and its exact sentence', async (name, status, error, picked) => {
    if (name === 'no repository address') deps = { ...deps, repoRepo: { ...repoRepo, getRepoSource: async () => null } }
    if (name === 'a locked audit') submission = 'pending_review'
    if (name === 'a deleted project') submission = null
    expect(await startRepoRun(deps, PROJECT, 'u1', [...picked])).toEqual({ ok: false, status, error })
    expect(queued).toEqual([])
  })

  it('refuses while another run is in progress', async () => {
    const active = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    await repo.updateRun(active.id, { status: 'capturing', startedAt: new Date().toISOString() })
    expect(await startRepoRun(deps, PROJECT, 'u1', ['i1'])).toEqual({ ok: false, status: 409, error: 'A run is already in progress for this project.' })
  })

  it('shares the project lock and the daily cap with page runs', async () => {
    const release = deps.acquire(PROJECT)
    expect(await startRepoRun(deps, PROJECT, 'u1', ['i1'])).toEqual({ ok: false, status: 409, error: 'A run is already being started for this project.' })
    release?.()

    await repo.saveSource(PROJECT, ['https://p.test/'], 'u1')
    for (let i = 0; i < MAX_RUNS_PER_PROJECT_PER_DAY - 1; i += 1) {
      const started = await startRun(deps, PROJECT, 'u1')
      if (!started.ok) throw new Error(started.error)
      await repo.updateRun(started.run.id, { status: 'completed' })
    }
    const code = await startRepoRun(deps, PROJECT, 'u1', ['i1'])
    expect(code.ok).toBe(true)
    if (code.ok) await repo.updateRun(code.run.id, { status: 'completed' })
    const refusal = `This project has used its ${MAX_RUNS_PER_PROJECT_PER_DAY} runs for today. Try again tomorrow.`
    expect(await startRepoRun(deps, PROJECT, 'u1', ['i1'])).toEqual({ ok: false, status: 429, error: refusal })
  })
})

describe('unfinishedRepoItems', () => {
  it('returns the checked items that have pieces and no repo suggestion in the latest result run of the capture', async () => {
    const from = await finishedRepoRun(['i1', 'i2', 'i3'], ['i2', 'i3'])
    await addPieceFor(from.id, 'i1')
    await addPieceFor(from.id, 'i2')
    await addSuggestionFor(from.id, 'i1')
    await addSuggestionFor(from.id, 'i2', 'pages')
    const capture = { projectId: PROJECT, capturedInRunId: from.id }
    expect(await unfinishedRepoItems(repo, repoRepo, capture, ['i1', 'i2', 'i3'])).toEqual(['i2'])
  })
})

describe('startReassess of a repo run', () => {
  it('copies source, checkedItemIds and promptVersion, and refuses "never opened" when no unchecked item has pieces', async () => {
    const from = await finishedRepoRun(['i1', 'i3'], ['i3'])
    await addPieceFor(from.id, 'i1')
    await addSuggestionFor(from.id, 'i1')
    expect(await startReassess(deps, PROJECT, 'u1', from.id, 'unfinished')).toEqual({
      ok: false,
      status: 409,
      error: 'The unchecked items were never opened in the code; start a new code run to check them.',
    })

    const all = await startReassess(deps, PROJECT, 'u1', from.id, 'all')
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.run).toMatchObject({ source: 'repo', checkedItemIds: ['i1', 'i3'], capturedInRunId: from.id, scope: 'all', promptVersion: REPO_PROMPT_VERSION })
  })

  it('refuses an unfinished repo re-assess with 409 when the server has no repo repository', async () => {
    const from = await finishedRepoRun(['i1'], ['i1'])
    await addPieceFor(from.id, 'i1')
    const { repoRepo: _repoRepo, ...withoutRepo } = deps
    expect(await startReassess(withoutRepo, PROJECT, 'u1', from.id, 'unfinished')).toEqual({
      ok: false,
      status: 409,
      error: "Reading code repositories isn't configured on this server.",
    })
    expect(queued).toEqual([])
  })

  it('queues an unfinished re-assess when a checked item has pieces and no suggestion', async () => {
    const from = await finishedRepoRun(['i1', 'i3'], ['i3'])
    await addPieceFor(from.id, 'i1')
    await addPieceFor(from.id, 'i3')
    await addSuggestionFor(from.id, 'i1')
    const outcome = await startReassess(deps, PROJECT, 'u1', from.id, 'unfinished')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.run).toMatchObject({ source: 'repo', checkedItemIds: ['i1', 'i3'], scope: 'unfinished', capturedInRunId: from.id })
  })

  it('refuses "Nothing is unfinished." when every checked item has its suggestion', async () => {
    const from = await finishedRepoRun(['i1'], [])
    await addPieceFor(from.id, 'i1')
    await addSuggestionFor(from.id, 'i1')
    expect(await startReassess(deps, PROJECT, 'u1', from.id, 'unfinished')).toEqual({ ok: false, status: 409, error: 'Nothing is unfinished.' })
  })
})

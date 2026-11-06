import { beforeEach, describe, expect, it } from 'vitest'
import type { SubmissionStatus } from '../../types/index.js'
import { startAppRun } from './appRunStart.js'
import { unfinishedAppItems } from './appRunner.js'
import { APP_PROMPT_VERSION, MAX_RUNS_PER_PROJECT_PER_DAY } from './config.js'
import { createMemoryAppRepository } from './memoryAppRepository.js'
import { createMemoryRepository } from './memoryRepository.js'
import type { RunQueue } from './queue.js'
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

type Deps = RunStartDeps & { appRepo: ReturnType<typeof createMemoryAppRepository> }

let repo: ReturnType<typeof createMemoryRepository>
let appRepo: ReturnType<typeof createMemoryAppRepository>
let submission: SubmissionStatus | null
let checklist = ITEMS
let queued: string[]
let deps: Deps

beforeEach(async () => {
  repo = createMemoryRepository()
  appRepo = createMemoryAppRepository()
  submission = 'not_submitted'
  checklist = ITEMS
  queued = []
  const queue: RunQueue = { enqueue: (id) => void queued.push(id), idle: async () => undefined }
  deps = {
    repo,
    appRepo,
    audit: { getSubmissionStatus: async () => submission, listChecklistItems: async () => [...checklist] },
    queue,
    acquire: createProjectLock(),
  }
  await appRepo.saveAppSource(PROJECT, { appUrl: 'https://app.test/login', loginDomains: [] }, 'u1')
  await addAccount()
})

async function addAccount(): Promise<void> {
  await appRepo.addTestAccount({
    id: 'acc-teen',
    projectId: PROJECT,
    label: 'Teen 15',
    ageGroup: 'under_18',
    age: 15,
    loginName: 'teen.login@example.test',
    handles: ['teen15'],
    passwordCiphertext: 'cipher',
    createdBy: null,
  })
}

/** A finished app run, as an earlier result. */
async function finishedAppRun(checked: string[], unchecked: string[]): Promise<EvidenceRun> {
  const run = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all', source: 'app', checkedItemIds: checked })
  return repo.updateRun(run.id, { status: unchecked.length > 0 ? 'partial' : 'completed', uncheckedItemIds: unchecked, finishedAt: new Date().toISOString() })
}

async function addStepFor(runId: string, itemId: string): Promise<void> {
  await appRepo.addStep({
    runId,
    itemId,
    position: 1,
    accountId: 'acc-teen',
    accountLabel: 'Teen 15',
    action: { type: 'switch_account', account: 'Teen 15' },
    line: 'Step 1 · Teen 15 · switched account · page /login opened',
    outcome: 'done',
    refusalReason: null,
    pageId: null,
  })
}

async function addSuggestionFor(runId: string, itemId: string, source: 'app' | 'pages' = 'app'): Promise<void> {
  await repo.addSuggestion({
    runId,
    projectId: PROJECT,
    itemId,
    suggestedResult: 'yes',
    reason: 'r',
    confidence: 'high',
    flags: [],
    passageIdsSent: [],
    source,
    quotes: [],
  })
}

describe('startAppRun', () => {
  it('stores checkedItemIds in checklist order, with source app and the app prompt version, and queues the run', async () => {
    const outcome = await startAppRun(deps, PROJECT, 'u1', ['i3', 'i1', 'i3'])
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.run).toMatchObject({ source: 'app', checkedItemIds: ['i1', 'i3'], promptVersion: APP_PROMPT_VERSION, scope: 'all', startedBy: 'u1' })
    expect(outcome.run.capturedInRunId).toBe(outcome.run.id)
    expect(queued).toEqual([outcome.run.id])
  })

  it.each([
    ['no app address', 400, 'Save the app address before starting an app run.', ['i1']],
    ['no test account', 400, 'Add at least one test account before starting an app run.', ['i1']],
    ['no item picked', 400, 'Pick at least one checklist item to check in the app.', []],
    ['more than 10 items', 400, 'Pick at most 10 items for one app run.', Array.from({ length: 11 }, (_, i) => `x${i}`)],
    ['an item not on the checklist', 400, 'One of the picked items is not on this checklist.', ['i1', 'nope']],
    ['a locked audit', 409, 'The audit has been submitted, so its answers can no longer change.', ['i1']],
    ['a deleted project', 404, 'The project no longer exists.', ['i1']],
  ] as const)('refuses %s with %i and its exact sentence', async (name, status, error, picked) => {
    if (name === 'no app address') deps = { ...deps, appRepo: { ...appRepo, getAppSource: async () => null } }
    if (name === 'no test account') await appRepo.deleteTestAccount('acc-teen')
    if (name === 'a locked audit') submission = 'pending_review'
    if (name === 'a deleted project') submission = null
    expect(await startAppRun(deps, PROJECT, 'u1', [...picked])).toEqual({ ok: false, status, error })
    expect(queued).toEqual([])
  })

  it('refuses while another run is in progress', async () => {
    const active = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    await repo.updateRun(active.id, { status: 'capturing', startedAt: new Date().toISOString() })
    expect(await startAppRun(deps, PROJECT, 'u1', ['i1'])).toEqual({ ok: false, status: 409, error: 'A run is already in progress for this project.' })
  })

  it('shares the project lock and the daily cap with page runs', async () => {
    const release = deps.acquire(PROJECT)
    expect(await startAppRun(deps, PROJECT, 'u1', ['i1'])).toEqual({ ok: false, status: 409, error: 'A run is already being started for this project.' })
    release?.()

    await repo.saveSource(PROJECT, ['https://p.test/'], 'u1')
    for (let i = 0; i < MAX_RUNS_PER_PROJECT_PER_DAY - 1; i += 1) {
      const started = await startRun(deps, PROJECT, 'u1')
      if (!started.ok) throw new Error(started.error)
      await repo.updateRun(started.run.id, { status: 'completed' })
    }
    const app = await startAppRun(deps, PROJECT, 'u1', ['i1'])
    expect(app.ok).toBe(true)
    if (app.ok) await repo.updateRun(app.run.id, { status: 'completed' })
    const refusal = `This project has used its ${MAX_RUNS_PER_PROJECT_PER_DAY} runs for today. Try again tomorrow.`
    expect(await startAppRun(deps, PROJECT, 'u1', ['i1'])).toEqual({ ok: false, status: 429, error: refusal })
    expect(await startRun(deps, PROJECT, 'u1')).toEqual({ ok: false, status: 429, error: refusal })
  })
})

describe('unfinishedAppItems', () => {
  it('returns the checked items that have steps and no app suggestion in the latest result run of the capture', async () => {
    const from = await finishedAppRun(['i1', 'i2', 'i3'], ['i2', 'i3'])
    await addStepFor(from.id, 'i1')
    await addStepFor(from.id, 'i2')
    await addSuggestionFor(from.id, 'i1')
    await addSuggestionFor(from.id, 'i2', 'pages')
    const capture = { projectId: PROJECT, capturedInRunId: from.id }
    expect(await unfinishedAppItems(repo, appRepo, capture, ['i1', 'i2', 'i3'])).toEqual(['i2'])
  })
})

describe('startReassess of an app run', () => {
  it('app re-assess copies source and checkedItemIds, and refuses "never opened" when nothing has steps', async () => {
    const from = await finishedAppRun(['i1', 'i3'], ['i1', 'i3'])
    expect(await startReassess(deps, PROJECT, 'u1', from.id, 'unfinished')).toEqual({
      ok: false,
      status: 409,
      error: 'The unchecked items were never opened in the app; start a new app run to check them.',
    })

    const all = await startReassess(deps, PROJECT, 'u1', from.id, 'all')
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.run).toMatchObject({ source: 'app', checkedItemIds: ['i1', 'i3'], capturedInRunId: from.id, scope: 'all' })
  })

  it('queues an unfinished re-assess when a checked item has steps and no suggestion', async () => {
    const from = await finishedAppRun(['i1', 'i3'], ['i3'])
    await addStepFor(from.id, 'i1')
    await addStepFor(from.id, 'i3')
    await addSuggestionFor(from.id, 'i1')
    const outcome = await startReassess(deps, PROJECT, 'u1', from.id, 'unfinished')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.run).toMatchObject({ source: 'app', checkedItemIds: ['i1', 'i3'], scope: 'unfinished', capturedInRunId: from.id })
  })

  it('refuses "Nothing is unfinished." when every checked item has its suggestion', async () => {
    const from = await finishedAppRun(['i1'], [])
    await addStepFor(from.id, 'i1')
    await addSuggestionFor(from.id, 'i1')
    expect(await startReassess(deps, PROJECT, 'u1', from.id, 'unfinished')).toEqual({ ok: false, status: 409, error: 'Nothing is unfinished.' })
  })

  it('a pages re-assess is unchanged: it copies no source', async () => {
    const run = await repo.createRun({ projectId: PROJECT, startedBy: 'u1', scope: 'all' })
    await repo.updateRun(run.id, { status: 'completed' })
    const outcome = await startReassess(deps, PROJECT, 'u1', run.id, 'all')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.run).toMatchObject({ source: 'pages', checkedItemIds: [], capturedInRunId: run.id })
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { RepoRepository } from './repoRepository.js'
import type { EvidenceRepository } from './repository.js'
import type { NewRepoPiece, NewRepoSnapshot } from './repoTypes.js'
import { createMemoryRepository } from './memoryRepository.js'
import { createMemoryRepoRepository } from './memoryRepoRepository.js'
import { createSupabaseRepository } from './supabaseRepository.js'
import { createSupabaseRepoRepository } from './supabaseRepoRepository.js'

interface Harness {
  repo: RepoRepository
  runs: EvidenceRepository
  projectId: string
  itemId: string
  otherItemId: string
  /** Deletes the run the way Postgres would: its snapshot and pieces go with it. */
  deleteRun: (runId: string) => Promise<void>
  cleanup: () => Promise<void>
}
type Factory = () => Harness

const memoryFactory: Factory = () => {
  const repo = createMemoryRepoRepository()
  return {
    repo,
    runs: createMemoryRepository(),
    projectId: randomUUID(),
    itemId: randomUUID(),
    otherItemId: randomUUID(),
    deleteRun: async (runId) => repo.removeRun(runId),
    cleanup: async () => {},
  }
}

const supabaseFactory: Factory = () => {
  const url = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const projectId = process.env.EVIDENCE_TEST_PROJECT_ID ?? ''
  const itemId = process.env.EVIDENCE_TEST_ITEM_ID ?? ''
  const otherItemId = process.env.EVIDENCE_TEST_OTHER_ITEM_ID ?? ''
  if (!url || !key || !projectId || !itemId || !otherItemId) {
    throw new Error(
      'EVIDENCE_TEST_SUPABASE needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVIDENCE_TEST_PROJECT_ID, EVIDENCE_TEST_ITEM_ID, EVIDENCE_TEST_OTHER_ITEM_ID',
    )
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })
  return {
    repo: createSupabaseRepoRepository(admin),
    runs: createSupabaseRepository(admin),
    projectId,
    itemId,
    otherItemId,
    deleteRun: async (runId) => {
      const { error } = await admin.from('Evidence_Run').delete().eq('id', runId)
      if (error) throw new Error(`deleteRun: ${error.message}`)
    },
    cleanup: async () => {
      for (const table of ['Evidence_Run', 'Evidence_Repo_Source']) {
        const { error } = await admin.from(table).delete().eq('projectId', projectId)
        if (error) throw new Error(`cleanup ${table}: ${error.message}`)
      }
    },
  }
}

const variants: [string, Factory][] = [['memory', memoryFactory]]
if (process.env.EVIDENCE_TEST_SUPABASE === 'true') variants.push(['supabase', supabaseFactory])

describe.each(variants)('repo evidence repository (%s)', (_variant, factory) => {
  let h: Harness
  beforeEach(() => {
    h = factory()
  })
  afterEach(async () => {
    await h.cleanup()
  })

  const newRunId = async () => (await h.runs.createRun({ projectId: h.projectId, startedBy: null, scope: 'all', source: 'repo' })).id

  const newPageId = async (runId: string) =>
    (
      await h.runs.addPage(runId, {
        url: 'https://github.com/o/r',
        finalUrl: null,
        httpStatus: 200,
        accessStatus: 'ok',
        accessDetail: null,
        title: 'r',
        text: null,
        accessibilitySnapshot: null,
        screenshotPath: null,
        contentHash: null,
      })
    ).id

  const snapshot = (runId: string): NewRepoSnapshot => ({
    runId,
    repoUrl: 'https://github.com/o/r',
    owner: 'o',
    name: 'r',
    branch: null,
    commitSha: 'abc1234abc1234abc1234abc1234abc1234abcd',
    filesRead: 12,
    filesSkipped: 3,
    truncated: false,
  })

  const piece = (runId: string, itemId: string, pageId: string, path: string, round: 1 | 2): NewRepoPiece => ({
    runId,
    itemId,
    pageId,
    path,
    startLine: 1,
    endLine: 20,
    commitSha: 'abc1234abc1234abc1234abc1234abc1234abcd',
    round,
  })

  it('has no source until one is saved', async () => {
    expect(await h.repo.getRepoSource(h.projectId)).toBeNull()
  })

  it('saves a source, and a second save replaces the first', async () => {
    const first = await h.repo.saveRepoSource(
      h.projectId,
      { repoUrl: 'https://github.com/o/r', owner: 'o', name: 'r', branch: null },
      null,
    )
    expect(first).toMatchObject({ projectId: h.projectId, owner: 'o', name: 'r', branch: null, updatedBy: null })
    expect(await h.repo.getRepoSource(h.projectId)).toEqual(first)

    const second = await h.repo.saveRepoSource(
      h.projectId,
      { repoUrl: 'https://github.com/o2/r2', owner: 'o2', name: 'r2', branch: 'dev' },
      null,
    )
    expect(second.id).toBe(first.id)
    expect(await h.repo.getRepoSource(h.projectId)).toMatchObject({ owner: 'o2', name: 'r2', branch: 'dev' })
  })

  it('round-trips a snapshot, and an unknown run gives null', async () => {
    const runId = await newRunId()
    const saved = await h.repo.saveSnapshot(snapshot(runId))
    expect(saved).toMatchObject(snapshot(runId))
    expect(typeof saved.createdAt).toBe('string')
    expect(await h.repo.getSnapshot(runId)).toEqual(saved)
    expect(await h.repo.getSnapshot(randomUUID())).toBeNull()
  })

  it('filters pieces by item and orders them by round, then insertion', async () => {
    const runId = await newRunId()
    const pageId = await newPageId(runId)
    await h.repo.addPieces([
      piece(runId, h.itemId, pageId, 'r2-a.ts', 2),
      piece(runId, h.itemId, pageId, 'r1-a.ts', 1),
      piece(runId, h.otherItemId, pageId, 'other.ts', 1),
      piece(runId, h.itemId, pageId, 'r1-b.ts', 1),
    ])
    expect((await h.repo.listPieces(runId, h.itemId)).map((p) => p.path)).toEqual(['r1-a.ts', 'r1-b.ts', 'r2-a.ts'])
    expect((await h.repo.listPieces(runId, h.otherItemId)).map((p) => p.path)).toEqual(['other.ts'])
    expect(await h.repo.listPieces(runId)).toHaveLength(4)
    expect(await h.repo.listPieces(randomUUID())).toEqual([])
    expect(await h.repo.addPieces([])).toEqual([])
  })

  it('keeps two addPieces calls for the same run and round in call order', async () => {
    const runId = await newRunId()
    const pageId = await newPageId(runId)
    await h.repo.addPieces([piece(runId, h.itemId, pageId, 'a.ts', 1), piece(runId, h.itemId, pageId, 'b.ts', 1)])
    await h.repo.addPieces([piece(runId, h.itemId, pageId, 'c.ts', 1), piece(runId, h.itemId, pageId, 'd.ts', 1)])
    expect((await h.repo.listPieces(runId, h.itemId)).map((p) => p.path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    expect(await h.repo.listPieces(runId)).not.toHaveProperty('0.position')
  })

  it('deleting the run removes its snapshot and pieces', async () => {
    const runId = await newRunId()
    const pageId = await newPageId(runId)
    await h.repo.saveSnapshot(snapshot(runId))
    await h.repo.addPieces([piece(runId, h.itemId, pageId, 'a.ts', 1)])
    await h.deleteRun(runId)
    expect(await h.repo.getSnapshot(runId)).toBeNull()
    expect(await h.repo.listPieces(runId)).toEqual([])
  })
})

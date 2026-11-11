import { randomUUID } from 'node:crypto'
import type { RepoRepository } from './repoRepository.js'
import type { RepoPiece, RepoSnapshot, RepoSource } from './repoTypes.js'

const copy = <T>(v: T): T => structuredClone(v)

/** The memory repository plus a test-only helper. The helper is not part of RepoRepository. */
export interface MemoryRepoRepository extends RepoRepository {
  /** Test only: what deleting the run does in Postgres (on delete cascade) to its snapshot and pieces. */
  removeRun(runId: string): void
}

/** In-memory repo repository for tests. Every result is a copy. */
export function createMemoryRepoRepository(): MemoryRepoRepository {
  const sources: RepoSource[] = []
  let snapshots: RepoSnapshot[] = []
  let pieces: RepoPiece[] = []

  return {
    async getRepoSource(projectId) {
      const row = sources.find((s) => s.projectId === projectId)
      return row ? copy(row) : null
    },
    async saveRepoSource(projectId, input, userId) {
      const index = sources.findIndex((s) => s.projectId === projectId)
      const row: RepoSource = {
        id: index >= 0 ? sources[index].id : randomUUID(),
        projectId,
        repoUrl: input.repoUrl,
        owner: input.owner,
        name: input.name,
        branch: input.branch,
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      }
      if (index >= 0) sources[index] = row
      else sources.push(row)
      return copy(row)
    },

    async saveSnapshot(input) {
      const row: RepoSnapshot = { ...copy(input), createdAt: new Date().toISOString() }
      snapshots = [...snapshots.filter((s) => s.runId !== input.runId), row]
      return copy(row)
    },
    async getSnapshot(runId) {
      const row = snapshots.find((s) => s.runId === runId)
      return row ? copy(row) : null
    },

    async addPieces(input) {
      const now = new Date().toISOString()
      const rows: RepoPiece[] = input.map((p) => ({ ...copy(p), id: randomUUID(), createdAt: now }))
      pieces = [...pieces, ...rows]
      return copy(rows)
    },
    async listPieces(runId, itemId) {
      const matching = pieces.filter((p) => p.runId === runId && (itemId === undefined || p.itemId === itemId))
      // Array.prototype.sort is stable, so insertion order is kept within a round.
      return copy([...matching].sort((a, b) => a.round - b.round))
    },

    removeRun(runId) {
      snapshots = snapshots.filter((s) => s.runId !== runId)
      pieces = pieces.filter((p) => p.runId !== runId)
    },
  }
}

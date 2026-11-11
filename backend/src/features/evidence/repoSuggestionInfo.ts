/**
 * What a suggestion listing says of each repo suggestion without a second request: the commit its
 * code was read at, and whether any code is there to show. The code is found as the code route finds
 * it: from the run that first assessed the suggestion (a copy carried forward names it as its origin),
 * through that run's capture. Every read is batched by distinct id, since carried copies can come from
 * several captures.
 */
import type { RepoRepository } from './repoRepository.js'
import type { EvidenceRepository } from './repository.js'
import type { Suggestion } from './types.js'

export interface RepoSuggestionInfo {
  /** Null when the snapshot of the capture is missing. */
  commitSha: string | null
  /** True when the item has stored code pieces in that capture: what "Code found" would show. */
  hasCode: boolean
}

interface CaptureCode {
  commitSha: string | null
  itemsWithPieces: ReadonlySet<string>
}

const distinct = (ids: readonly string[]): string[] => [...new Set(ids)]

/** The run that first assessed each suggestion: its own, or for a copy its origin's, read in one batch. */
async function assessedRunsOf(repo: EvidenceRepository, suggestions: readonly Suggestion[]): Promise<Map<string, string>> {
  const originIds = distinct(suggestions.flatMap((s) => (s.originSuggestionId ? [s.originSuggestionId] : [])))
  const originRuns = originIds.length > 0 ? await repo.getSuggestionRunIds(originIds) : {}
  const runs = new Map<string, string>()
  for (const s of suggestions) {
    const runId = s.originSuggestionId ? originRuns[s.originSuggestionId] : s.runId
    if (runId) runs.set(s.id, runId)
  }
  return runs
}

async function capturesOf(repo: EvidenceRepository, runIds: readonly string[]): Promise<Map<string, string>> {
  const runs = await Promise.all(distinct(runIds).map((id) => repo.getRun(id)))
  return new Map(runs.flatMap((run) => (run ? [[run.id, run.capturedInRunId] as const] : [])))
}

async function codeOf(repoRepo: RepoRepository | undefined, captureIds: readonly string[]): Promise<Map<string, CaptureCode>> {
  if (repoRepo === undefined) return new Map()
  const reads = await Promise.all(
    distinct(captureIds).map(async (id) => {
      const [snapshot, pieces] = await Promise.all([repoRepo.getSnapshot(id), repoRepo.listPieces(id)])
      return [id, { commitSha: snapshot?.commitSha ?? null, itemsWithPieces: new Set(pieces.map((p) => p.itemId)) }] as const
    }),
  )
  return new Map(reads)
}

/** By suggestion id, for the repo suggestions among `suggestions`; other sources are left out. */
export async function repoSuggestionInfo(
  repo: EvidenceRepository,
  repoRepo: RepoRepository | undefined,
  suggestions: readonly Suggestion[],
): Promise<Map<string, RepoSuggestionInfo>> {
  const repoOnes = suggestions.filter((s) => s.source === 'repo')
  if (repoOnes.length === 0) return new Map()
  const assessedRuns = await assessedRunsOf(repo, repoOnes)
  const captures = await capturesOf(repo, [...assessedRuns.values()])
  const code = await codeOf(repoRepo, [...captures.values()])
  return new Map(
    repoOnes.map((s) => {
      const runId = assessedRuns.get(s.id)
      const capture = runId ? captures.get(runId) : undefined
      const found = capture ? code.get(capture) : undefined
      return [s.id, { commitSha: found?.commitSha ?? null, hasCode: found?.itemsWithPieces.has(s.itemId) ?? false }]
    }),
  )
}

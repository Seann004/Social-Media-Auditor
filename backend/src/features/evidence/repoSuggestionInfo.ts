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
  /** True when the item has stored code pieces in that capture, or passages were sent for it. */
  hasCode: boolean
}

interface CaptureCode {
  commitSha: string | null
  itemsWithPieces: ReadonlySet<string>
}

const distinct = (ids: readonly string[]): string[] => [...new Set(ids)]

async function originsOf(repo: EvidenceRepository, suggestions: readonly Suggestion[]): Promise<Map<string, Suggestion>> {
  const known = new Map(suggestions.map((s) => [s.id, s]))
  const missing = distinct(suggestions.flatMap((s) => (s.originSuggestionId && !known.has(s.originSuggestionId) ? [s.originSuggestionId] : [])))
  const fetched = await Promise.all(missing.map((id) => repo.getSuggestion(id)))
  for (const s of fetched) if (s) known.set(s.id, s)
  const origins = new Map<string, Suggestion>()
  for (const s of suggestions) {
    const origin = s.originSuggestionId ? known.get(s.originSuggestionId) : s
    if (origin) origins.set(s.id, origin)
  }
  return origins
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
  const origins = await originsOf(repo, repoOnes)
  const captures = await capturesOf(repo, [...origins.values()].map((o) => o.runId))
  const code = await codeOf(repoRepo, [...captures.values()])
  return new Map(
    repoOnes.map((s) => {
      const origin = origins.get(s.id)
      const capture = origin ? captures.get(origin.runId) : undefined
      const found = capture ? code.get(capture) : undefined
      const sent = s.passageIdsSent.length > 0 || (origin?.passageIdsSent.length ?? 0) > 0
      return [s.id, { commitSha: found?.commitSha ?? null, hasCode: sent || (found?.itemsWithPieces.has(s.itemId) ?? false) }]
    }),
  )
}

import type { NewRepoPiece, NewRepoSnapshot, RepoPiece, RepoSnapshot, RepoSource } from './repoTypes.js'

export interface RepoSourceInput {
  repoUrl: string
  owner: string
  name: string
  branch: string | null
}

export interface RepoRepository {
  getRepoSource(projectId: string): Promise<RepoSource | null>
  /** One row per project: saving again replaces it. */
  saveRepoSource(projectId: string, input: RepoSourceInput, userId: string | null): Promise<RepoSource>

  /** One snapshot per run: saving again for the same run replaces it. */
  saveSnapshot(input: NewRepoSnapshot): Promise<RepoSnapshot>
  getSnapshot(runId: string): Promise<RepoSnapshot | null>

  addPieces(input: NewRepoPiece[]): Promise<RepoPiece[]>
  /** One run's pieces ordered by round, then insertion; for one item or (without `itemId`) for all. */
  listPieces(runId: string, itemId?: string): Promise<RepoPiece[]>
}

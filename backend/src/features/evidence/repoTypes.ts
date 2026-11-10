/** Types for repo evidence: the AI checks items against the code of a public GitHub repository. */

export interface RepoSource {
  id: string
  projectId: string
  repoUrl: string
  owner: string
  name: string
  branch: string | null
  updatedBy: string | null
  updatedAt: string
}

export interface RepoSnapshot {
  runId: string
  repoUrl: string
  owner: string
  name: string
  branch: string | null
  commitSha: string
  filesRead: number
  filesSkipped: number
  truncated: boolean
  createdAt: string
}

export type NewRepoSnapshot = Omit<RepoSnapshot, 'createdAt'>

/** One kept file: its path inside the repository and its text split into lines. */
export interface RepoFile {
  path: string
  lines: string[]
}

/** A stretch of a file picked by a search. Lines are counted from 1 and the range is inclusive. */
export interface PieceDraft {
  path: string
  startLine: number
  endLine: number
  code: string
}

export interface RepoPiece {
  id: string
  runId: string
  itemId: string
  pageId: string
  path: string
  startLine: number
  endLine: number
  commitSha: string
  round: 1 | 2
  createdAt: string
}

export type NewRepoPiece = Omit<RepoPiece, 'id' | 'createdAt'>

export interface SearchTerms {
  words: string[]
  pathHints: string[]
  paths: string[]
  /** Path words naming areas not relevant to the item (such as "admin"): files there rank lower, never out. */
  avoidPaths?: string[]
}

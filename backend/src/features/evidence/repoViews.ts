/** What the browser is shown of repository evidence. */
import type { RepoSource } from './repoTypes.js'

export interface RepoSourceView {
  repoUrl: string
  branch: string | null
  updatedAt: string
}

export interface CodePieceView {
  id: string
  path: string
  startLine: number
  endLine: number
  /** The code only: the header line of the stored page is left out. */
  code: string
  /** The permalink to these lines at the commit that was read. */
  url: string
  round: 1 | 2
  /** True when one of the suggestion's verified quotes names this piece. */
  quoted: boolean
}

export function toRepoSourceView(source: RepoSource): RepoSourceView {
  return { repoUrl: source.repoUrl, branch: source.branch, updatedAt: source.updatedAt }
}

/** The text of a stored piece page without its first (header) line. */
export function codeOfPageText(text: string | null): string {
  if (text === null) return ''
  const at = text.indexOf('\n')
  return at === -1 ? '' : text.slice(at + 1)
}

export function toCodePieceView(
  piece: { id: string; path: string; startLine: number; endLine: number; round: 1 | 2 },
  page: { url: string; text: string | null },
  quoted: boolean,
): CodePieceView {
  return {
    id: piece.id,
    path: piece.path,
    startLine: piece.startLine,
    endLine: piece.endLine,
    code: codeOfPageText(page.text),
    url: page.url,
    round: piece.round,
    quoted,
  }
}

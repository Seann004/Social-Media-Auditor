export interface ParsedRepo {
  repoUrl: string
  owner: string
  name: string
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const NAME = /^[A-Za-z0-9._-]{1,100}$/
const BRANCH = /^[A-Za-z0-9._/-]+$/
const ADDRESS = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/

/** Reads `https://github.com/<owner>/<name>` and nothing else; returns null for any other address. */
export function parseRepoUrl(input: string): ParsedRepo | null {
  const match = ADDRESS.exec(input.trim())
  if (!match) return null
  const owner = match[1] as string
  const name = match[2] as string
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null
  return { repoUrl: `https://github.com/${owner}/${name}`, owner, name }
}

export function isValidBranch(branch: string): boolean {
  if (branch.length < 1 || branch.length > 255) return false
  if (!BRANCH.test(branch)) return false
  if (branch.includes('..') || branch.includes('//')) return false
  if (branch.startsWith('/') || branch.startsWith('-')) return false
  return !(branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock'))
}

export function permalinkOf(owner: string, name: string, sha: string, path: string, startLine: number, endLine: number): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${name}/blob/${sha}/${encoded}#L${startLine}-L${endLine}`
}

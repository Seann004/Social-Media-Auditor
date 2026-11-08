import { REPO_FETCH_TIMEOUT_MS, REPO_GITHUB_HOSTS, REPO_MAX_DOWNLOAD_BYTES, REPO_MAX_REDIRECTS, USER_AGENT } from './config.js'
import type { UrlGuard } from './urlGuard.js'

/** An error whose message is safe to show to an auditor. */
export class RepoFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoFetchError'
  }
}

export interface GithubFetcher {
  resolveCommit(owner: string, name: string, branch: string | null): Promise<string>
  downloadArchive(owner: string, name: string, sha: string): Promise<Buffer>
}

export interface GithubFetcherDeps {
  guard: UrlGuard
  fetchFn?: typeof fetch
  signal?: AbortSignal
}

const NOT_FOUND = 'The repository was not found, or it is private. Only public GitHub repositories can be read.'
const RATE_LIMITED = "GitHub's limit for requests without sign-in was reached. Try again in about an hour."
const TOO_BIG = "The repository's download is larger than 50 MB, so it can't be read."
const LEFT_GITHUB = 'The download tried to leave GitHub, so it was stopped.'
const OTHER = 'The repository could not be downloaded from GitHub. Try again later.'

const SHA = /^[0-9a-f]{40}$/
const MAX_SHA_BODY_BYTES = 1_024

const noBranchSentence = (branch: string | null): string =>
  branch === null ? NOT_FOUND : `The branch ${branch} was not found in this repository.`

function isGithubUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.port === '' && REPO_GITHUB_HOSTS.includes(url.hostname)
}

function nextUrl(response: Response): string | null {
  if (response.status < 300 || response.status >= 400) return null
  const location = response.headers.get('location')
  return location ? location : ''
}

/** Reads a body up to `limit` bytes; returns null once it passes the limit, after cancelling the stream. */
async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
  }
  return Buffer.concat(chunks)
}

export function createGithubFetcher(deps: GithubFetcherDeps): GithubFetcher {
  const fetchFn = deps.fetchFn ?? fetch

  /** One GET that follows at most REPO_MAX_REDIRECTS redirects, checking every hop. */
  async function get(startUrl: string, accept: string | null): Promise<Response> {
    const signal = deps.signal
      ? AbortSignal.any([deps.signal, AbortSignal.timeout(REPO_FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(REPO_FETCH_TIMEOUT_MS)
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
    if (accept) headers.Accept = accept

    let url = startUrl
    for (let hop = 0; hop <= REPO_MAX_REDIRECTS; hop += 1) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new RepoFetchError(LEFT_GITHUB)
      }
      if (!isGithubUrl(parsed)) throw new RepoFetchError(LEFT_GITHUB)
      const verdict = await deps.guard.check(parsed.href)
      if (!verdict.allowed) throw new RepoFetchError(LEFT_GITHUB)

      let response: Response
      try {
        response = await fetchFn(parsed.href, { method: 'GET', redirect: 'manual', credentials: 'omit', headers, signal })
      } catch (err) {
        console.error('GitHub request failed', parsed.href, err)
        throw new RepoFetchError(OTHER)
      }
      const location = nextUrl(response)
      if (location === null) return response
      await response.body?.cancel()
      if (location === '') throw new RepoFetchError(OTHER)
      try {
        url = new URL(location, parsed.href).href
      } catch {
        throw new RepoFetchError(LEFT_GITHUB)
      }
    }
    throw new RepoFetchError(LEFT_GITHUB)
  }

  async function failFor(response: Response, branch: string | null): Promise<never> {
    await response.body?.cancel()
    const { status } = response
    if (status === 404 || (status === 422 && branch !== null)) throw new RepoFetchError(noBranchSentence(branch))
    if (status === 403 || status === 429) throw new RepoFetchError(RATE_LIMITED)
    console.error('GitHub answered with an unexpected status', status)
    throw new RepoFetchError(OTHER)
  }

  return {
    async resolveCommit(owner, name, branch) {
      const ref = branch === null ? 'HEAD' : branch.split('/').map(encodeURIComponent).join('/')
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${ref}`
      const response = await get(url, 'application/vnd.github.sha')
      if (!response.ok) return failFor(response, branch)
      const body = await readCapped(response, MAX_SHA_BODY_BYTES).catch(() => null)
      const sha = body?.toString('utf8').trim() ?? ''
      if (!SHA.test(sha)) throw new RepoFetchError(OTHER)
      return sha
    },

    async downloadArchive(owner, name, sha) {
      const url = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tar.gz/${encodeURIComponent(sha)}`
      const response = await get(url, null)
      if (!response.ok) return failFor(response, null)
      let body: Buffer | null
      try {
        body = await readCapped(response, REPO_MAX_DOWNLOAD_BYTES)
      } catch (err) {
        console.error('GitHub download failed', url, err)
        throw new RepoFetchError(OTHER)
      }
      if (body === null) throw new RepoFetchError(TOO_BIG)
      return body
    },
  }
}

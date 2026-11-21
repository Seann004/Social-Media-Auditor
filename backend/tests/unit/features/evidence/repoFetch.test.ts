import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGithubFetcher, RepoFetchError } from '../../../../src/features/evidence/repoFetch.js'
import { fakeGithubFetch } from '../../../fixtures/fakeGithub.js'
import type { UrlGuard } from '../../../../src/features/evidence/urlGuard.js'

const SHA = 'a'.repeat(40)
const API = 'https://api.github.com/repos/acme/app/commits/HEAD'
const ARCHIVE = `https://codeload.github.com/acme/app/tar.gz/${SHA}`

const NOT_FOUND = 'The repository was not found, or it is private. Only public GitHub repositories can be read.'
const LIMIT = "GitHub's limit for requests without sign-in was reached. Try again in about an hour."
const TOO_BIG = "The repository's download is larger than 50 MB, so it can't be read."
const LEFT = 'The download tried to leave GitHub, so it was stopped.'
const OTHER = 'The repository could not be downloaded from GitHub. Try again later.'

const allow: UrlGuard = { check: async () => ({ allowed: true }) }
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } })
const text = (body: string, status = 200) => () => new Response(body, { status })

afterEach(() => vi.restoreAllMocks())

async function message(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(RepoFetchError)
    return (err as Error).message
  }
  throw new Error('expected a RepoFetchError')
}

describe('resolveCommit', () => {
  it('resolves a 40-hex sha and sends the sha Accept header', async () => {
    const seen: RequestInit[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push(init)
      expect(url).toBe(API)
      return new Response(SHA)
    }) as unknown as typeof fetch
    const f = createGithubFetcher({ guard: allow, fetchFn })
    expect(await f.resolveCommit('acme', 'app', null)).toBe(SHA)
    expect(seen[0]?.redirect).toBe('manual')
    expect(seen[0]?.credentials).toBe('omit')
    expect((seen[0]?.headers as Record<string, string>).Accept).toBe('application/vnd.github.sha')
    expect((seen[0]?.headers as Record<string, string>)['User-Agent']).toBe('SafetyAuditEvidenceBot/1.0')
    expect(seen[0]?.signal).toBeDefined()
  })

  it('places the branch in the commit URL', async () => {
    const f = createGithubFetcher({
      guard: allow,
      fetchFn: fakeGithubFetch({ 'https://api.github.com/repos/acme/app/commits/feature/x.y': text(SHA) }),
    })
    expect(await f.resolveCommit('acme', 'app', 'feature/x.y')).toBe(SHA)
  })

  it('cuts a very long invalid branch to 255 characters in the sentence', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const f = createGithubFetcher({ guard: allow, fetchFn })
    const sentence = await message(f.resolveCommit('acme', 'app', 'a'.repeat(1000)))
    expect(sentence).toBe(`The branch ${'a'.repeat(255)} was not found in this repository.`)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses an invalid branch before any request is made', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const f = createGithubFetcher({ guard: allow, fetchFn })
    expect(await message(f.resolveCommit('acme', 'app', 'a b'))).toBe('The branch a b was not found in this repository.')
    expect(await message(f.resolveCommit('acme', 'app', '../x'))).toBe('The branch ../x was not found in this repository.')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a body that is not a sha', async () => {
    const f = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [API]: text('<html>nope</html>') }) })
    expect(await message(f.resolveCommit('acme', 'app', null))).toBe(OTHER)
  })

  it.each([
    [404, null, NOT_FOUND],
    [404, 'dev', 'The branch dev was not found in this repository.'],
    [422, 'dev', 'The branch dev was not found in this repository.'],
    [403, null, LIMIT],
    [429, 'dev', LIMIT],
    [500, null, OTHER],
  ])('maps status %s with branch %s', async (status, branch, sentence) => {
    const url = branch ? 'https://api.github.com/repos/acme/app/commits/dev' : API
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [url]: text('x', status as number) }) })
    expect(await message(f.resolveCommit('acme', 'app', branch))).toBe(sentence)
    if (status === 500) expect(errorSpy).toHaveBeenCalled()
  })

  it('reports a network failure with the general sentence', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = createGithubFetcher({ guard: allow, fetchFn })
    expect(await message(f.resolveCommit('acme', 'app', null))).toBe(OTHER)
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('downloadArchive', () => {
  it('returns the bytes', async () => {
    const f = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [ARCHIVE]: text('tarbytes') }) })
    expect((await f.downloadArchive('acme', 'app', SHA)).toString()).toBe('tarbytes')
  })

  it('stops reading a body that passes the cap', async () => {
    let pulled = 0
    const chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 60) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const f = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [ARCHIVE]: () => new Response(body) }) })
    expect(await message(f.downloadArchive('acme', 'app', SHA))).toBe(TOO_BIG)
    expect(pulled).toBeLessThan(56)
  })

  it('refuses at once when content-length is over the cap', async () => {
    const f = createGithubFetcher({
      guard: allow,
      fetchFn: fakeGithubFetch({ [ARCHIVE]: () => new Response('x', { headers: { 'content-length': String(60 * 1024 * 1024) } }) }),
    })
    expect(await message(f.downloadArchive('acme', 'app', SHA))).toBe(TOO_BIG)
  })

  it('maps 404 and 403', async () => {
    const f404 = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [ARCHIVE]: text('x', 404) }) })
    expect(await message(f404.downloadArchive('acme', 'app', SHA))).toBe(NOT_FOUND)
    const f403 = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [ARCHIVE]: text('x', 403) }) })
    expect(await message(f403.downloadArchive('acme', 'app', SHA))).toBe(LIMIT)
  })

  it('refuses a redirect to another host', async () => {
    const f = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [ARCHIVE]: redirect('https://other.example/x') }) })
    expect(await message(f.downloadArchive('acme', 'app', SHA))).toBe(LEFT)
  })

  it('refuses a redirect to plain http', async () => {
    const f = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch({ [ARCHIVE]: redirect('http://codeload.github.com/x') }) })
    expect(await message(f.downloadArchive('acme', 'app', SHA))).toBe(LEFT)
  })

  it('follows a redirect from codeload to codeload', async () => {
    const f = createGithubFetcher({
      guard: allow,
      fetchFn: fakeGithubFetch({ [ARCHIVE]: redirect('https://codeload.github.com/other/path'), 'https://codeload.github.com/other/path': text('ok') }),
    })
    expect((await f.downloadArchive('acme', 'app', SHA)).toString()).toBe('ok')
  })

  it('follows 3 redirects but refuses a 4th', async () => {
    const hop = (n: number) => `https://codeload.github.com/h${n}`
    const routes = {
      [ARCHIVE]: redirect(hop(1)),
      [hop(1)]: redirect(hop(2)),
      [hop(2)]: redirect(hop(3)),
      [hop(3)]: text('three'),
    }
    const ok = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch(routes) })
    expect((await ok.downloadArchive('acme', 'app', SHA)).toString()).toBe('three')

    const four = { ...routes, [hop(3)]: redirect(hop(4)), [hop(4)]: text('four') }
    const bad = createGithubFetcher({ guard: allow, fetchFn: fakeGithubFetch(four) })
    expect(await message(bad.downloadArchive('acme', 'app', SHA))).toBe(LEFT)
  })

  it('calls the guard for every hop', async () => {
    const check = vi.fn(async (_url: string) => ({ allowed: true }) as const)
    const f = createGithubFetcher({
      guard: { check },
      fetchFn: fakeGithubFetch({ [ARCHIVE]: redirect('https://codeload.github.com/b'), 'https://codeload.github.com/b': text('ok') }),
    })
    await f.downloadArchive('acme', 'app', SHA)
    expect(check.mock.calls.map((c) => c[0])).toEqual([ARCHIVE, 'https://codeload.github.com/b'])
  })

  it('stops when the guard refuses', async () => {
    const f = createGithubFetcher({
      guard: { check: async () => ({ allowed: false, reason: 'private' }) },
      fetchFn: fakeGithubFetch({}),
    })
    expect(await message(f.downloadArchive('acme', 'app', SHA))).toBe(LEFT)
  })
})

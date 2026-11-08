import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import {
  EvidenceApiError,
  addTestAccount,
  deleteTestAccount,
  getAppSetup,
  getCode,
  getRepoSource,
  getRunChanges,
  saveRepoSource,
  startRepoRun,
  getSuggestionSteps,
  saveAppSource,
  startAppRun,
  updateTestAccount,
  getLatestRun,
  getScreenshotUrl,
  getSources,
  getSuggestions,
  postDecision,
  reassess,
  saveSources,
  setPermission,
  startRun,
} from './api'

const fetchMock = vi.fn()

function reply(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

async function failure(call: () => Promise<unknown>): Promise<EvidenceApiError> {
  try {
    await call()
  } catch (err) {
    expect(err).toBeInstanceOf(EvidenceApiError)
    return err as EvidenceApiError
  }
  throw new Error('expected the call to fail')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useStore.setState({ sessionToken: 'tok-123' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useStore.setState({ sessionToken: null })
})

describe('evidence api client', () => {
  it('sends the bearer token and turns a 503 body into EvidenceApiError', async () => {
    fetchMock.mockResolvedValueOnce(reply(503, JSON.stringify({ error: 'AI assessment is not configured on this server: GROQ_API_KEY is missing.' })))
    const err = await failure(() => startRun('p1'))
    expect(err.status).toBe(503)
    expect(err.message).toBe('AI assessment is not configured on this server: GROQ_API_KEY is missing.')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/projects\/p1\/evidence-runs$/)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-123')
  })

  it('throws a 401 without touching the network when there is no token', async () => {
    useStore.setState({ sessionToken: null })
    const err = await failure(() => getSources('p1'))
    expect(err.status).toBe(401)
    expect(err.message).not.toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 409, 422, 429, 503])('keeps the server sentence for a %i', async (status) => {
    fetchMock.mockResolvedValueOnce(reply(status, JSON.stringify({ error: `sentence for ${status}` })))
    const err = await failure(() => getSuggestions('p1'))
    expect(err.status).toBe(status)
    expect(err.message).toBe(`sentence for ${status}`)
  })

  it('uses a plain message by status for a non-JSON body and never shows the raw body', async () => {
    fetchMock.mockResolvedValueOnce(reply(502, '<html><body>Bad gateway from proxy</body></html>', 'text/html'))
    const err = await failure(() => getLatestRun('p1'))
    expect(err.status).toBe(502)
    expect(err.message).not.toContain('<html')
    expect(err.message).not.toContain('proxy')
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('uses a plain message for a JSON body without an error sentence', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, JSON.stringify({ stack: 'secret trace' })))
    const err = await failure(() => getLatestRun('p1'))
    expect(err.status).toBe(500)
    expect(err.message).not.toContain('secret')
  })

  it('falls back to the plain message when error is not a string', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, JSON.stringify({ error: { stack: 'secret trace' } })))
    const err = await failure(() => getLatestRun('p1'))
    expect(err.message).toBe('Something went wrong on the server.')
    fetchMock.mockResolvedValueOnce(reply(404, JSON.stringify({ error: 42 })))
    expect((await failure(() => getLatestRun('p1'))).message).toBe('That was not found.')
  })

  it('reports a network failure as status 0 with a plain message', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await failure(() => getLatestRun('p1'))
    expect(err.status).toBe(0)
    expect(err.message).not.toContain('Failed to fetch')
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('reports a successful reply that is not JSON as an error', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, '<html>login</html>', 'text/html'))
    const err = await failure(() => getSources('p1'))
    expect(err.status).toBe(200)
    expect(err.message).not.toContain('<html')
  })

  it('encodes path parameters', async () => {
    fetchMock.mockImplementation(async () => reply(200, JSON.stringify({ url: 'https://x' })))
    await getSources('a/b c')
    await reassess('p/1', 'r?1', 'all')
    await getScreenshotUrl('quote', 'q#1')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toMatch(/\/projects\/a%2Fb%20c\/evidence-sources$/)
    expect(urls[1]).toMatch(/\/projects\/p%2F1\/evidence-runs\/r%3F1\/reassess$/)
    expect(urls[2]).toMatch(/\/evidence\/screenshots\/quote\/q%231$/)
  })

  it('calls each endpoint with the right method and body', async () => {
    fetchMock.mockImplementation(async () => reply(200, JSON.stringify({ url: 'https://signed' })))
    await saveSources('p1', ['https://a.example'])
    await setPermission('p1', true, 'ok by owner')
    await reassess('p1', 'r1', 'unfinished')
    await postDecision('s1', { decision: 'overridden', origin: 'answer_button', finalResult: 'partially', overrideReason: 'why' })
    const url = await getScreenshotUrl('page', 'pg1')
    const calls = fetchMock.mock.calls.map(([u, init]) => ({ url: String(u), method: init.method ?? 'GET', body: init.body }))
    expect(calls[0]).toMatchObject({ method: 'POST', body: JSON.stringify({ startUrls: ['https://a.example'] }) })
    expect(calls[0].url).toMatch(/\/projects\/p1\/evidence-sources$/)
    expect(calls[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ granted: true, note: 'ok by owner' }) })
    expect(calls[1].url).toMatch(/\/projects\/p1\/evidence-permission$/)
    expect(calls[2]).toMatchObject({ method: 'POST', body: JSON.stringify({ scope: 'unfinished' }) })
    expect(calls[3].url).toMatch(/\/suggestions\/s1\/decision$/)
    expect(JSON.parse(calls[3].body)).toEqual({ decision: 'overridden', origin: 'answer_button', finalResult: 'partially', overrideReason: 'why' })
    expect(calls[4].url).toMatch(/\/evidence\/screenshots\/page\/pg1$/)
    expect(url).toBe('https://signed')
  })

  it('returns the parsed body on success', async () => {
    const body = { run: null, pages: [] }
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify(body)))
    await expect(getLatestRun('p1')).resolves.toEqual(body)
  })
})

describe('app evidence api client', () => {
  const input = { label: 'Teen 15', ageGroup: 'under_18' as const, age: 15, loginName: 'teen', handles: ['@teen'] }

  it('getAppSetup reads app-setup', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ app: null, accounts: [], secretKeyConfigured: true })))
    expect((await getAppSetup('p1')).secretKeyConfigured).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/projects\/p1\/app-setup$/)
  })

  it('saveAppSource PUTs the address and login domains', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ app: { appUrl: 'https://a.test', loginDomains: ['x.test'], updatedAt: 't' } })))
    await saveAppSource('p1', 'https://a.test', ['x.test'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/projects\/p1\/app-source$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ appUrl: 'https://a.test', loginDomains: ['x.test'] })
  })

  it('addTestAccount sends the password; updateTestAccount omits it when blank', async () => {
    fetchMock.mockImplementation(async () => reply(201, JSON.stringify({ account: { id: 'a1' } })))
    await addTestAccount('p1', { ...input, password: 'pw-1' })
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ...input, password: 'pw-1' })

    await updateTestAccount('p1', 'a1', { ...input, password: '' })
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toMatch(/\/projects\/p1\/test-accounts\/a1$/)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual(input)
    expect('password' in JSON.parse(init.body)).toBe(false)

    await updateTestAccount('p1', 'a1', input)
    expect('password' in JSON.parse(fetchMock.mock.calls[2][1].body)).toBe(false)

    await updateTestAccount('p1', 'a1', { ...input, password: 'new' })
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).password).toBe('new')
  })

  it('deleteTestAccount accepts an empty 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteTestAccount('p1', 'a1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('startAppRun posts itemIds and turns a 400 sentence into EvidenceApiError', async () => {
    fetchMock.mockResolvedValueOnce(reply(400, JSON.stringify({ error: 'Pick at most 10 items.' })))
    const err = await failure(() => startAppRun('p1', ['a', 'b']))
    expect(err.status).toBe(400)
    expect(err.message).toBe('Pick at most 10 items.')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/projects\/p1\/app-runs$/)
    expect(JSON.parse(init.body)).toEqual({ itemIds: ['a', 'b'] })
  })

  it('getRunChanges and getSuggestionSteps read their paths', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ changes: [] })))
    await getRunChanges('p1', 'r1')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/projects\/p1\/evidence-runs\/r1\/app-changes$/)
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ steps: [], changes: [] })))
    await getSuggestionSteps('s 1')
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/suggestions\/s%201\/steps$/)
  })
})

describe('repo evidence api client', () => {
  it('getRepoSource reads repo-source', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ repo: null })))
    expect((await getRepoSource('p1')).repo).toBeNull()
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/projects\/p1\/repo-source$/)
  })

  it('saveRepoSource PUTs the address and branch, and surfaces a 400 sentence', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ repo: { repoUrl: 'u', branch: 'dev', updatedAt: 't' } })))
    await saveRepoSource('p1', { repoUrl: 'https://github.com/o/n', branch: 'dev' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/projects\/p1\/repo-source$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ repoUrl: 'https://github.com/o/n', branch: 'dev' })
    fetchMock.mockResolvedValueOnce(reply(400, JSON.stringify({ error: "That branch name isn't valid." })))
    const err = await failure(() => saveRepoSource('p1', { repoUrl: 'x', branch: '..' }))
    expect(err.message).toBe("That branch name isn't valid.")
  })

  it('startRepoRun posts itemIds to repo-runs', async () => {
    fetchMock.mockResolvedValueOnce(reply(202, JSON.stringify({ run: { id: 'r' } })))
    await startRepoRun('p1', ['a', 'b'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/projects\/p1\/repo-runs$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ itemIds: ['a', 'b'] })
  })

  it('getCode reads the code of a suggestion', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, JSON.stringify({ commitSha: 'abc', repoUrl: 'u', pieces: [] })))
    expect((await getCode('s 1')).commitSha).toBe('abc')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/suggestions\/s%201\/code$/)
  })
})

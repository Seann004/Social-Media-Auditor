import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import {
  EvidenceApiError,
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

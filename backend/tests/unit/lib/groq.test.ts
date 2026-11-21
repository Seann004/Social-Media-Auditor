import { describe, it, expect, vi, afterEach } from 'vitest'
import { groqFetchWithRetry, GroqLimitError } from '../../../src/lib/groq.js'

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response('{}', { status, headers })
}

describe('groqFetchWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('waits and retries on a short retry-after', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValueOnce(res(429, { 'retry-after': '2' })).mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', fetchMock)
    const p = groqFetchWithRetry('https://x', {}, 3, 60)
    await vi.advanceTimersByTimeAsync(2000)
    const out = await p
    expect(out.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws GroqLimitError immediately on retry-after 3600 when maxWaitSeconds is 60', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(res(429, { 'retry-after': '3600' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(groqFetchWithRetry('https://x', {}, 3, 60)).rejects.toBeInstanceOf(GroqLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('defaults to a 15 second wait and makes a final extra attempt', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(res(429))
    vi.stubGlobal('fetch', fetchMock)
    const p = groqFetchWithRetry('https://x', {}, 2)
    await vi.advanceTimersByTimeAsync(30_000)
    const out = await p
    expect(out.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it('stops waiting for a retry as soon as the signal aborts', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(res(429, { 'retry-after': '30' }))
    vi.stubGlobal('fetch', fetchMock)
    const run = new AbortController()
    const p = groqFetchWithRetry('https://x', { signal: run.signal }, 3, 60).catch((e) => e)
    await vi.advanceTimersByTimeAsync(1000)
    run.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await p).toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

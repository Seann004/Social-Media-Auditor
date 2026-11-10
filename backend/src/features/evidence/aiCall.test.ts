import { describe, it, expect, vi, afterEach } from 'vitest'
import { GroqLimitError } from '../../lib/groq.js'
import { callGroqJson } from './aiCall.js'
import { GROQ_NETWORK_RETRY_DELAYS_MS } from './config.js'

function reply(content: unknown, total = 321): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: total } }))
}
const call = (model = 'openai/gpt-oss-120b', maxTokens = 777) =>
  callGroqJson({ apiKey: 'KEY', model, system: 'sys', user: 'usr', maxTokens })
const bodyOf = (f: ReturnType<typeof vi.fn>, n = 0) => JSON.parse((f.mock.calls[n][1] as RequestInit).body as string)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('callGroqJson', () => {
  it('adds reasoning_effort low for openai/gpt-oss models and not for others', async () => {
    const f = vi.fn().mockImplementation(async () => reply({ a: 1 }))
    vi.stubGlobal('fetch', f)
    await call('openai/gpt-oss-120b')
    await call('llama-3.3-70b')
    expect(bodyOf(f, 0).reasoning_effort).toBe('low')
    expect(bodyOf(f, 1)).not.toHaveProperty('reasoning_effort')
  })
  it('sends JSON mode, temperature 0.1 and the given max_tokens', async () => {
    const f = vi.fn().mockResolvedValue(reply({ a: 1 }))
    vi.stubGlobal('fetch', f)
    await call()
    const body = bodyOf(f)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBe(0.1)
    expect(body.max_tokens).toBe(777)
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ])
  })
  it('returns content null for non-JSON replies and counts usage.total_tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('not json', 55)))
    expect(await call()).toEqual({ content: null, tokens: 55 })
  })
  it('returns the parsed JSON and its tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ a: 1 }, 9)))
    expect(await call()).toEqual({ content: { a: 1 }, tokens: 9 })
  })
  it('throws GroqLimitError on retry-after 3600', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '3600' } })))
    await expect(call()).rejects.toBeInstanceOf(GroqLimitError)
  })
  it('throws with the status only on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"secret":"BODY"}', { status: 500 })))
    const err = await call().catch((e) => e as Error)
    expect(err.message).toContain('500')
    expect(err.message).not.toContain('KEY')
  })
  it('passes the given signal to fetch', async () => {
    const f = vi.fn().mockResolvedValue(reply({ a: 1 }))
    vi.stubGlobal('fetch', f)
    const run = new AbortController()
    await callGroqJson({ apiKey: 'KEY', model: 'm', system: 's', user: 'u', maxTokens: 5, signal: run.signal })
    expect((f.mock.calls[0][1] as RequestInit).signal).toBe(run.signal)
  })
})

const fetchFailed = () => new TypeError('fetch failed')
const allWaits = () => GROQ_NETWORK_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)

describe('callGroqJson on a network failure', () => {
  it('waits about 1 s and then 3 s between tries', () => {
    expect(GROQ_NETWORK_RETRY_DELAYS_MS).toEqual([1_000, 3_000])
  })
  it('succeeds when fetch fails twice and then answers', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn().mockRejectedValueOnce(fetchFailed()).mockRejectedValueOnce(fetchFailed()).mockResolvedValue(reply({ a: 1 }, 9))
    vi.stubGlobal('fetch', f)
    const p = callGroqJson({ apiKey: 'sk-secret-key', model: 'm', system: 's', user: 'u', maxTokens: 5 })
    await vi.advanceTimersByTimeAsync(allWaits())
    expect(await p).toEqual({ content: { a: 1 }, tokens: 9 })
    expect(f).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(log.mock.calls)).toContain('fetch failed')
    expect(JSON.stringify(log.mock.calls)).not.toContain('sk-secret-key')
  })
  it('throws the original error when fetch fails three times', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = fetchFailed()
    const f = vi.fn().mockRejectedValue(err)
    vi.stubGlobal('fetch', f)
    const p = call().catch((e) => e)
    await vi.advanceTimersByTimeAsync(allWaits())
    expect(await p).toBe(err)
    expect(f).toHaveBeenCalledTimes(3)
  })
  it('retries a reset connection and a socket hang-up', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reset = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    const hangUp = new Error('socket hang up')
    const f = vi.fn().mockRejectedValueOnce(reset).mockRejectedValueOnce(hangUp).mockResolvedValue(reply({ a: 1 }))
    vi.stubGlobal('fetch', f)
    const p = call()
    await vi.advanceTimersByTimeAsync(allWaits())
    expect((await p).content).toEqual({ a: 1 })
  })
  it('stops at once when the signal aborts during the wait', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn().mockRejectedValue(fetchFailed())
    vi.stubGlobal('fetch', f)
    const run = new AbortController()
    const p = callGroqJson({ apiKey: 'KEY', model: 'm', system: 's', user: 'u', maxTokens: 5, signal: run.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(100)
    const stopped = new Error('run stopped')
    run.abort(stopped)
    expect(await p).toBe(stopped)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('does not retry a 400', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }))
    vi.stubGlobal('fetch', f)
    await expect(call()).rejects.toThrow('400')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('does not retry an error that is not a network failure', async () => {
    const f = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', f)
    await expect(call()).rejects.toThrow('boom')
    expect(f).toHaveBeenCalledTimes(1)
  })
})

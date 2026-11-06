import { describe, it, expect, vi, afterEach } from 'vitest'
import { GroqLimitError } from '../../lib/groq.js'
import { callGroqJson } from './aiCall.js'

function reply(content: unknown, total = 321): Response {
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: total } }))
}
const call = (model = 'openai/gpt-oss-120b', maxTokens = 777) =>
  callGroqJson({ apiKey: 'KEY', model, system: 'sys', user: 'usr', maxTokens })
const bodyOf = (f: ReturnType<typeof vi.fn>, n = 0) => JSON.parse((f.mock.calls[n][1] as RequestInit).body as string)

afterEach(() => {
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
})

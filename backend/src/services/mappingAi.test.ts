import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAiUsage, resetAiUsage } from '../lib/aiUsage.js'
import { askMappingModel } from './mappingAi.js'

const ENV = { GROQ_API_KEY: 'test-key' }
const NO_WAIT = [0, 0, 0]

function groqReply(content: unknown, usage = { prompt_tokens: 1200, completion_tokens: 300 }) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage }), { status: 200 })
}

function connectTimeout() {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  resetAiUsage()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('askMappingModel', () => {
  it('returns the parsed JSON reply', async () => {
    fetchMock.mockResolvedValueOnce(groqReply({ matches: [] }))
    expect(await askMappingModel('system', 'user', ENV, NO_WAIT)).toEqual({ matches: [] })
  })

  it('uses the matching model and sends both prompts', async () => {
    fetchMock.mockResolvedValueOnce(groqReply({ matches: [] }))
    await askMappingModel('SYS', 'USR', { ...ENV, MAPPING_GROQ_MODEL: 'some/model' }, NO_WAIT)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('some/model')
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }])
  })

  it('tries again when the connection to Groq times out, then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(connectTimeout()).mockRejectedValueOnce(connectTimeout()).mockResolvedValueOnce(groqReply({ matches: [1] }))
    expect(await askMappingModel('s', 'u', ENV, NO_WAIT)).toEqual({ matches: [1] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after the last try and throws the network error', async () => {
    fetchMock.mockRejectedValue(connectTimeout())
    await expect(askMappingModel('s', 'u', ENV, NO_WAIT)).rejects.toThrow(/fetch failed/)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not try again after an error answer from Groq', async () => {
    fetchMock.mockResolvedValue(new Response('model not found', { status: 404 }))
    await expect(askMappingModel('s', 'u', ENV, NO_WAIT)).rejects.toThrow(/Groq API error: model not found/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws a clear message when the key is missing, without calling Groq', async () => {
    await expect(askMappingModel('s', 'u', {}, NO_WAIT)).rejects.toThrow(/GROQ_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts the tokens of each successful call under matching', async () => {
    fetchMock.mockResolvedValueOnce(groqReply({ matches: [] }, { prompt_tokens: 1000, completion_tokens: 200 }))
    fetchMock.mockResolvedValueOnce(groqReply({ matches: [] }, { prompt_tokens: 500, completion_tokens: 50 }))
    await askMappingModel('s', 'u', ENV, NO_WAIT)
    await askMappingModel('s', 'u', ENV, NO_WAIT)
    expect(getAiUsage()).toEqual([{ feature: 'matching', model: 'openai/gpt-oss-120b', calls: 2, inputTokens: 1500, outputTokens: 250 }])
  })

  it('does not count a call that failed on the network', async () => {
    fetchMock.mockRejectedValue(connectTimeout())
    await askMappingModel('s', 'u', ENV, NO_WAIT).catch(() => {})
    expect(getAiUsage()).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAiUsage, recordAiUsage, resetAiUsage } from './aiUsage.js'

beforeEach(() => {
  resetAiUsage()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('aiUsage', () => {
  it('adds up calls and tokens per feature and model', () => {
    recordAiUsage('evidence', 'm1', { prompt_tokens: 100, completion_tokens: 20 })
    recordAiUsage('evidence', 'm1', { prompt_tokens: 50, completion_tokens: 10 })
    recordAiUsage('extraction', 'm1', { prompt_tokens: 7, completion_tokens: 3 })
    expect(getAiUsage()).toEqual([
      { feature: 'evidence', model: 'm1', calls: 2, inputTokens: 150, outputTokens: 30 },
      { feature: 'extraction', model: 'm1', calls: 1, inputTokens: 7, outputTokens: 3 },
    ])
  })

  it('keeps models apart', () => {
    recordAiUsage('matching', 'a', { prompt_tokens: 1, completion_tokens: 1 })
    recordAiUsage('matching', 'b', { prompt_tokens: 2, completion_tokens: 2 })
    expect(getAiUsage().map((r) => r.model)).toEqual(['a', 'b'])
  })

  it('counts a reply with no usage as a call with zero tokens, and ignores bad numbers', () => {
    recordAiUsage('matching', 'm', undefined)
    recordAiUsage('matching', 'm', { prompt_tokens: Number.NaN, completion_tokens: -5 })
    expect(getAiUsage()).toEqual([{ feature: 'matching', model: 'm', calls: 2, inputTokens: 0, outputTokens: 0 }])
  })

  it('writes one log line per call without any prompt text', () => {
    recordAiUsage('evidence', 'm', { prompt_tokens: 10, completion_tokens: 2 })
    expect(console.log).toHaveBeenCalledWith('[ai-usage] {"feature":"evidence","model":"m","inputTokens":10,"outputTokens":2}')
  })

  it('returns copies, so changing the result does not change the totals', () => {
    recordAiUsage('evidence', 'm', { prompt_tokens: 10, completion_tokens: 2 })
    getAiUsage()[0].calls = 99
    expect(getAiUsage()[0].calls).toBe(1)
  })

  it('can be reset', () => {
    recordAiUsage('evidence', 'm', { prompt_tokens: 10, completion_tokens: 2 })
    resetAiUsage()
    expect(getAiUsage()).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAIM_CHECK_MAX_OUTPUT_TOKENS, verifyClaim, withdrawnClaim } from '../../../../src/features/evidence/claimCheck.js'

const ITEM = { id: 'i1', guidelineId: 'g1', category: 'Privacy', name: null, text: 'Is the account private?', helpText: null }
const fetchMock = vi.fn()

const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 42 } }), { status: 200 })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const run = () => verifyClaim({ item: ITEM, claim: 'yes', quotes: ['Your account is private.'], apiKey: 'k', model: 'openai/gpt-oss-120b' })

describe('verifyClaim', () => {
  it('is supported only on a "supports" verdict, and counts the tokens', async () => {
    fetchMock.mockResolvedValueOnce(reply({ verdict: 'supports' }))
    expect(await run()).toEqual({ supported: true, tokensUsed: 42 })
  })

  it.each(['not_shown', 'contradicts'])('is not supported on "%s"', async (verdict) => {
    fetchMock.mockResolvedValueOnce(reply({ verdict }))
    expect((await run()).supported).toBe(false)
  })

  it('lets the first answer stand when the reply is unreadable', async () => {
    fetchMock.mockResolvedValueOnce(reply({ something: 'else' }))
    expect((await run()).supported).toBe(true)
  })

  it('sends only the claim and quotes, with a small reply cap', async () => {
    fetchMock.mockResolvedValueOnce(reply({ verdict: 'supports' }))
    await run()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(CLAIM_CHECK_MAX_OUTPUT_TOKENS)
    expect(JSON.parse(body.messages[1].content)).toEqual({ item: { name: null, text: ITEM.text }, claim: 'yes', quotes: ['Your account is private.'] })
  })
})

describe('withdrawnClaim', () => {
  it('clears the answer and keeps the first reason', () => {
    const out = withdrawnClaim({ itemId: 'i1', suggestedResult: 'no', reason: 'Because.', quotes: [], evidenceSufficient: true, conflicting: false, webAssessable: true, confidence: 'high' })
    expect(out).toMatchObject({ suggestedResult: null, evidenceSufficient: false, confidence: 'low' })
    expect(out.reason).toContain('Because.')
  })
})

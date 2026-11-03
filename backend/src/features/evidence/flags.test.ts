import { describe, it, expect } from 'vitest'
import { computeFlags, type FlagInput } from './flags.js'

function input(overrides: Partial<FlagInput> = {}): FlagInput {
  return {
    suggestedResult: 'yes',
    evidenceSufficient: true,
    conflicting: false,
    webAssessable: true,
    confidence: 'high',
    aiReason: '',
    passagesFound: 3,
    quotes: [{ text: 'Accounts are private by default.', verified: true }],
    failedPages: [],
    ...overrides,
  }
}

const types = (i: FlagInput) => computeFlags(i).map((f) => f.type)

describe('computeFlags', () => {
  it('returns [] for a clean suggestion', () => {
    expect(computeFlags(input())).toEqual([])
  })

  it('missing_evidence when no passages were found', () => {
    const flags = computeFlags(input({ passagesFound: 0, quotes: [] }))
    expect(flags.map((f) => f.type)).toContain('missing_evidence')
    expect(flags.find((f) => f.type === 'missing_evidence')?.reason.trim()).not.toBe('')
  })

  it('missing_evidence when the AI says evidence is insufficient', () => {
    expect(types(input({ evidenceSufficient: false }))).toContain('missing_evidence')
  })

  it('missing_evidence when a yes/no/partially result has no quotes', () => {
    for (const r of ['yes', 'no', 'partially'] as const) {
      expect(types(input({ suggestedResult: r, quotes: [] }))).toContain('missing_evidence')
    }
  })

  it('no missing_evidence for not_applicable with no quotes when evidence is sufficient', () => {
    expect(types(input({ suggestedResult: 'not_applicable', quotes: [] }))).not.toContain('missing_evidence')
  })

  it('uses the AI reason for missing_evidence when present, else general wording', () => {
    const withAi = computeFlags(input({ evidenceSufficient: false, aiReason: 'No page says how age is checked.' }))
    expect(withAi.find((f) => f.type === 'missing_evidence')?.reason).toBe('No page says how age is checked.')
    const blank = computeFlags(input({ evidenceSufficient: false, aiReason: '   ' }))
    expect(blank.find((f) => f.type === 'missing_evidence')?.reason).toMatch(/\S/)
    expect(blank.find((f) => f.type === 'missing_evidence')?.reason).not.toBe('   ')
  })

  it('uses fixed wording, not aiReason, when a result has no quotes but evidence is sufficient', () => {
    const flags = computeFlags(input({ suggestedResult: 'yes', quotes: [], aiReason: 'Age is verified at sign-up.' }))
    const mine = flags.filter((f) => f.type === 'missing_evidence')
    expect(mine).toHaveLength(1)
    expect(mine[0].reason).toBe('The AI gave this result without quoting any captured page.')
    expect(mine[0].reason).not.toContain('Age is verified')
  })

  it('short-evidence wording wins over the no-quote wording, with a single flag', () => {
    const flags = computeFlags(input({ evidenceSufficient: false, quotes: [], aiReason: 'Nothing on age checks.' }))
    const mine = flags.filter((f) => f.type === 'missing_evidence')
    expect(mine).toHaveLength(1)
    expect(mine[0].reason).toBe('Nothing on age checks.')
  })

  it('inaccessible only when evidence is short AND a page failed, naming up to 3 urls', () => {
    const failedPages = [1, 2, 3, 4].map((n) => ({ url: `https://a.test/${n}`, status: 'login_required' as const }))
    const flag = computeFlags(input({ evidenceSufficient: false, failedPages })).find((f) => f.type === 'inaccessible')
    expect(flag).toBeDefined()
    expect(flag!.reason).toContain('https://a.test/1')
    expect(flag!.reason).toContain('https://a.test/3')
    expect(flag!.reason).not.toContain('https://a.test/4')
    expect(types(input({ evidenceSufficient: false }))).not.toContain('inaccessible')
  })

  it('inaccessible when no passages were found and a page failed', () => {
    const failedPages = [{ url: 'https://a.test/x', status: 'blocked' as const }]
    expect(types(input({ passagesFound: 0, quotes: [], failedPages }))).toContain('inaccessible')
  })

  it('no inaccessible flag when evidence was sufficient, even if some page failed', () => {
    const failedPages = [{ url: 'https://a.test/x', status: 'timeout' as const }]
    expect(types(input({ failedPages }))).not.toContain('inaccessible')
  })

  it('conflicting when reported', () => {
    const flags = computeFlags(input({ conflicting: true, aiReason: 'Policy and help centre disagree.' }))
    expect(flags.find((f) => f.type === 'conflicting')?.reason).toBe('Policy and help centre disagree.')
    const blank = computeFlags(input({ conflicting: true }))
    expect(blank.find((f) => f.type === 'conflicting')?.reason).toMatch(/\S/)
  })

  it('unverified_quote when any quote failed the check', () => {
    const quotes = [
      { text: 'ok', verified: true },
      { text: 'made up', verified: false },
    ]
    const flag = computeFlags(input({ quotes })).find((f) => f.type === 'unverified_quote')
    expect(flag?.reason).toMatch(/\S/)
  })

  it('low_confidence when confidence is low', () => {
    expect(types(input({ confidence: 'low' }))).toContain('low_confidence')
    expect(types(input({ confidence: 'medium' }))).not.toContain('low_confidence')
  })

  it('not_web_assessable when the item cannot be judged from a website', () => {
    expect(types(input({ webAssessable: false }))).toContain('not_web_assessable')
  })

  it('returns several flags together', () => {
    const t = types(
      input({ confidence: 'low', conflicting: true, quotes: [{ text: 'x', verified: false }] }),
    )
    expect(t).toEqual(expect.arrayContaining(['conflicting', 'unverified_quote', 'low_confidence']))
  })
})

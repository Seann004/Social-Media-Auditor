import { describe, it, expect } from 'vitest'
import { computeFlags, isAboutDefault, type FlagInput } from './flags.js'

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

describe('computeFlags for app checks', () => {
  it('app wording for not_web_assessable', () => {
    const flag = computeFlags(input({ webAssessable: false, source: 'app' })).find((f) => f.type === 'not_web_assessable')
    expect(flag?.reason).toBe("This item needs evidence the app can't show.")
    const pages = computeFlags(input({ webAssessable: false, source: 'pages' })).find((f) => f.type === 'not_web_assessable')
    expect(pages?.reason).toBe("This item needs internal evidence, which a website can't show.")
  })

  it('stoppedBy always adds inaccessible naming the url', () => {
    const stoppedBy = { url: 'http://app.test/challenge', detail: 'The app asked for a captcha.' }
    const clean = computeFlags(input({ source: 'app', stoppedBy }))
    expect(clean).toEqual([{ type: 'inaccessible', reason: 'The check stopped at http://app.test/challenge: The app asked for a captcha.' }])
    const short = computeFlags(input({ source: 'app', stoppedBy, evidenceSufficient: false, suggestedResult: null, quotes: [] }))
    expect(short.filter((f) => f.type === 'inaccessible')).toHaveLength(1)
    expect(types(input({ source: 'app', stoppedBy: null }))).not.toContain('inaccessible')
  })

  it('adds comments_only when a claimed result rests only on comments or docs', () => {
    const flags = computeFlags(input({ commentsOnly: true, suggestedResult: 'yes', quotes: [{ text: 'x', verified: true }] }))
    expect(flags).toContainEqual({ type: 'comments_only', reason: 'Only comments or documentation support this.' })
  })

  it('leaves comments_only out for a null result', () => {
    expect(types(input({ commentsOnly: true, suggestedResult: null }))).not.toContain('comments_only')
  })

  it.each(['app', 'repo'] as const)('%s: a null result with too little evidence gets missing_evidence, not not_web_assessable', (source) => {
    const flags = types(input({ source, webAssessable: false, suggestedResult: null, evidenceSufficient: false, quotes: [] }))
    expect(flags).toContain('missing_evidence')
    expect(flags).not.toContain('not_web_assessable')
  })

  it.each(['app', 'repo'] as const)('%s: keeps not_web_assessable in every other case', (source) => {
    expect(types(input({ source, webAssessable: false, suggestedResult: null, evidenceSufficient: true, quotes: [] }))).toContain('not_web_assessable')
    expect(types(input({ source, webAssessable: false, suggestedResult: 'no', evidenceSufficient: false }))).toContain('not_web_assessable')
    expect(types(input({ source, webAssessable: false }))).toContain('not_web_assessable')
  })

  it('pages: keeps not_web_assessable on a null result with too little evidence', () => {
    const flags = types(input({ source: 'pages', webAssessable: false, suggestedResult: null, evidenceSufficient: false, quotes: [] }))
    expect(flags).toEqual(expect.arrayContaining(['missing_evidence', 'not_web_assessable']))
    expect(types(input({ webAssessable: false, suggestedResult: null, evidenceSufficient: false, quotes: [] }))).toContain('not_web_assessable')
  })

  it('uses the code wording for a repo item that is not assessable', () => {
    const flag = computeFlags(input({ webAssessable: false, source: 'repo' })).find((f) => f.type === 'not_web_assessable')
    expect(flag?.reason).toBe("This item needs evidence the code can't show.")
  })
})

describe('computeFlags default_unverified', () => {
  const REASON =
    "This item is about a default setting, but the check only saw this account's current setting. Confirm the default yourself, for example with a newly created account."

  it.each(['yes', 'no', 'partially'] as const)('flags an app %s result on an item about a default', (r) => {
    const flags = computeFlags(input({ source: 'app', aboutDefault: true, suggestedResult: r }))
    expect(flags).toContainEqual({ type: 'default_unverified', reason: REASON })
  })

  it('leaves it out for pages and repo checks', () => {
    expect(types(input({ source: 'pages', aboutDefault: true }))).not.toContain('default_unverified')
    expect(types(input({ source: 'repo', aboutDefault: true }))).not.toContain('default_unverified')
    expect(types(input({ aboutDefault: true }))).not.toContain('default_unverified')
  })

  it('leaves it out for a null or not_applicable result', () => {
    expect(types(input({ source: 'app', aboutDefault: true, suggestedResult: null }))).not.toContain('default_unverified')
    expect(types(input({ source: 'app', aboutDefault: true, suggestedResult: 'not_applicable' }))).not.toContain('default_unverified')
  })

  it('leaves it out when the item is not about a default', () => {
    expect(types(input({ source: 'app', aboutDefault: false }))).not.toContain('default_unverified')
    expect(types(input({ source: 'app' }))).not.toContain('default_unverified')
  })
})

describe('isAboutDefault', () => {
  it.each([
    'Accounts of users under 16 are private by default',
    'Are teen accounts private BY DEFAULT?',
    'Is the default for teen accounts private?',
    'Privacy defaults for minors',
    'Location sharing defaults to off',
    'The setting is defaulting to private',
  ])('true for %s', (text) => {
    expect(isAboutDefault(text)).toBe(true)
  })

  it.each(['Adults cannot message teens', 'Teens can hide their activity status', 'Payment defaulted loans', 'defaultValue'])(
    'false for %s',
    (text) => {
      expect(isAboutDefault(text)).toBe(false)
    },
  )
})

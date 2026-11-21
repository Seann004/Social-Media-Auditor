import { describe, expect, it } from 'vitest'
import { CASES, PLATFORM, validateCases } from '../../../benchmarks/cases.js'
import { EXPECTED_ANSWERS, type BenchmarkCase } from '../../../benchmarks/types.js'

const valid = (over: Partial<BenchmarkCase>): BenchmarkCase => ({
  id: 'x',
  source: 'repo',
  category: 'Privacy',
  item: 'Is it so?',
  expected: 'yes',
  alsoAcceptable: [],
  why: 'Because the fixture says so in a named place.',
  kinds: ['clear'],
  ...over,
})

describe('the benchmark cases', () => {
  it('pass validation', () => {
    expect(validateCases(CASES)).toEqual([])
  })

  it('have unique ids, an allowed expected answer and a why each', () => {
    const ids = CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CASES) {
      expect(EXPECTED_ANSWERS).toContain(c.expected)
      expect(c.why.trim().length).toBeGreaterThan(40)
      expect(c.alsoAcceptable).not.toContain(c.expected)
    }
  })

  it('count at least 10 app cases and 8 code cases', () => {
    expect(CASES.filter((c) => c.source === 'app').length).toBeGreaterThanOrEqual(10)
    expect(CASES.filter((c) => c.source === 'repo').length).toBeGreaterThanOrEqual(8)
  })

  it('cover every kind the design asks for', () => {
    const kindsOf = (source: string) => new Set(CASES.filter((c) => c.source === source).flatMap((c) => c.kinds))
    expect([...kindsOf('app')].sort()).toEqual(['cannot_show', 'clear', 'default', 'second_page', 'trap', 'two_accounts'])
    expect([...kindsOf('repo')].sort()).toEqual(['cannot_show', 'clear', 'default', 'trap'])
  })

  it('ask about a setting in both of its states with opposite answers', () => {
    const app = CASES.filter((c) => c.source === 'app')
    for (const item of ['Is the Teen 15 account currently private?', 'Are push notifications switched off for the Teen 15 account?']) {
      expect(app.filter((c) => c.item === item && c.kinds.includes('clear')).map((c) => c.expected).sort()).toEqual(['no', 'yes'])
    }
  })

  it('expect no answer for every item the source cannot show, and partially or none for every default item without a stated default', () => {
    for (const c of CASES.filter((x) => x.kinds.includes('cannot_show'))) expect(c.expected).toBe('not_settled')
    const defaults = CASES.filter((x) => x.kinds.includes('default') && !x.kinds.includes('second_page'))
    expect(defaults.length).toBeGreaterThanOrEqual(3)
    for (const c of defaults) expect(['partially', 'not_settled']).toContain(c.expected)
  })
})

describe('cases that a shortcut cannot pass', () => {
  const byId = (id: string) => CASES.find((c) => c.id === id) as BenchmarkCase

  it('the stated-default case starts the teen public, so the switch alone gives the wrong answer, and a hedge is not wrong', () => {
    const c = byId('app-private-default-help')
    expect(c.expected).toBe('yes')
    expect(c.app?.state?.privateAccount).toEqual({ teen15: false })
    expect(c.app?.mode?.teenDefaultsHelp).toBe(true)
    expect(c.hedges).toEqual(expect.arrayContaining(['partially', 'not_settled']))
  })

  it('a two-account case that only the adult can settle: the teen settings say no, the app says yes', () => {
    const c = byId('app-message-settings-not-enforced')
    expect(c.kinds).toContain('two_accounts')
    expect(c.expected).toBe('yes')
    expect(c.app?.state).toMatchObject({
      privateAccount: { teen15: false },
      whoCanMessage: { teen15: 'No one' },
      contact: { teen15: { message: 'Friends' } },
    })
    expect(byId('app-message-private-teen').why).toContain('Who can message you: Everyone')
  })

  it('use features of the practice app beyond privacy, push and messaging', () => {
    for (const id of ['app-tag-nobody', 'app-quiet-mode-on', 'app-activity-hidden', 'app-posts-public']) expect(byId(id).source).toBe('app')
  })

  it('name the platform "Social" and accept "no" for the under-16 messaging default', () => {
    expect(PLATFORM).toBe('Social')
    expect(byId('repo-dm-default-teens').alsoAcceptable).toEqual(['no'])
  })

  it('are balanced between yes and no', () => {
    const count = (answer: string) => CASES.filter((c) => c.expected === answer).length
    expect(Math.abs(count('yes') - count('no'))).toBeLessThanOrEqual(2)
  })
})

describe('validateCases', () => {
  const enough = (source: 'app' | 'repo', n: number) => Array.from({ length: n }, (_, i) => valid({ id: `${source}-${i}`, source }))

  it('names each problem it finds', () => {
    const problems = validateCases([
      valid({ id: 'dup' }),
      valid({ id: 'dup' }),
      valid({ id: 'Bad Id' }),
      valid({ id: 'no-why', why: '  ' }),
      valid({ id: 'bad-expected', expected: 'maybe' as never }),
      valid({ id: 'bad-also', alsoAcceptable: ['sometimes' as never] }),
      valid({ id: 'same-also', alsoAcceptable: ['yes'] }),
      valid({ id: 'repo-with-app', app: { mode: { settingsMenu: true } } }),
      valid({ id: 'no-item', item: '' }),
      valid({ id: 'no-kind', kinds: [] }),
      valid({ id: 'bad-hedge', hedges: ['perhaps' as never] }),
      valid({ id: 'hedge-accepted', alsoAcceptable: ['partially'], hedges: ['partially'] }),
    ])
    expect(problems).toEqual(
      expect.arrayContaining([
        'Duplicate case id: dup',
        'Case id "Bad Id" must be lower-case letters, digits and dashes',
        'Case no-why has no why',
        'Case bad-expected expects "maybe", which is not one of yes, no, partially, not_settled',
        'Case bad-also accepts "sometimes", which is not an answer',
        'Case same-also lists its expected answer as also acceptable',
        'Case repo-with-app is a code case with an app setup',
        'Case no-item has no item text',
        'Case no-kind has no kind',
        'Case bad-hedge lists "perhaps" as a hedge, which is not an answer',
        'Case hedge-accepted lists "partially" both as a hedge and as correct',
        'Only 0 app cases; at least 10 are needed',
      ]),
    )
    // Ten code cases were given, which is enough.
    expect(problems.some((p) => p.includes('code cases'))).toBe(false)
  })

  it('asks for at least 10 app cases and 8 code cases', () => {
    expect(validateCases([...enough('app', 10), ...enough('repo', 8)])).toEqual([])
    expect(validateCases([...enough('app', 9), ...enough('repo', 7)])).toEqual([
      'Only 9 app cases; at least 10 are needed',
      'Only 7 code cases; at least 8 are needed',
    ])
  })
})

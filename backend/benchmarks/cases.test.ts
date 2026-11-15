import { describe, expect, it } from 'vitest'
import { CASES, validateCases } from './cases.js'
import { EXPECTED_ANSWERS, type BenchmarkCase } from './types.js'

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

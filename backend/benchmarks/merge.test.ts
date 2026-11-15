import { describe, expect, it } from 'vitest'
import { mergeReports, parseMergeArgs } from './merge.js'
import { buildReport, type ReportMeta } from './report.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'

const APP: BenchmarkCase = { id: 'app-a', source: 'app', category: 'Privacy', item: 'App item?', expected: 'no', alsoAcceptable: [], hedges: ['partially'], why: 'The switch is off.', kinds: ['clear'], app: { state: { privateAccount: { teen15: false } } } }
const REPO: BenchmarkCase = { id: 'repo-b', source: 'repo', category: 'Safety', item: 'Code item?', expected: 'yes', alsoAcceptable: [], why: 'blockUser exists.', kinds: ['clear'] }

function record(c: BenchmarkCase, repeat: number, answer: RepeatRecord['answer']): RepeatRecord {
  return { caseId: c.id, source: c.source, repeat, answer, reason: '', quotes: [{ text: 'q', verified: true }], flags: [], runStatus: 'completed', runError: null, tokens: 100, seconds: 1, steps: c.source === 'app' ? 5 : null, lines: [], excluded: null }
}

function meta(over: Partial<ReportMeta>): ReportMeta {
  return { startedAt: '2026-11-16T10:00:00.000Z', label: 'x', model: 'model-1', repeats: 2, maxTokens: 400_000, commit: 'abc1234', stoppedEarly: null, ...over }
}

/** A report file as the benchmark writes it, from fake results. */
function reportJson(cases: BenchmarkCase[], records: RepeatRecord[], over: Partial<ReportMeta> = {}): string {
  return buildReport({ meta: meta(over), cases, records }).json
}

describe('mergeReports', () => {
  it('combines an app-only and a code-only report into one, keeping every case, record and meta fact', () => {
    const app = reportJson([APP], [record(APP, 1, 'no'), record(APP, 2, 'no')], { startedAt: '2026-11-16T12:00:00.000Z', commit: 'abc1234' })
    const repo = reportJson([REPO], [record(REPO, 1, 'yes')], { startedAt: '2026-11-16T09:00:00.000Z', commit: 'def5678', repeats: 1, stoppedEarly: 'The token cap was reached.' })

    const merged = mergeReports([{ name: 'app.json', text: app }, { name: 'repo.json', text: repo }], 'baseline')
    if (!merged.ok) throw new Error(merged.error)

    expect(merged.cases.map((c) => c.id)).toEqual(['app-a', 'repo-b'])
    expect(merged.cases[0]).toMatchObject({ category: 'Privacy', hedges: ['partially'], app: { state: { privateAccount: { teen15: false } } } })
    expect(merged.records.map((r) => [r.caseId, r.repeat])).toEqual([['app-a', 1], ['app-a', 2], ['repo-b', 1]])
    expect(merged.meta).toMatchObject({
      label: 'baseline',
      model: 'model-1',
      startedAt: '2026-11-16T09:00:00.000Z',
      repeats: 2,
      maxTokens: 800_000,
      commit: 'abc1234, def5678',
      stoppedEarly: 'repo.json: The token cap was reached.',
      mergedFrom: ['app.json', 'repo.json'],
    })
  })

  it('numbers the repeats of a case on from one report to the next', () => {
    const first = reportJson([REPO], [record(REPO, 1, 'yes'), record(REPO, 2, 'yes')])
    const second = reportJson([REPO], [record(REPO, 1, 'no')])
    const merged = mergeReports([{ name: 'a.json', text: first }, { name: 'b.json', text: second }], 'more')
    if (!merged.ok) throw new Error(merged.error)
    expect(merged.records.map((r) => [r.repeat, r.answer])).toEqual([[1, 'yes'], [2, 'yes'], [3, 'no']])
    expect(merged.meta.repeats).toBe(3)
  })

  it('refuses reports of different models, a case that differs between reports, and a file that is not a report', () => {
    const a = reportJson([REPO], [record(REPO, 1, 'yes')])
    const otherModel = reportJson([REPO], [record(REPO, 1, 'yes')], { model: 'model-2' })
    const changed = reportJson([{ ...REPO, expected: 'no' }], [record(REPO, 1, 'yes')])

    expect(mergeReports([{ name: 'a.json', text: a }, { name: 'b.json', text: otherModel }], 'x')).toEqual({
      ok: false,
      error: 'The reports used different models (a.json: model-1; b.json: model-2). Merge only reports of one model.',
    })
    expect(mergeReports([{ name: 'a.json', text: a }, { name: 'c.json', text: changed }], 'x')).toEqual({
      ok: false,
      error: 'Case repo-b is not the same in a.json and c.json (its expected answers differ). Merge only reports of the same cases.',
    })
    expect(mergeReports([{ name: 'a.json', text: a }, { name: 'notes.json', text: '{"hello":1}' }], 'x')).toEqual({
      ok: false,
      error: 'notes.json is not a benchmark report.',
    })
    expect(mergeReports([{ name: 'a.json', text: a }, { name: 'bad.json', text: 'not json' }], 'x')).toEqual({ ok: false, error: 'bad.json is not a benchmark report.' })
  })
})

describe('mergeReports refuses inputs that would count a repeat twice', () => {
  const a = () => reportJson([REPO], [record(REPO, 1, 'yes')])

  it('the same file name twice', () => {
    expect(mergeReports([{ name: 'a.json', text: a() }, { name: 'a.json', text: a() }], 'x')).toEqual({ ok: false, error: 'a.json is given twice.' })
  })

  it('two files with the same content', () => {
    const text = a()
    expect(mergeReports([{ name: 'a.json', text }, { name: 'copy.json', text }], 'x')).toEqual({ ok: false, error: 'a.json and copy.json are the same report.' })
  })

  it('a merged report together with one of the reports it was made from', () => {
    const merged = reportJson([REPO], [record(REPO, 1, 'yes')], { mergedFrom: ['a.json', 'b.json'] })
    expect(mergeReports([{ name: 'a.json', text: a() }, { name: 'baseline.json', text: merged }], 'x')).toEqual({
      ok: false,
      error: 'baseline.json was merged from a.json, which is given too. Give each report once.',
    })
  })
})

describe('mergeReports compares the whole case', () => {
  const base = (c: BenchmarkCase) => reportJson([c], [record(c, 1, 'no')])

  it.each([
    ['app setups', { ...APP, app: { state: { privateAccount: { teen15: true } } } }],
    ['explanations', { ...APP, why: 'Another reason.' }],
    ['kinds', { ...APP, kinds: ['clear', 'trap'] as BenchmarkCase['kinds'] }],
  ])('refuses a case whose %s differ', (what, changed) => {
    const result = mergeReports([{ name: 'a.json', text: base(APP) }, { name: 'b.json', text: base(changed) }], 'x')
    expect(result).toEqual({ ok: false, error: `Case app-a is not the same in a.json and b.json (its ${what} differ). Merge only reports of the same cases.` })
  })
})

describe('parseMergeArgs', () => {
  it('reads the files and the label', () => {
    expect(parseMergeArgs(['a.json', 'b.json', '--label', 'baseline'])).toEqual({ ok: true, files: ['a.json', 'b.json'], label: 'baseline' })
    expect(parseMergeArgs(['a.json', '--label=x', 'b.json'])).toEqual({ ok: true, files: ['a.json', 'b.json'], label: 'x' })
  })

  it('needs two reports at least, and knows only --label', () => {
    expect(parseMergeArgs(['a.json'])).toEqual({ ok: false, error: 'merge needs at least two report files (.json).' })
    expect(parseMergeArgs(['a.json', 'b.json', '--repeats', '2'])).toEqual({ ok: false, error: 'Unknown option for merge: --repeats' })
    expect(parseMergeArgs(['a.json', 'b.json', '--label'])).toEqual({ ok: false, error: '--label needs a name' })
  })
})

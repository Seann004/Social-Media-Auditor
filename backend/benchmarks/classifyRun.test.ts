import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassifyOptions, ClassifyResult, ItemKindAnswer, KindItem } from '../src/features/evidence/itemKinds.js'
import { DEFAULT_CLASSIFY_MAX_TOKENS, buildKindReport, loadSamples, main, parseClassifyArgs, scoreSamples, type LabelledSample } from './classifyRun.js'

const KEY = 'gsk_abcdefghijklmnopqrstuvwxyz123456'

const sample = (text: string, label: LabelledSample['label'], group: LabelledSample['group'] = 'tuning', also?: LabelledSample['also']): LabelledSample => ({
  group,
  text,
  label,
  ...(also ? { also } : {}),
})
const answer = (kind: ItemKindAnswer['kind'], confidence: ItemKindAnswer['confidence'] = 'high', reason = 'Because.'): ItemKindAnswer => ({ kind, reason, confidence })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinds-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the labelled samples', () => {
  it('are read from the one shared JSON file: 79 items in four groups, spanning all four kinds', async () => {
    const samples = await loadSamples()
    expect(samples).toHaveLength(79)
    const count = (group: string) => samples.filter((s) => s.group === group).length
    expect([count('tuning'), count('round_two'), count('round_three'), count('held_out')]).toEqual([37, 15, 15, 12])
    expect(new Set(samples.map((s) => s.label))).toEqual(new Set(['app', 'code', 'both', 'neither']))
    expect(samples[0]).toEqual({ group: 'tuning', text: 'Accounts of users under 16 are private by default.', label: 'app' })
  })

  it('refuses a file with a malformed item, naming the problem', async () => {
    const path = join(dir, 'bad.json')
    await writeFile(path, JSON.stringify({ items: [{ group: 'tuning', text: 'x', label: 'maybe' }] }))
    await expect(loadSamples(path)).rejects.toThrow(/labelled samples.*not valid/i)
  })
})

describe('parseClassifyArgs', () => {
  it('has defaults and reads the options', () => {
    expect(parseClassifyArgs([])).toEqual({ dryRun: false, maxTokens: DEFAULT_CLASSIFY_MAX_TOKENS, label: 'item-kinds', help: false })
    expect(parseClassifyArgs(['--dry-run', '--max-tokens', '5000', '--label', 'baseline'])).toEqual({ dryRun: true, maxTokens: 5000, label: 'baseline', help: false })
  })

  it.each([[['--max-tokens', '0']], [['--max-tokens', 'many']], [['--max-tokens']], [['--what']]])('refuses %j', (argv) => {
    expect(parseClassifyArgs(argv)).toHaveProperty('error')
  })
})

describe('scoreSamples', () => {
  const samples = [
    sample('A', 'app'),
    sample('B', 'code', 'tuning', ['both']),
    sample('C', 'neither', 'held_out'),
    sample('D', 'both', 'held_out'),
    sample('E', 'app', 'held_out'),
  ]
  const answers = new Map<string, ItemKindAnswer>([
    ['s1', answer('app')],
    ['s2', answer('both', 'low')],
    ['s3', answer('code')],
    ['s4', answer('both', 'low')],
  ])

  it('counts agreement at any confidence, an "also" label as fair, and a missing answer against', () => {
    const score = scoreSamples(samples, answers)
    expect(score.all).toMatchObject({ total: 5, agreed: 3, asserted: 2, assertedCorrect: 1 })
    expect(score.all.agreement).toBeCloseTo(0.6)
    expect(score.all.precision).toBeCloseTo(0.5)
    expect(score.all.coverage).toBeCloseTo(0.4)
    expect(score.results.map((r) => r.agrees)).toEqual([true, true, false, true, false])
  })

  it('scores the held-out items on their own', () => {
    const { heldOut } = scoreSamples(samples, answers)
    expect(heldOut).toMatchObject({ total: 3, agreed: 1, asserted: 1, assertedCorrect: 0, precision: 0 })
  })

  it('gives no precision when nothing was asserted', () => {
    expect(scoreSamples([sample('A', 'app')], new Map()).all.precision).toBeNull()
  })

  it('builds a confusion matrix of every answer, and one of the high-confidence answers only', () => {
    const { confusion } = scoreSamples(samples, answers)
    expect(confusion.all.code).toEqual({ app: 0, code: 0, both: 1, neither: 0, none: 0 })
    expect(confusion.all.app).toEqual({ app: 1, code: 0, both: 0, neither: 0, none: 1 })
    expect(confusion.high.code).toEqual({ app: 0, code: 0, both: 0, neither: 0, none: 1 })
    expect(confusion.high.neither).toEqual({ app: 0, code: 1, both: 0, neither: 0, none: 0 })
  })
})

describe('buildKindReport', () => {
  const meta = { label: 'item-kinds', date: '2026-11-16T10:00:00.000Z', model: 'model-a', promptVersion: 'item-kinds-v1', commit: 'abc1234', calls: 1, tokens: 900, failedCalls: 0, stoppedByCap: false, seconds: 3.2, maxTokens: 30000 }

  it('lists the numbers and every disagreement with the item, the label and the AI reason, and never a key', () => {
    const samples = [sample('Teens can pick things.', 'app'), sample('Staff | volunteers are vetted.', 'neither', 'held_out')]
    const answers = new Map([['s1', answer('app')], ['s2', answer('code', 'high', `Leaked ${KEY} here`)]])
    const report = buildKindReport(meta, samples, scoreSamples(samples, answers), [KEY])
    expect(report.markdown).toContain('| All | 2 | 1 of 2 (50.0%)')
    expect(report.markdown).toContain('| held_out | Staff \\| volunteers are vetted. | neither | code | high | Leaked [redacted] here |')
    expect(report.markdown).not.toContain('Teens can pick things.')
    expect(report.markdown).not.toContain(KEY)
    expect(report.json).not.toContain(KEY)
    expect(JSON.parse(report.json).summary.all.agreed).toBe(1)
  })
})

describe('main', () => {
  const io = () => ({ lines: [] as string[], errors: [] as string[], log(l: string) { this.lines.push(l) }, error(l: string) { this.errors.push(l) } })

  it('dry run: needs no key, calls nothing and writes nothing', async () => {
    const out = io()
    const classify = vi.fn()
    const code = await main(['--dry-run'], {}, out, { classify, reportDir: dir })
    expect(code).toBe(0)
    expect(classify).not.toHaveBeenCalled()
    expect(out.lines.join('\n')).toMatch(/79 labelled items.*2 AI calls/s)
    expect(await readdir(dir)).toEqual([])
  })

  it('refuses a real run without a key, and says how to get one', async () => {
    const out = io()
    const code = await main([], {}, out, { classify: vi.fn(), reportDir: dir })
    expect(code).toBe(1)
    expect(out.errors.join('\n')).toMatch(/GROQ_API_KEY is not set/)
  })

  it('runs the classifier on every sample without the cache and under the token cap, and writes the report', async () => {
    const out = io()
    const classify = vi.fn(async (items: KindItem[], _opts: ClassifyOptions): Promise<ClassifyResult> => ({
      answers: new Map(items.map((i) => [i.id, answer('both', 'low')])),
      tokens: 1234,
      failedCalls: 0,
      stoppedByCap: false,
    }))
    const code = await main(['--max-tokens', '9000'], { GROQ_API_KEY: KEY, EVIDENCE_GROQ_MODEL: 'model-b' }, out, {
      classify,
      reportDir: dir,
      now: () => new Date(2026, 10, 16, 12),
      commit: () => 'abc1234',
    })
    expect(code).toBe(0)
    const [items, opts] = classify.mock.calls[0]
    expect(items).toHaveLength(79)
    // The never-tuned held-out items go first, so a run cut short by Groq's limit still measures them.
    expect(items.slice(0, 12).map((i) => i.id)).toEqual(Array.from({ length: 12 }, (_, n) => `s${68 + n}`))
    expect(items.find((i) => i.id === 's1')).toEqual({ id: 's1', text: 'Accounts of users under 16 are private by default.' })
    expect(opts).toMatchObject({ apiKey: KEY, model: 'model-b', cache: null, maxTokens: 9000 })
    const files = (await readdir(dir)).sort()
    expect(files).toEqual(['2026-11-16-item-kinds.json', '2026-11-16-item-kinds.md'])
    const markdown = await readFile(join(dir, files[1]), 'utf8')
    expect(markdown).toContain('model-b')
    expect(markdown).not.toContain(KEY)
    expect(out.lines.join('\n')).not.toContain(KEY)
  })
})

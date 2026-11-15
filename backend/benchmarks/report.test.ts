import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReport, redactSecrets, type ReportMeta } from './report.js'
import { reportBaseName, reserveReportPaths, writeAtomic, writeReport } from './reportFiles.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'

const CASES: BenchmarkCase[] = [
  { id: 'app-a', source: 'app', category: 'Privacy', item: 'Is the Teen 15 account private?', expected: 'no', alsoAcceptable: [], why: 'The switch is off.', kinds: ['clear'] },
  { id: 'repo-b', source: 'repo', category: 'Safety', item: 'Can users block | mute?', expected: 'yes', alsoAcceptable: ['partially'], why: 'blockUser exists.', kinds: ['clear'] },
]

function record(over: Partial<RepeatRecord>): RepeatRecord {
  return {
    caseId: 'app-a',
    source: 'app',
    repeat: 1,
    answer: 'no',
    reason: 'The switch reads Off.',
    quotes: [{ text: 'Private account Off', verified: true }],
    flags: [],
    runStatus: 'completed',
    runError: null,
    tokens: 1_000,
    seconds: 12.5,
    steps: 7,
    lines: ['Step 1 · Teen 15 · opened /settings'],
    ...over,
  }
}

const META: ReportMeta = {
  startedAt: '2026-11-16T10:00:00.000Z',
  label: 'baseline',
  model: 'test-model',
  repeats: 2,
  maxTokens: 400_000,
  commit: 'abc1234',
  stoppedEarly: null,
}

const RECORDS: RepeatRecord[] = [
  record({ repeat: 1, lines: ['Step 1 · Teen 15 · CORRECT-LINE'] }),
  record({ repeat: 2, answer: 'yes', reason: 'The banner says private.', quotes: [{ text: 'Your account is private', verified: true }], lines: ['Step 4 · Teen 15 · WRONG-LINE'] }),
  record({ caseId: 'repo-b', source: 'repo', repeat: 1, answer: 'yes', quotes: [{ text: 'blockUser(', verified: false }], steps: null, lines: ['File src/safety/block.ts, lines 1–20'] }),
  record({ caseId: 'repo-b', source: 'repo', repeat: 2, answer: null, quotes: [], runStatus: 'partial', runError: 'AI daily limit reached; 1 item not checked', steps: null, lines: [], excluded: 'daily_limit' }),
]

describe('buildReport', () => {
  it('has a summary table, a row per case and the step lines of every wrong or unproven result only', () => {
    const { markdown } = buildReport({ meta: META, cases: CASES, records: RECORDS })

    expect(markdown).toContain('# Evidence benchmark: baseline')
    expect(markdown).toMatch(/\| Accuracy \|/)
    expect(markdown).toMatch(/\| Wrong-claim rate \|/)
    expect(markdown).toMatch(/\| Stability \|/)
    expect(markdown).toMatch(/\| app-a \| App \|/)
    expect(markdown).toMatch(/\| repo-b \| Code \|/)
    // A pipe in an item is escaped, so the table keeps its columns.
    expect(markdown).toContain('Can users block \\| mute?')
    expect(markdown).toContain('WRONG-LINE')
    expect(markdown).toContain('File src/safety/block.ts, lines 1–20')
    expect(markdown).not.toContain('CORRECT-LINE')
    expect(markdown).toContain('AI daily limit reached; 1 item not checked')
  })

  it('writes JSON with the meta, the summaries, the case scores and every record', () => {
    const { json } = buildReport({ meta: META, cases: CASES, records: RECORDS })
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.meta).toMatchObject({ label: 'baseline', model: 'test-model', commit: 'abc1234' })
    expect(parsed.summary).toMatchObject({ all: { cases: 2, repeats: 4, wrong: 1, unproven: 1, errors: 1 } })
    expect(parsed.cases).toHaveLength(2)
    expect(parsed.records).toHaveLength(4)
  })

  it('says what the numbers measure: the sources, how simple they are, the case mix and the floors', () => {
    const { markdown } = buildReport({ meta: META, cases: CASES, records: RECORDS })
    expect(markdown).toContain('## What this measures')
    expect(markdown).toContain('platform "Social"')
    expect(markdown).toContain('settingsMenu')
    expect(markdown).toContain('far simpler than a real platform')
    expect(markdown).toContain('Case mix: 1 app case (1 no); 1 code case (1 yes).')
    expect(markdown).toMatch(/\| Floor: always "yes" \| 50% \| 0% \| 100% \|/)
    expect(markdown).toMatch(/\| Floor: always "not settled" \| 0% \| 0% \| 0% \|/)
    expect(markdown).toMatch(/\| Strict accuracy \| 25% \(1 of 4\) \|/)
  })

  it('writes counts and numbers the same way everywhere', () => {
    const one = [record({ repeat: 1, answer: 'yes', tokens: 12_048, steps: 1 })]
    const { markdown } = buildReport({ meta: { ...META, repeats: 1 }, cases: CASES, records: one })
    expect(markdown).toContain('1 repeat per case')
    expect(markdown).toContain('12,048 tokens, 12.5 s, 1 step')
    expect(markdown).not.toMatch(/\b1 (repeats|steps|cases)\b/)
  })

  it('says so when the run stopped early', () => {
    const { markdown } = buildReport({ meta: { ...META, stoppedEarly: 'The token cap of 400,000 was reached.' }, cases: CASES, records: RECORDS })
    expect(markdown).toContain('The token cap of 400,000 was reached.')
  })

  it('drops anything that looks like a key, in the Markdown and in the JSON', () => {
    const leaky = [
      record({
        repeat: 2,
        answer: 'yes',
        reason: 'Failed with key gsk_abcDEF1234567890xyz and Bearer sk-live-abcdefghijklmnopqrstu',
        lines: ['GROQ_API_KEY=gsk_zzzzzzzzzzzzzzzzzzzz', 'SUPABASE_SERVICE_ROLE_KEY: eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlLXZhbHVl'],
        quotes: [{ text: 'the-explicit-secret-value', verified: true }],
      }),
    ]
    const { markdown, json } = buildReport({ meta: META, cases: CASES, records: leaky, secrets: ['the-explicit-secret-value'] })
    for (const text of [markdown, json]) {
      expect(text).not.toMatch(/gsk_/)
      expect(text).not.toMatch(/sk-live/)
      expect(text).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/)
      expect(text).not.toContain('the-explicit-secret-value')
      expect(text).toContain('[redacted]')
    }
    expect(() => JSON.parse(json)).not.toThrow()
  })
})

describe('redactSecrets', () => {
  it('keeps ordinary text as it is', () => {
    const text = 'Step 3 · Adult 30 · opened /u/teen15 → "This account is private"'
    expect(redactSecrets(text)).toBe(text)
  })

  it('redacts Groq keys, bearer tokens, JWTs, secret assignments and the given secrets', () => {
    expect(redactSecrets('key gsk_ABCdef123_-x end')).toBe('key [redacted] end')
    expect(redactSecrets('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer [redacted]')
    expect(redactSecrets('token eyJabcdefghij.eyJklmnopqrs.tuvwxyz012345 here')).toBe('token [redacted] here')
    expect(redactSecrets('EVIDENCE_SECRET_KEY=AAAABBBBCCCC==')).toBe('EVIDENCE_SECRET_KEY=[redacted]')
    expect(redactSecrets('JWT_SECRET: hunter2hunter2')).toBe('JWT_SECRET=[redacted]')
    expect(redactSecrets('it was s3cr3t-value!', ['s3cr3t-value'])).toBe('it was [redacted]!')
  })

  it('redacts a lower-case secret assignment, and never a plain number or an ordinary word', () => {
    expect(redactSecrets('set groq_api_key=abcdef123456 first')).toBe('set groq_api_key=[redacted] first')
    expect(redactSecrets('jwt_secret: hunter2hunter2')).toBe('jwt_secret=[redacted]')
    expect(redactSecrets('MAX_TOKENS=10000000')).toBe('MAX_TOKENS=10000000')
    expect(redactSecrets('EVIDENCE_TOKEN=12345678')).toBe('EVIDENCE_TOKEN=12345678')
    expect(redactSecrets('the monkey: banana; Password: shown as dots')).toBe('the monkey: banana; Password: shown as dots')
  })

  it('ignores given secrets too short to be one', () => {
    expect(redactSecrets('a b c', ['', 'a'])).toBe('a b c')
  })
})

describe('reportBaseName', () => {
  it('is the local date and a safe label', () => {
    expect(reportBaseName(new Date(2026, 10, 6, 23, 30), 'Baseline run #1')).toBe('2026-11-06-baseline-run-1')
    expect(reportBaseName(new Date(2026, 0, 2), '../../etc')).toBe('2026-01-02-etc')
    expect(reportBaseName(new Date(2026, 0, 2), '')).toBe('2026-01-02-run')
  })
})

describe('writeReport', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('writes the .md and .json, and never overwrites an earlier report of the same name', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bench-report-'))
    await writeFile(join(dir, '2026-11-16-baseline.md'), 'earlier')
    const first = await writeReport(join(dir, 'nested'), '2026-11-16-baseline', { markdown: '# one', json: '{}' })
    const again = await writeReport(dir, '2026-11-16-baseline', { markdown: '# two', json: '{"a":1}' })

    expect(await readFile(first.markdownPath, 'utf8')).toBe('# one')
    expect(again.markdownPath).toBe(join(dir, '2026-11-16-baseline-2.md'))
    expect(again.jsonPath).toBe(join(dir, '2026-11-16-baseline-2.json'))
    expect(await readFile(join(dir, '2026-11-16-baseline.md'), 'utf8')).toBe('earlier')
    expect((await readdir(dir)).sort()).toEqual(['2026-11-16-baseline-2.json', '2026-11-16-baseline-2.md', '2026-11-16-baseline.md', 'nested'])
  })

  it('reserves a free name by writing its JSON at once, and rewrites a file atomically, leaving no temporary file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bench-report-'))
    const first = await reserveReportPaths(dir, '2026-11-16-x', '{"records":[]}')
    const second = await reserveReportPaths(dir, '2026-11-16-x', '{"records":[]}')
    expect(first.jsonPath).toBe(join(dir, '2026-11-16-x.json'))
    expect(second.jsonPath).toBe(join(dir, '2026-11-16-x-2.json'))

    await writeAtomic(first.jsonPath, '{"records":[1]}')
    await writeAtomic(first.jsonPath, '{"records":[1,2]}')
    expect(await readFile(first.jsonPath, 'utf8')).toBe('{"records":[1,2]}')
    expect((await readdir(dir)).sort()).toEqual(['2026-11-16-x-2.json', '2026-11-16-x.json'])
  })

  it('survives many writes to one file at once, landing them in the order they were made', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bench-report-'))
    const path = join(dir, 'live.json')
    await Promise.all(Array.from({ length: 25 }, (_, i) => writeAtomic(path, `v${i}`)))
    expect(await readFile(path, 'utf8')).toBe('v24')
    expect(await readdir(dir)).toEqual(['live.json'])
  })
})

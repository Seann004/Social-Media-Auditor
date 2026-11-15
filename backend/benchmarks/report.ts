/**
 * The benchmark report: Markdown for people and JSON for tools, built with no side effects, then
 * written next to each other under a name that never overwrites an earlier report. Everything that
 * goes in is first cleared of anything that looks like a key.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scoreCase, summarise } from './score.js'
import type { BenchmarkCase, CaseScore, CaseSource, Outcome, RepeatRecord, Summary } from './types.js'

export interface ReportMeta {
  /** ISO time the benchmark started. */
  startedAt: string
  label: string
  model: string
  repeats: number
  maxTokens: number
  /** The short commit the benchmark ran on, when known. */
  commit: string | null
  /** Why the benchmark stopped before every repeat ran; null when it ran them all. */
  stoppedEarly: string | null
}

export interface ReportInput {
  meta: ReportMeta
  cases: BenchmarkCase[]
  records: RepeatRecord[]
  /** Exact values that must never appear, such as the API key. */
  secrets?: string[]
}

export interface BuiltReport {
  markdown: string
  json: string
}

const REDACTED = '[redacted]'
/** A given secret shorter than this is not looked for: it would match ordinary words. */
const MIN_SECRET_CHARS = 6
const MAX_LINE_CHARS = 400

const KEY_PATTERNS: readonly [RegExp, string][] = [
  [/gsk_[A-Za-z0-9_-]+/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bBearer\s+[^\s"'`|<>]+/gi, `Bearer ${REDACTED}`],
  [/\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*[=:]\s*[^\s|<>]+/g, `$1=${REDACTED}`],
]

/** Replaces anything that looks like a key, a token or a secret assignment, and every given secret. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_CHARS) out = out.split(secret).join(REDACTED)
  }
  for (const [pattern, replacement] of KEY_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/** A copy with every string redacted. */
function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === 'string') return redactSecrets(value, secrets) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as T
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, secrets)])) as T
  }
  return value
}

const SOURCE_NAMES: Readonly<Record<CaseSource, string>> = { app: 'App', repo: 'Code' }
const OUTCOME_NAMES: Readonly<Record<Outcome, string>> = {
  correct: 'correct',
  wrong: 'wrong',
  not_settled: 'not settled',
  unproven: 'unproven',
  error: 'error',
}

const cell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
const pct = (x: number | null): string => (x === null ? '–' : `${Math.round(x * 100)}%`)
const num = (x: number): string => x.toLocaleString('en-US')
const avg = (x: number | null, digits = 1): string => (x === null ? '–' : x.toFixed(digits))
const answerOf = (a: string | null): string => a ?? '(none)'

interface Scored {
  scores: CaseScore[]
  summaries: Record<'all' | CaseSource, Summary>
}

function scoreAll(cases: BenchmarkCase[], records: RepeatRecord[]): Scored {
  const scores = cases.map((c) => scoreCase(c, records.filter((r) => r.caseId === c.id).sort((a, b) => a.repeat - b.repeat)))
  const of = (source: CaseSource | null): Summary =>
    summarise(
      scores.filter((s) => source === null || s.source === source),
      records.filter((r) => source === null || r.source === source),
    )
  return { scores, summaries: { all: of(null), app: of('app'), repo: of('repo') } }
}

function summaryTable(s: Scored['summaries']): string[] {
  const cols = [s.all, s.app, s.repo]
  const row = (name: string, value: (x: Summary) => string) => `| ${name} | ${cols.map(value).join(' | ')} |`
  return [
    '| Measure | All | App | Code |',
    '| --- | --- | --- | --- |',
    row('Cases', (x) => num(x.cases)),
    row('Repeats', (x) => num(x.repeats)),
    row('Accuracy', (x) => `${pct(x.accuracy)} (${x.correct} of ${x.scored})`),
    row('Coverage', (x) => pct(x.coverage)),
    row('Wrong-claim rate', (x) => `${pct(x.wrongClaimRate)} (${x.wrong} wrong)`),
    row('Stability', (x) => pct(x.stability)),
    row('Not settled', (x) => num(x.notSettled)),
    row('Unproven', (x) => num(x.unproven)),
    row('Errors (no suggestion)', (x) => num(x.errors)),
    row('Average steps', (x) => avg(x.averageSteps)),
    row('Tokens', (x) => num(x.totalTokens)),
    row('Tokens per repeat', (x) => avg(x.averageTokens, 0)),
    row('Seconds', (x) => avg(x.totalSeconds)),
    row('Seconds per repeat', (x) => avg(x.averageSeconds)),
  ]
}

const GLOSSARY = [
  'Accuracy: correct repeats out of those that gave a suggestion. Coverage: the share of those that made a claim (any answer but "not settled").',
  'Wrong-claim rate: wrong claims out of all claims. Stability: cases whose repeats all gave the same answer (unknown with fewer than two answers).',
  'Unproven: the right claim, but none of its quotes was found in what the AI was sent. Error: the run gave no suggestion at all (see the last section).',
]

function caseTable(cases: BenchmarkCase[], scores: CaseScore[]): string[] {
  const rows = scores.map((s) => {
    const c = cases.find((x) => x.id === s.caseId) as BenchmarkCase
    const expected = [s.expected, ...s.alsoAcceptable.map((a) => `or ${a}`)].join(' ')
    const stable = s.stable === null ? '–' : s.stable ? 'yes' : 'no'
    const answers = s.answers.map(answerOf).join(', ') || '(not run)'
    const outcomes = s.outcomes.map((o) => OUTCOME_NAMES[o]).join(', ') || '–'
    return `| ${s.caseId} | ${SOURCE_NAMES[s.source]} | ${cell(c.item)} | ${cell(expected)} | ${answers} | ${outcomes} | ${stable} |`
  })
  return ['| Case | Source | Item | Expected | Answers | Outcomes | Stable |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows]
}

function detail(c: BenchmarkCase, r: RepeatRecord, outcome: Outcome): string[] {
  const quotes = r.quotes.length === 0 ? 'none' : r.quotes.map((q) => `"${q.text}" (${q.verified ? 'found' : 'not found'})`).join('; ')
  const lines = r.lines.length === 0 ? ['    (no lines recorded)'] : r.lines.map((l) => `    ${l.replace(/\r?\n/g, ' ').slice(0, MAX_LINE_CHARS)}`)
  return [
    `### ${c.id} · repeat ${r.repeat} · ${OUTCOME_NAMES[outcome]}`,
    '',
    `- Item: ${c.item}`,
    `- Expected: ${c.expected}. Answered: ${answerOf(r.answer)}.`,
    `- Why expected: ${c.why}`,
    `- Reason given: ${r.reason || '(none)'}`,
    `- Quotes: ${quotes}`,
    `- Flags: ${r.flags.length === 0 ? 'none' : r.flags.join(', ')}`,
    `- Run: ${r.runStatus}, ${num(r.tokens)} tokens, ${r.seconds.toFixed(1)} s${r.steps === null ? '' : `, ${r.steps} steps`}`,
    '',
    c.source === 'app' ? 'Step lines:' : 'Code pieces sent to the judge:',
    '',
    ...lines,
    '',
  ]
}

function details(cases: BenchmarkCase[], records: RepeatRecord[], scores: CaseScore[]): string[] {
  const out: string[] = []
  for (const s of scores) {
    const c = cases.find((x) => x.id === s.caseId) as BenchmarkCase
    const own = records.filter((r) => r.caseId === s.caseId).sort((a, b) => a.repeat - b.repeat)
    own.forEach((r, i) => {
      const outcome = s.outcomes[i]
      if (outcome === 'wrong' || outcome === 'unproven') out.push(...detail(c, r, outcome))
    })
  }
  return out.length === 0 ? ['None.', ''] : out
}

function errorTable(records: RepeatRecord[]): string[] {
  const failed = records.filter((r) => r.answer === null)
  if (failed.length === 0) return ['None.']
  const rows = failed.map((r) => `| ${r.caseId} | ${r.repeat} | ${r.runStatus} | ${cell(r.runError ?? '(no message)')} |`)
  return ['| Case | Repeat | Run status | Message |', '| --- | --- | --- | --- |', ...rows]
}

function markdownOf(meta: ReportMeta, cases: BenchmarkCase[], records: RepeatRecord[], scored: Scored): string {
  const header = `Started ${meta.startedAt} · model \`${meta.model}\` · ${meta.repeats} repeats per case · token cap ${num(meta.maxTokens)} · commit ${meta.commit ?? 'unknown'}`
  return [
    `# Evidence benchmark: ${meta.label}`,
    '',
    header,
    '',
    ...(meta.stoppedEarly === null ? [] : [`> Stopped early: ${meta.stoppedEarly}`, '']),
    '## Summary',
    '',
    ...summaryTable(scored.summaries),
    '',
    ...GLOSSARY.map((g) => `- ${g}`),
    '',
    '## Cases',
    '',
    ...caseTable(cases, scored.scores),
    '',
    '## Wrong and unproven results',
    '',
    ...details(cases, records, scored.scores),
    '## Repeats without a suggestion',
    '',
    ...errorTable(records),
    '',
  ].join('\n')
}

/** The report of a benchmark run. Only the cases given are reported, in their order. */
export function buildReport(input: ReportInput): BuiltReport {
  const secrets = input.secrets ?? []
  const meta = redactDeep(input.meta, secrets)
  const cases = redactDeep(input.cases, secrets)
  const records = redactDeep(input.records, secrets)
  const scored = scoreAll(cases, records)
  const markdown = redactSecrets(markdownOf(meta, cases, records, scored), secrets)
  const caseRows = scored.scores.map((s) => {
    const c = cases.find((x) => x.id === s.caseId) as BenchmarkCase
    return { ...s, item: c.item, why: c.why, kinds: c.kinds }
  })
  const json = JSON.stringify({ meta, summary: scored.summaries, cases: caseRows, records }, null, 2)
  return { markdown, json }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `<local date>-<label>`, with the label cut down to lower-case letters, digits and dashes. */
export function reportBaseName(date: Date, label: string): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return `${day}-${slug || 'run'}`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Writes `<base>.md` and `<base>.json`, or `<base>-2`, `-3` and so on when a report of that name exists. */
export async function writeReport(dir: string, baseName: string, report: BuiltReport): Promise<{ markdownPath: string; jsonPath: string }> {
  await mkdir(dir, { recursive: true })
  for (let n = 1; ; n += 1) {
    const base = n === 1 ? baseName : `${baseName}-${n}`
    const markdownPath = join(dir, `${base}.md`)
    const jsonPath = join(dir, `${base}.json`)
    if ((await exists(markdownPath)) || (await exists(jsonPath))) continue
    await writeFile(markdownPath, report.markdown, { encoding: 'utf8', flag: 'wx' })
    await writeFile(jsonPath, report.json, { encoding: 'utf8', flag: 'wx' })
    return { markdownPath, jsonPath }
  }
}

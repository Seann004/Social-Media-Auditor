/**
 * The benchmark report: Markdown for people and JSON for tools, built with no side effects
 * (reportFiles.ts writes them). Everything that goes in is first cleared of anything that looks like a key.
 */
import { BASE_APP_MODE, PLATFORM } from './cases.js'
import { counted, num, pct, ratioText } from './format.js'
import { REPO_FILES } from './repoFixture.js'
import { constantFloors, scoreCase, summarise } from './score.js'
import {
  EXPECTED_ANSWERS,
  type BenchmarkCase,
  type CaseScore,
  type CaseSource,
  type ExpectedAnswer,
  type Floors,
  type Outcome,
  type RepeatRecord,
  type Summary,
} from './types.js'

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
  /** For a merged report: the report files it was made from. */
  mergedFrom?: string[]
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
const avg = (x: number | null, digits = 1): string => (x === null ? '–' : x.toFixed(digits))
const answerOf = (a: string | null): string => a ?? '(none)'

interface Scored {
  scores: CaseScore[]
  summaries: Record<'all' | CaseSource, Summary>
  floors: Record<'all' | CaseSource, Floors>
}

function scoreAll(cases: BenchmarkCase[], records: RepeatRecord[]): Scored {
  const scores = cases.map((c) => scoreCase(c, records.filter((r) => r.caseId === c.id).sort((a, b) => a.repeat - b.repeat)))
  const of = (source: CaseSource | null): Summary =>
    summarise(
      scores.filter((s) => source === null || s.source === source),
      records.filter((r) => source === null || r.source === source),
    )
  const floorsOf = (source: CaseSource | null): Floors => constantFloors(cases.filter((c) => source === null || c.source === source))
  return {
    scores,
    summaries: { all: of(null), app: of('app'), repo: of('repo') },
    floors: { all: floorsOf(null), app: floorsOf('app'), repo: floorsOf('repo') },
  }
}

function summaryTable({ summaries: s, floors: f }: Scored): string[] {
  const cols = [s.all, s.app, s.repo]
  const floor = (answer: ExpectedAnswer) => `| Floor: always "${ANSWER_NAMES[answer]}" | ${[f.all, f.app, f.repo].map((x) => pct(x[answer])).join(' | ')} |`
  const row = (name: string, value: (x: Summary) => string) => `| ${name} | ${cols.map(value).join(' | ')} |`
  return [
    '| Measure | All | App | Code |',
    '| --- | --- | --- | --- |',
    row('Cases', (x) => num(x.cases)),
    row('Repeats', (x) => num(x.repeats)),
    row('Accuracy', (x) => ratioText(x.accuracy, x.correct, x.scored)),
    row('Strict accuracy', (x) => ratioText(x.strictAccuracy, x.correct, x.repeats)),
    floor('yes'),
    floor('no'),
    floor('not_settled'),
    row('Coverage', (x) => pct(x.coverage)),
    row('Wrong-claim rate', (x) => `${pct(x.wrongClaimRate)} (${num(x.wrong)} wrong)`),
    row('Stability', (x) => pct(x.stability)),
    row('Not settled', (x) => num(x.notSettled)),
    row('Unproven', (x) => num(x.unproven)),
    row('Errors (left out)', (x) => num(x.errors)),
    row('Average steps', (x) => avg(x.averageSteps)),
    row('Tokens', (x) => num(x.totalTokens)),
    row('Tokens per repeat', (x) => (x.averageTokens === null ? '–' : num(Math.round(x.averageTokens)))),
    row('Seconds', (x) => avg(x.totalSeconds)),
    row('Seconds per repeat', (x) => avg(x.averageSeconds)),
  ]
}

const GLOSSARY = [
  'Accuracy: correct repeats out of the repeats that count. Strict accuracy: correct repeats out of all repeats, errors included. Floor: the accuracy a tool would reach by always giving that one answer.',
  'Coverage: the share of counted repeats that made a claim (any answer but "not settled" or a hedge the case allows). Wrong-claim rate: wrong claims out of all claims.',
  'Not settled: no result where a claim was expected, an allowed hedge, or a run that failed to give a suggestion by itself (never correct). Unproven: the right claim, but none of its quotes was found in what the AI was sent.',
  "Error: a repeat left out because the benchmark's token cap or Groq's daily limit stopped it, or it could not run (see the last section). Stability: cases whose repeats all gave the same answer (unknown with fewer than two).",
  "Seconds include Groq's rate-limit waits, so they are not comparable across runs.",
]

const ANSWER_NAMES: Readonly<Record<ExpectedAnswer, string>> = { yes: 'yes', no: 'no', partially: 'partially', not_settled: 'not settled' }

function mixOf(cases: BenchmarkCase[], source: CaseSource): string {
  const own = cases.filter((c) => c.source === source)
  const parts = EXPECTED_ANSWERS.flatMap((a) => {
    const n = own.filter((c) => c.expected === a).length
    return n === 0 ? [] : [`${num(n)} ${ANSWER_NAMES[a]}`]
  })
  const name = counted(own.length, `${source === 'app' ? 'app' : 'code'} case`)
  return parts.length === 0 ? name : `${name} (${parts.join(', ')})`
}

/** What the numbers measure, so that they are not read as the tool's accuracy on a real platform. */
function contextLines(cases: BenchmarkCase[], floors: Floors): string[] {
  const modes = Object.keys(BASE_APP_MODE).join(', ')
  const best = EXPECTED_ANSWERS.reduce((a, b) => ((floors[b] ?? 0) > (floors[a] ?? 0) ? b : a))
  return [
    `- Sources: the practice social app, shown to the AI as the platform "${PLATFORM}", with its ${modes} mode on in every app case (Settings then links each settings page); and a synthetic repository of ${counted(Object.keys(REPO_FILES).length, 'file')} served by a faked GitHub.`,
    '- Both are far simpler than a real platform: a few pages with plain labels, and a few hundred lines of code. The numbers show how the tool does on small, fixed ground, not how accurate it is on a real platform.',
    `- Case mix: ${mixOf(cases, 'app')}; ${mixOf(cases, 'repo')}.`,
    `- Floors: always "yes" would score ${pct(floors.yes)}, always "no" ${pct(floors.no)}, always "not settled" ${pct(floors.not_settled)}. Accuracy means something only well above the highest floor (${pct(floors[best])}, always "${ANSWER_NAMES[best]}").`,
  ]
}

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
    `- Run: ${r.runStatus}, ${counted(r.tokens, 'token')}, ${r.seconds.toFixed(1)} s${r.steps === null ? '' : `, ${counted(r.steps, 'step')}`}`,
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
  const rows = failed.map((r) => {
    const countedAs = r.excluded ? `left out (${r.excluded.replace('_', ' ')})` : 'not settled'
    return `| ${r.caseId} | ${r.repeat} | ${r.runStatus} | ${countedAs} | ${cell(r.runError ?? '(no message)')} |`
  })
  return ['| Case | Repeat | Run status | Counted as | Message |', '| --- | --- | --- | --- | --- |', ...rows]
}

function markdownOf(meta: ReportMeta, cases: BenchmarkCase[], records: RepeatRecord[], scored: Scored): string {
  const header = `Started ${meta.startedAt} · model \`${meta.model}\` · ${counted(meta.repeats, 'repeat')} per case · token cap ${num(meta.maxTokens)} · commit ${meta.commit ?? 'unknown'}`
  return [
    `# Evidence benchmark: ${meta.label}`,
    '',
    header,
    '',
    ...((meta.mergedFrom ?? []).length === 0 ? [] : [`Merged from ${(meta.mergedFrom ?? []).join(', ')}.`, '']),
    ...(meta.stoppedEarly === null ? [] : [`> Stopped early: ${meta.stoppedEarly}`, '']),
    '## What this measures',
    '',
    ...contextLines(cases, scored.floors.all),
    '',
    '## Summary',
    '',
    ...summaryTable(scored),
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
    return { ...s, category: c.category, item: c.item, why: c.why, kinds: c.kinds, hedges: c.hedges ?? [], app: c.app ?? null }
  })
  const json = JSON.stringify({ meta, summary: scored.summaries, cases: caseRows, records }, null, 2)
  return { markdown, json }
}

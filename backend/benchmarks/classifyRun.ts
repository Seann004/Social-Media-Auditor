/**
 * Measures the AI item-kind classifier against the labelled items:
 *   npm run benchmark:classify --prefix backend -- [--dry-run] [--max-tokens N] [--label NAME]
 * It calls the real AI and costs tokens, so it is never part of npm test. classifyMain.ts is the script.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DEFAULT_EVIDENCE_MODEL } from '../src/features/evidence/index.js'
import {
  ITEM_KINDS_MAX_ITEMS_PER_CALL,
  ITEM_KINDS_MAX_OUTPUT_TOKENS,
  ITEM_KINDS_PROMPT_VERSION,
  ITEM_KINDS_SYSTEM_PROMPT,
  classifyItemKinds,
  type ClassifyOptions,
  type ClassifyResult,
  type ItemKind,
  type ItemKindAnswer,
  type KindItem,
} from '../src/features/evidence/itemKinds.js'
import { redactSecrets } from './report.js'
import { reportBaseName, reserveReportPaths, writeAtomic } from './reportFiles.js'

const KINDS = ['app', 'code', 'both', 'neither'] as const
const GROUPS = ['tuning', 'round_two', 'round_three', 'held_out'] as const
export type SampleGroup = (typeof GROUPS)[number]

/** The one copy of the labelled items, shared with the frontend (evidenceKind.samples.ts reads it too). */
export const SAMPLES_PATH = fileURLToPath(new URL('../../frontend/src/features/evidence/evidenceKind.samples.json', import.meta.url))
const DEFAULT_REPORT_DIR = fileURLToPath(new URL('../../docs/testing/benchmarks/', import.meta.url))
export const DEFAULT_CLASSIFY_MAX_TOKENS = 30_000
const DEFAULT_LABEL = 'item-kinds'
const CHARS_PER_TOKEN = 4
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i
const MIN_SECRET_CHARS = 8

const sampleSchema = z.object({
  group: z.enum(GROUPS),
  text: z.string().min(1),
  label: z.enum(KINDS),
  also: z.array(z.enum(KINDS)).optional(),
})
const fileSchema = z.object({ items: z.array(sampleSchema).min(1) })
export type LabelledSample = z.infer<typeof sampleSchema>

export async function loadSamples(path: string = SAMPLES_PATH): Promise<LabelledSample[]> {
  const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
  if (!parsed.success) throw new Error(`The labelled samples in ${path} are not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`)
  return parsed.data.items
}

export interface ClassifyArgs {
  dryRun: boolean
  maxTokens: number
  label: string
  help: boolean
}

export const CLASSIFY_USAGE = `Usage: npm run benchmark:classify --prefix backend -- [options]
  --dry-run         list the items and the planned calls; no key needed, no AI call
  --max-tokens N    never start a call that could pass N tokens in all (default ${DEFAULT_CLASSIFY_MAX_TOKENS})
  --label NAME      names the report file (default ${DEFAULT_LABEL})
  --help            this text`

export function parseClassifyArgs(argv: readonly string[]): ClassifyArgs | { error: string } {
  let args: ClassifyArgs = { dryRun: false, maxTokens: DEFAULT_CLASSIFY_MAX_TOKENS, label: DEFAULT_LABEL, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--dry-run') args = { ...args, dryRun: true }
    else if (flag === '--help') args = { ...args, help: true }
    else if (flag === '--max-tokens' || flag === '--label') {
      const value = argv[i + 1]
      i += 1
      if (value === undefined) return { error: `${flag} needs a value` }
      if (flag === '--label') args = { ...args, label: value }
      else if (!/^\d+$/.test(value) || Number(value) < 1) return { error: '--max-tokens must be a whole number of at least 1' }
      else args = { ...args, maxTokens: Number(value) }
    } else return { error: `Unknown option: ${flag}` }
  }
  return args
}

export interface GroupScore {
  total: number
  /** Items whose answer, at either confidence, is the label or an also-label. */
  agreed: number
  agreement: number
  /** High-confidence answers: the only ones the screen uses. */
  asserted: number
  assertedCorrect: number
  /** Null when nothing was asserted. */
  precision: number | null
  coverage: number
}

type Column = ItemKind | 'none'
export type Confusion = Record<ItemKind, Record<Column, number>>

export interface SampleResult {
  sample: LabelledSample
  answer: ItemKindAnswer | null
  agrees: boolean
}

export interface KindScore {
  results: SampleResult[]
  all: GroupScore
  heldOut: GroupScore
  byGroup: Record<SampleGroup, GroupScore>
  /** Rows are labels; `all` counts every answer, `high` counts low confidence as no answer ("no hint"). */
  confusion: { all: Confusion; high: Confusion }
}

const fairLabels = (s: LabelledSample): ItemKind[] => [s.label, ...(s.also ?? [])]

function groupScore(results: readonly SampleResult[]): GroupScore {
  const total = results.length
  const agreed = results.filter((r) => r.agrees).length
  const high = results.filter((r) => r.answer?.confidence === 'high')
  const assertedCorrect = high.filter((r) => r.agrees).length
  return {
    total,
    agreed,
    agreement: total === 0 ? 0 : agreed / total,
    asserted: high.length,
    assertedCorrect,
    precision: high.length === 0 ? null : assertedCorrect / high.length,
    coverage: total === 0 ? 0 : high.length / total,
  }
}

function confusionOf(results: readonly SampleResult[], highOnly: boolean): Confusion {
  const empty = (): Record<Column, number> => ({ app: 0, code: 0, both: 0, neither: 0, none: 0 })
  const matrix: Confusion = { app: empty(), code: empty(), both: empty(), neither: empty() }
  for (const { sample, answer } of results) {
    const used = answer && (!highOnly || answer.confidence === 'high') ? answer.kind : 'none'
    matrix[sample.label][used] += 1
  }
  return matrix
}

/** Answers are keyed s1, s2, … in sample order, as main sends them. */
export function scoreSamples(samples: readonly LabelledSample[], answers: ReadonlyMap<string, ItemKindAnswer>): KindScore {
  const results = samples.map((sample, i): SampleResult => {
    const answer = answers.get(`s${i + 1}`) ?? null
    return { sample, answer, agrees: answer !== null && fairLabels(sample).includes(answer.kind) }
  })
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, groupScore(results.filter((r) => r.sample.group === g))])) as Record<SampleGroup, GroupScore>
  return {
    results,
    all: groupScore(results),
    heldOut: byGroup.held_out,
    byGroup,
    confusion: { all: confusionOf(results, false), high: confusionOf(results, true) },
  }
}

export interface KindReportMeta {
  label: string
  date: string
  model: string
  promptVersion: string
  commit: string | null
  calls: number
  tokens: number
  failedCalls: number
  stoppedByCap: boolean
  seconds: number
  maxTokens: number
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`
const ratio = (n: number, d: number): string => `${n} of ${d} (${pct(d === 0 ? 0 : n / d)})`
const cell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

function scoreRow(name: string, s: GroupScore): string {
  const precision = s.precision === null ? 'none asserted' : ratio(s.assertedCorrect, s.asserted)
  return `| ${name} | ${s.total} | ${ratio(s.agreed, s.total)} | ${s.asserted} | ${precision} | ${pct(s.coverage)} |`
}

function confusionTable(matrix: Confusion, noneName: string): string[] {
  const head = `| Label \\ AI | app | code | both | neither | ${noneName} |`
  const rows = KINDS.map((k) => `| ${k} | ${matrix[k].app} | ${matrix[k].code} | ${matrix[k].both} | ${matrix[k].neither} | ${matrix[k].none} |`)
  return [head, '|---|---|---|---|---|---|', ...rows]
}

const GROUP_NAME: Readonly<Record<SampleGroup, string>> = {
  tuning: 'Tuning (shaped the old keyword lists)',
  round_two: 'Round two (used to tune the keyword lists)',
  round_three: 'Round three (used to tune the keyword lists)',
  held_out: 'Held out (never used to tune any rule)',
}

function markdownOf(meta: KindReportMeta, score: KindScore): string {
  const disagreements = score.results.filter((r) => !r.agrees)
  const lines = [
    `# Item kinds benchmark: ${meta.label}`,
    '',
    `- Date: ${meta.date}`,
    `- Model: ${meta.model}; prompt version ${meta.promptVersion}${meta.commit ? `; commit ${meta.commit}` : ''}`,
    `- AI calls planned: ${meta.calls}; failed: ${meta.failedCalls}; tokens: ${meta.tokens} (cap ${meta.maxTokens})${meta.stoppedByCap ? '; **stopped by the token cap**' : ''}; ${meta.seconds.toFixed(1)} s`,
    '',
    '**Agreement**: the AI kind, at either confidence, is the label (or an equally fair "also" label); a missing answer counts against. **Precision when asserting**: of the high-confidence answers (the only ones the screen uses), how many are right. **Coverage**: the share of items with a high-confidence answer. The held-out items were never used to tune the old keyword rules, and the AI prompt was not tuned to any of these items.',
    '',
    '## Summary',
    '',
    '| Set | Items | Agreement | Asserted (high) | Precision when asserting | Coverage |',
    '|---|---|---|---|---|---|',
    scoreRow('All', score.all),
    ...GROUPS.map((g) => scoreRow(GROUP_NAME[g], score.byGroup[g])),
    '',
    '## Confusion matrix: every answer',
    '',
    ...confusionTable(score.confusion.all, 'no answer'),
    '',
    '## Confusion matrix: high confidence only (a low-confidence answer is "no hint")',
    '',
    ...confusionTable(score.confusion.high, 'no hint'),
    '',
    `## Disagreements (${disagreements.length})`,
    '',
    '| Set | Item | Label | AI | Confidence | AI reason |',
    '|---|---|---|---|---|---|',
    ...disagreements.map(
      ({ sample, answer }) =>
        `| ${sample.group} | ${cell(sample.text)} | ${fairLabels(sample).join(' or ')} | ${answer?.kind ?? 'no answer'} | ${answer?.confidence ?? '-'} | ${cell(answer?.reason ?? '-')} |`,
    ),
    '',
  ]
  return lines.join('\n')
}

export interface BuiltKindReport {
  markdown: string
  json: string
}

export function buildKindReport(meta: KindReportMeta, _samples: readonly LabelledSample[], score: KindScore, secrets: readonly string[]): BuiltKindReport {
  const data = {
    meta,
    summary: { all: score.all, heldOut: score.heldOut, byGroup: score.byGroup },
    confusion: score.confusion,
    results: score.results.map(({ sample, answer, agrees }) => ({ ...sample, kind: answer?.kind ?? null, confidence: answer?.confidence ?? null, reason: answer?.reason ?? null, agrees })),
  }
  return {
    markdown: redactSecrets(markdownOf(meta, score), secrets),
    json: redactSecrets(`${JSON.stringify(data, null, 2)}\n`, secrets),
  }
}

export interface ClassifyIo {
  log(line: string): void
  error(line: string): void
}

export interface ClassifyDeps {
  /** Defaults to the real classifier with the real AI. */
  classify?: (items: KindItem[], opts: ClassifyOptions) => Promise<ClassifyResult>
  reportDir?: string
  now?: () => Date
  commit?: () => string | null
  samplesPath?: string
}

type Env = Record<string, string | undefined>

const NO_KEY = 'GROQ_API_KEY is not set, so the classifier cannot call the AI. Set it in the environment (or in backend/.env, which is loaded as the server loads it), or use --dry-run.'

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

/** Every environment value whose name looks secret, so a report can never carry one. */
const secretsOf = (env: Env): string[] =>
  Object.entries(env).flatMap(([name, value]) => (SECRET_NAME.test(name) && value && value.length >= MIN_SECRET_CHARS ? [value] : []))

const estimatedTokens = (items: readonly KindItem[]): number => {
  const calls = Math.ceil(items.length / ITEM_KINDS_MAX_ITEMS_PER_CALL)
  const input = Math.ceil((ITEM_KINDS_SYSTEM_PROMPT.length * calls + JSON.stringify(items).length) / CHARS_PER_TOKEN)
  return input + calls * ITEM_KINDS_MAX_OUTPUT_TOKENS
}

export async function main(argv: readonly string[], env: Env, io: ClassifyIo, deps: ClassifyDeps = {}): Promise<number> {
  const args = parseClassifyArgs(argv)
  if ('error' in args) {
    io.error(`${args.error}\n${CLASSIFY_USAGE}`)
    return 1
  }
  if (args.help) {
    io.log(CLASSIFY_USAGE)
    return 0
  }
  const samples = await loadSamples(deps.samplesPath)
  // Ids follow the file's order; the never-tuned held-out items are sent first, so a run that Groq's
  // limit cuts short still measures them.
  const indexed = samples.map((s, i): [LabelledSample, KindItem] => [s, { id: `s${i + 1}`, text: s.text }])
  const items: KindItem[] = [...indexed.filter(([s]) => s.group === 'held_out'), ...indexed.filter(([s]) => s.group !== 'held_out')].map(([, item]) => item)
  const model = env.EVIDENCE_GROQ_MODEL?.trim() || DEFAULT_EVIDENCE_MODEL
  const calls = Math.ceil(items.length / ITEM_KINDS_MAX_ITEMS_PER_CALL)
  io.log(`${items.length} labelled items, ${calls} AI calls of at most ${ITEM_KINDS_MAX_ITEMS_PER_CALL} items, model ${model}.`)
  io.log(`At most about ${estimatedTokens(items)} tokens; the cap is ${args.maxTokens}.`)
  if (args.dryRun) {
    io.log('Dry run: no AI call was made and no report was written.')
    return 0
  }
  const apiKey = env.GROQ_API_KEY?.trim() ?? ''
  if (apiKey === '') {
    io.error(NO_KEY)
    return 1
  }
  const secrets = [apiKey, ...secretsOf(env)]
  const started = Date.now()
  const result = await (deps.classify ?? classifyItemKinds)(items, { apiKey, model, cache: null, maxTokens: args.maxTokens })
  const now = (deps.now ?? (() => new Date()))()
  const meta: KindReportMeta = {
    label: args.label,
    date: now.toISOString(),
    model,
    promptVersion: ITEM_KINDS_PROMPT_VERSION,
    commit: (deps.commit ?? gitCommit)(),
    calls,
    tokens: result.tokens,
    failedCalls: result.failedCalls,
    stoppedByCap: result.stoppedByCap,
    seconds: (Date.now() - started) / 1000,
    maxTokens: args.maxTokens,
  }
  const score = scoreSamples(samples, result.answers)
  const report = buildKindReport(meta, samples, score, secrets)
  const paths = await reserveReportPaths(deps.reportDir ?? DEFAULT_REPORT_DIR, reportBaseName(now, args.label), report.json)
  await writeAtomic(paths.markdownPath, report.markdown)
  const say = (line: string): void => io.log(redactSecrets(line, secrets))
  if (result.failedCalls > 0) say(`${result.failedCalls} AI call(s) failed: their items have no answer and count as disagreements.`)
  if (result.stoppedByCap) say('The token cap stopped the calls: the items not sent have no answer.')
  say(`Agreement: ${ratio(score.all.agreed, score.all.total)}; held out: ${ratio(score.heldOut.agreed, score.heldOut.total)}.`)
  say(`Precision when asserting: ${score.all.precision === null ? 'none asserted' : ratio(score.all.assertedCorrect, score.all.asserted)}; coverage ${pct(score.all.coverage)}.`)
  say(`Report: ${paths.markdownPath} and ${paths.jsonPath}`)
  return 0
}

/**
 * The benchmark's command line, as a function: options, the dry run, the key check, the run and the
 * report. run.ts is the script that calls it. The real pipeline is loaded only for a real run, so a
 * dry run needs no key and loads no browser.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs, USAGE } from './args.js'
import { CASES, validateCases } from './cases.js'
import { createBudget, executeCases, type RunRepeat } from './execute.js'
import { counted, num, pct, ratioText } from './format.js'
import { caseLines, planLines, selectCases } from './plan.js'
import { buildReport, redactSecrets, reportBaseName, writeReport } from './report.js'
import { scoreCase, summarise } from './score.js'

export interface CliIo {
  log(line: string): void
  error(line: string): void
}

/** The real AI and browser behind each repeat. */
export interface Runner {
  runRepeat: RunRepeat
  /** The model the runs use. */
  model: string
  /** Closes what the runner opened (the shared browser). */
  finish(): Promise<void>
}

export interface CliDeps {
  /** Defaults to the real pipeline with the real AI (realRun.ts). */
  runner?: (apiKey: string, requestedModel: string | null) => Promise<Runner>
  /** Defaults to docs/testing/benchmarks at the root of the repository. */
  reportDir?: string
  now?: () => Date
  /** The short commit; null when unknown. */
  commit?: () => string | null
}

type Env = Record<string, string | undefined>

const DEFAULT_REPORT_DIR = fileURLToPath(new URL('../../docs/testing/benchmarks/', import.meta.url))
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i
const MIN_SECRET_CHARS = 8

const NO_KEY = 'GROQ_API_KEY is not set, so the benchmark cannot call the AI. Set it in the environment (or in backend/.env, which is loaded as the server loads it), or use --dry-run to list the cases without a key.'

async function defaultRunner(apiKey: string, requestedModel: string | null): Promise<Runner> {
  const { createRealRunner } = await import('./realRun.js')
  return createRealRunner(apiKey, requestedModel)
}

/** The commit as the report shows it: the short id, flagged when the working tree has uncommitted changes. */
export function commitLabel(sha: string | null, porcelain: string): string | null {
  if (sha === null || sha === '') return null
  return porcelain.trim() === '' ? sha : `${sha} (uncommitted changes)`
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return null
  }
}

function gitCommit(): string | null {
  return commitLabel(git(['rev-parse', '--short', 'HEAD'])?.trim() ?? null, git(['status', '--porcelain']) ?? '')
}

/** The values of every variable whose name looks secret: the report must never contain them. */
function secretValues(env: Env): string[] {
  return Object.entries(env).flatMap(([name, value]) => (SECRET_NAME.test(name) && value !== undefined && value.length >= MIN_SECRET_CHARS ? [value] : []))
}

/** Runs the benchmark command. Returns the exit code: 0 done, 1 cannot run, 2 bad options. Never prints a key. */
export async function main(argv: readonly string[], env: Env, io: CliIo, deps: CliDeps = {}): Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    io.error(parsed.error)
    io.error(USAGE)
    return 2
  }
  const args = parsed.args
  if (args.help) {
    io.log(USAGE)
    return 0
  }
  const problems = validateCases(CASES)
  if (problems.length > 0) {
    problems.forEach((p) => io.error(p))
    return 1
  }
  const selection = selectCases(CASES, args)
  if (!selection.ok) {
    io.error(selection.error)
    return 2
  }
  const cases = selection.cases
  const requestedModel = env.EVIDENCE_GROQ_MODEL?.trim() || null

  if (args.dryRun) {
    io.log('Evidence benchmark, dry run. Nothing was called, and no key is needed.')
    io.log(`Model: ${requestedModel ?? "the server's default (EVIDENCE_GROQ_MODEL is not set)"}`)
    planLines(cases, args.repeats, args.maxTokens).forEach((line) => io.log(line))
    io.log('')
    caseLines(cases).forEach((line) => io.log(line))
    return 0
  }

  const apiKey = env.GROQ_API_KEY?.trim() ?? ''
  if (apiKey === '') {
    io.error(NO_KEY)
    return 1
  }
  const secrets = [apiKey, ...secretValues(env)]
  const say = (line: string) => io.log(redactSecrets(line, secrets))
  const now = deps.now ?? (() => new Date())
  const startedAt = now()

  const runner = await (deps.runner ?? defaultRunner)(apiKey, requestedModel)
  let result
  try {
    say(`Evidence benchmark "${args.label}" with model ${runner.model}.`)
    planLines(cases, args.repeats, args.maxTokens).forEach(say)
    result = await executeCases(cases, args.repeats, createBudget(args.maxTokens), runner.runRepeat, say)
  } finally {
    await runner.finish()
  }

  const meta = {
    startedAt: startedAt.toISOString(),
    label: args.label,
    model: runner.model,
    repeats: args.repeats,
    maxTokens: args.maxTokens,
    commit: (deps.commit ?? gitCommit)(),
    stoppedEarly: result.stoppedEarly,
  }
  const report = buildReport({ meta, cases, records: result.records, secrets })
  const paths = await writeReport(deps.reportDir ?? DEFAULT_REPORT_DIR, reportBaseName(startedAt, args.label), report)

  const scores = cases.map((c) => scoreCase(c, result.records.filter((r) => r.caseId === c.id)))
  const s = summarise(scores, result.records)
  say('')
  say(`Done: ${counted(s.repeats, 'repeat')}, ${counted(s.totalTokens, 'token')}, ${s.totalSeconds.toFixed(0)} s.`)
  say(
    `Accuracy: ${ratioText(s.accuracy, s.correct, s.scored)} · strict ${ratioText(s.strictAccuracy, s.correct, s.repeats)} · coverage ${pct(s.coverage)} · wrong-claim rate ${pct(s.wrongClaimRate)} · stability ${pct(s.stability)} · errors ${num(s.errors)}`,
  )
  if (result.stoppedEarly !== null) say(`Stopped early: ${result.stoppedEarly}`)
  say(`Report: ${paths.markdownPath}`)
  say(`        ${paths.jsonPath}`)
  return 0
}

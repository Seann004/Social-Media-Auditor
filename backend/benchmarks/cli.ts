/**
 * The benchmark's command line, as a function: options, the dry run, the key check, the run and the
 * report, and `merge`. run.ts is the script that calls it. The real pipeline is loaded only for a real
 * run, so a dry run or a merge needs no key and loads no browser.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, USAGE, type BenchmarkArgs } from './args.js'
import { CASES, validateCases } from './cases.js'
import { createBudget, executeCases, type RunRepeat } from './execute.js'
import { counted, num, pct, ratioText } from './format.js'
import { mergeReports, parseMergeArgs } from './merge.js'
import { caseLines, planLines, selectCases } from './plan.js'
import { buildReport, redactSecrets, type ReportMeta } from './report.js'
import { reportBaseName, reserveReportPaths, writeAtomic, writeReport, type ReportPaths } from './reportFiles.js'
import { scoreCase, summarise } from './score.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'

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
  /** Registers what to do on Ctrl+C: run.ts calls the handler on SIGINT, then exits with 130. */
  onInterrupt?: (handler: () => Promise<void>) => void
  /** Writes one report file. Defaults to writeAtomic. */
  writeFile?: (path: string, text: string) => Promise<void>
}

type Env = Record<string, string | undefined>

const DEFAULT_REPORT_DIR = fileURLToPath(new URL('../../docs/testing/benchmarks/', import.meta.url))
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i
const MIN_SECRET_CHARS = 8
/** How long closing the browser may take after Ctrl+C before the process exits anyway. */
const FINISH_ON_INTERRUPT_MS = 5_000
export const INTERRUPTED_EXIT_CODE = 130

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

/** The backend folder: the benchmark and the code it measures. Changes elsewhere do not affect a run. */
const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url))

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: BACKEND_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  } catch {
    return null
  }
}

/** The commit, flagged when anything under backend/ has uncommitted changes. */
export function gitCommit(run: (args: string[]) => string | null = git): string | null {
  return commitLabel(run(['rev-parse', '--short', 'HEAD'])?.trim() ?? null, run(['status', '--porcelain', '--', BACKEND_DIR]) ?? '')
}

/** A number or a switch, such as a limit set in a variable whose name says TOKEN: not a secret. */
const PLAIN_VALUE = /^(?:[\d.,_\s-]+|true|false|on|off|yes|no)$/i

/** The values of the variables whose names and values look secret: the report must never contain them. */
export function secretValues(env: Env): string[] {
  return Object.entries(env).flatMap(([name, value]) =>
    SECRET_NAME.test(name) && value !== undefined && value.length >= MIN_SECRET_CHARS && !PLAIN_VALUE.test(value) ? [value] : [],
  )
}

function printSummary(say: (line: string) => void, cases: BenchmarkCase[], records: RepeatRecord[], stoppedEarly: string | null, paths: ReportPaths): void {
  const scores = cases.map((c) => scoreCase(c, records.filter((r) => r.caseId === c.id)))
  const s = summarise(scores, records)
  say('')
  say(`Done: ${counted(s.repeats, 'repeat')}, ${counted(s.totalTokens, 'token')}, ${s.totalSeconds.toFixed(0)} s.`)
  say(
    `Accuracy: ${ratioText(s.accuracy, s.correct, s.scored)} · strict ${ratioText(s.strictAccuracy, s.correct, s.repeats)} · coverage ${pct(s.coverage)} · wrong-claim rate ${pct(s.wrongClaimRate)} · stability ${pct(s.stability)} · errors ${num(s.errors)}`,
  )
  if (stoppedEarly !== null) say(`Stopped early: ${stoppedEarly}`)
  say(`Report: ${paths.markdownPath}`)
  say(`        ${paths.jsonPath}`)
}

async function mergeCommand(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<number> {
  const parsed = parseMergeArgs(argv)
  if (!parsed.ok) {
    io.error(parsed.error)
    io.error(USAGE)
    return 2
  }
  const seen = new Set<string>()
  for (const file of parsed.files) {
    const full = resolve(file).toLowerCase()
    if (seen.has(full)) {
      io.error(`${basename(file)} is given twice.`)
      return 2
    }
    seen.add(full)
  }
  const inputs = []
  for (const file of parsed.files) {
    try {
      inputs.push({ name: basename(file), text: await readFile(file, 'utf8') })
    } catch {
      io.error(`Could not read ${file}.`)
      return 1
    }
  }
  const merged = mergeReports(inputs, parsed.label)
  if (!merged.ok) {
    io.error(merged.error)
    return 1
  }
  const now = (deps.now ?? (() => new Date()))()
  const report = buildReport({ meta: merged.meta, cases: merged.cases, records: merged.records })
  const paths = await writeReport(deps.reportDir ?? DEFAULT_REPORT_DIR, reportBaseName(now, parsed.label), report)
  io.log(`Merged ${counted(inputs.length, 'report')}: ${merged.meta.mergedFrom?.join(', ')}.`)
  printSummary((line) => io.log(line), merged.cases, merged.records, merged.meta.stoppedEarly, paths)
  return 0
}

async function finishWithin(runner: Runner, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([runner.finish(), new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))])
  clearTimeout(timer)
}

interface RunInput {
  args: BenchmarkArgs
  cases: BenchmarkCase[]
  apiKey: string
  requestedModel: string | null
  env: Env
}

/**
 * The real run. The JSON is written when the run starts and again after every repeat, so a run that
 * dies keeps what it did; on Ctrl+C the partial report is written in full before the process exits.
 */
async function runCommand({ args, cases, apiKey, requestedModel, env }: RunInput, io: CliIo, deps: CliDeps): Promise<number> {
  const secrets = [apiKey, ...secretValues(env)]
  const say = (line: string) => io.log(redactSecrets(line, secrets))
  const startedAt = (deps.now ?? (() => new Date()))()
  const commit = (deps.commit ?? gitCommit)()
  const total = cases.length * args.repeats
  const runner = await (deps.runner ?? defaultRunner)(apiKey, requestedModel)
  const meta = (stoppedEarly: string | null): ReportMeta => ({
    startedAt: startedAt.toISOString(),
    label: args.label,
    model: runner.model,
    repeats: args.repeats,
    maxTokens: args.maxTokens,
    commit,
    stoppedEarly,
  })
  const build = (records: RepeatRecord[], stoppedEarly: string | null) => buildReport({ meta: meta(stoppedEarly), cases, records, secrets })
  const stillRunning = (n: number) => `Still running: ${n} of ${counted(total, 'repeat')} done when this was written.`

  const write = deps.writeFile ?? writeAtomic
  // Every report write goes through one queue, so a Ctrl+C write always lands after any write already
  // started, and a "Still running" write queued before it is skipped once it runs.
  let writes: Promise<void> = Promise.resolve()
  const queued = (job: () => Promise<void>): Promise<void> => {
    const next = writes.then(job)
    writes = next.catch(() => undefined)
    return next
  }
  let done: RepeatRecord[] = []
  let interrupted = false
  const controller = new AbortController()
  try {
    const paths = await reserveReportPaths(deps.reportDir ?? DEFAULT_REPORT_DIR, reportBaseName(startedAt, args.label), build([], stillRunning(0)).json)
    const writeBoth = async (report: { json: string; markdown: string }) => {
      await write(paths.jsonPath, report.json)
      await write(paths.markdownPath, report.markdown)
    }
    deps.onInterrupt?.(async () => {
      if (interrupted) return
      interrupted = true
      controller.abort()
      const report = build(done, `Interrupted (Ctrl+C) after ${done.length} of ${counted(total, 'repeat')}; the repeat in progress was dropped.`)
      await queued(() => writeBoth(report))
      say(`Interrupted. Partial report: ${paths.markdownPath}`)
      await finishWithin(runner, FINISH_ON_INTERRUPT_MS)
    })
    const onRecord = async (records: readonly RepeatRecord[]) => {
      if (interrupted) return
      done = [...records]
      const json = build(done, stillRunning(done.length)).json
      await queued(async () => {
        if (!interrupted) await write(paths.jsonPath, json)
      })
    }
    say(`Evidence benchmark "${args.label}" with model ${runner.model}.`)
    planLines(cases, args.repeats, args.maxTokens).forEach(say)
    const result = await executeCases(cases, args.repeats, createBudget(args.maxTokens), runner.runRepeat, say, { signal: controller.signal, onRecord })
    if (interrupted) {
      await writes
      return INTERRUPTED_EXIT_CODE
    }
    await queued(() => writeBoth(build(result.records, result.stoppedEarly)))
    printSummary(say, cases, result.records, result.stoppedEarly, paths)
    return 0
  } finally {
    await runner.finish()
  }
}

/** Runs the benchmark command. Returns the exit code: 0 done, 1 cannot run, 2 bad options, 130 interrupted. Never prints a key. */
export async function main(argv: readonly string[], env: Env, io: CliIo, deps: CliDeps = {}): Promise<number> {
  if (argv[0] === 'merge') return mergeCommand(argv.slice(1), io, deps)
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
  const requestedModel = env.EVIDENCE_GROQ_MODEL?.trim() || null

  if (args.dryRun) {
    io.log('Evidence benchmark, dry run. Nothing was called, and no key is needed.')
    io.log(`Model: ${requestedModel ?? "the server's default (EVIDENCE_GROQ_MODEL is not set)"}`)
    planLines(selection.cases, args.repeats, args.maxTokens).forEach((line) => io.log(line))
    io.log('')
    caseLines(selection.cases).forEach((line) => io.log(line))
    return 0
  }

  const apiKey = env.GROQ_API_KEY?.trim() ?? ''
  if (apiKey === '') {
    io.error(NO_KEY)
    return 1
  }
  return runCommand({ args, cases: selection.cases, apiKey, requestedModel, env }, io, deps)
}

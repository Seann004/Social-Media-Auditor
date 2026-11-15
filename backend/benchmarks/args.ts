/** The benchmark's command-line options, read with no side effects. */
import type { CaseSource } from './types.js'

export const DEFAULT_REPEATS = 3
export const MAX_REPEATS = 20
export const DEFAULT_MAX_TOKENS = 400_000
export const DEFAULT_LABEL = 'run'

export interface BenchmarkArgs {
  repeats: number
  /** Case ids to run; empty runs every case (of the chosen source). */
  only: string[]
  source: CaseSource | null
  label: string
  dryRun: boolean
  /** No AI call starts once the benchmark has used this many tokens. */
  maxTokens: number
  help: boolean
}

export type ParseResult = { ok: true; args: BenchmarkArgs } | { ok: false; error: string }

export const USAGE = `Usage: npm run benchmark --prefix backend -- [options]

  --repeats N       repeats per case (default ${DEFAULT_REPEATS}, at most ${MAX_REPEATS})
  --only <id>       run only this case; repeat the flag or use commas for more
  --source app|repo run only the app cases or only the code cases
  --label <name>    a name for the report file (default "${DEFAULT_LABEL}")
  --dry-run         list the cases and the estimated AI calls; calls nothing, needs no key
  --max-tokens N    stop starting AI calls after N tokens (default ${DEFAULT_MAX_TOKENS.toLocaleString('en-US')})
  --help            show this help`

const WITH_VALUE = new Set(['--repeats', '--only', '--source', '--label', '--max-tokens'])
const WITHOUT_VALUE = new Set(['--dry-run', '--help', '-h'])

class ArgError extends Error {}

function wholeNumber(value: string, min: number, max: number, message: string): number {
  if (!/^\d+$/.test(value)) throw new ArgError(message)
  const n = Number(value)
  if (n < min || n > max) throw new ArgError(message)
  return n
}

function apply(args: BenchmarkArgs, flag: string, value: string): BenchmarkArgs {
  switch (flag) {
    case '--repeats':
      return { ...args, repeats: wholeNumber(value, 1, MAX_REPEATS, `--repeats must be a whole number from 1 to ${MAX_REPEATS}`) }
    case '--max-tokens':
      return { ...args, maxTokens: wholeNumber(value, 1, Number.MAX_SAFE_INTEGER, '--max-tokens must be a whole number of at least 1') }
    case '--source':
      if (value !== 'app' && value !== 'repo') throw new ArgError('--source must be app or repo')
      return { ...args, source: value }
    case '--label':
      if (value.trim() === '') throw new ArgError('--label needs a name')
      return { ...args, label: value.trim() }
    default: {
      const ids = value.split(',').map((id) => id.trim()).filter((id) => id !== '')
      if (ids.length === 0) throw new ArgError('--only needs a case id')
      return { ...args, only: [...args.only, ...ids] }
    }
  }
}

/** Reads `--flag value` and `--flag=value`. Never throws: a problem comes back as a sentence. */
export function parseArgs(argv: readonly string[]): ParseResult {
  let args: BenchmarkArgs = { repeats: DEFAULT_REPEATS, only: [], source: null, label: DEFAULT_LABEL, dryRun: false, maxTokens: DEFAULT_MAX_TOKENS, help: false }
  try {
    for (let i = 0; i < argv.length; i++) {
      const raw = argv[i]
      const eq = raw.startsWith('--') ? raw.indexOf('=') : -1
      const flag = eq < 0 ? raw : raw.slice(0, eq)
      if (WITHOUT_VALUE.has(flag)) {
        if (eq >= 0) throw new ArgError(`${flag} takes no value`)
        args = flag === '--dry-run' ? { ...args, dryRun: true } : { ...args, help: true }
        continue
      }
      if (!WITH_VALUE.has(flag)) throw new ArgError(`Unknown option: ${raw}`)
      const value: string | undefined = eq < 0 ? argv[i + 1] : raw.slice(eq + 1)
      if (eq < 0) {
        if (value === undefined || value.startsWith('--')) throw new ArgError(`${flag} needs a value`)
        i += 1
      }
      args = apply(args, flag, value ?? '')
    }
  } catch (err) {
    if (err instanceof ArgError) return { ok: false, error: err.message }
    throw err
  }
  return { ok: true, args }
}

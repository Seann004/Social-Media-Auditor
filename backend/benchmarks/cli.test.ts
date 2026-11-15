import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CASES } from './cases.js'
import { commitLabel, main, type CliDeps } from './cli.js'
import type { RunRepeat } from './execute.js'

const KEY = 'gsk_fake_key_for_the_cli_test_0123456789'

let dir: string
let out: string[]
let err: string[]
const io = { log: (line: string) => out.push(line), error: (line: string) => err.push(line) }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bench-cli-'))
  out = []
  err = []
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A runner that must never be asked for: the AI is never reached. */
function noRunner(): CliDeps {
  return { reportDir: dir, runner: vi.fn(async () => { throw new Error('the AI must not be reached') }) }
}

describe('--dry-run', () => {
  it('works with no key: lists every case and the estimated AI calls, calls nothing and writes nothing', async () => {
    const deps = noRunner()
    const code = await main(['--dry-run'], {}, io, deps)
    const text = out.join('\n')

    expect(code).toBe(0)
    expect(err).toEqual([])
    for (const c of CASES) expect(text).toContain(c.id)
    expect(text).toContain(`${CASES.length} cases`)
    expect(text).toMatch(/Estimated AI calls: about [\d,]+, at most [\d,]+/)
    expect(text).toMatch(/Nothing was called/)
    expect(deps.runner).not.toHaveBeenCalled()
    expect(await readdir(dir)).toEqual([])
  })

  it('lists only the chosen cases, and says when the estimate is over the token cap', async () => {
    await main(['--dry-run', '--source', 'repo', '--repeats', '1'], {}, io, noRunner())
    const text = out.join('\n')
    expect(text).toContain('repo-block')
    expect(text).not.toContain('app-private-on')
    expect(text).toContain('1 repeat per case')

    out = []
    await main(['--dry-run', '--max-tokens', '1000'], {}, io, noRunner())
    expect(out.join('\n')).toMatch(/more than the token cap of 1,000/)
  })

  it('never prints a key that is set', async () => {
    await main(['--dry-run'], { GROQ_API_KEY: KEY, EVIDENCE_GROQ_MODEL: 'some-model' }, io, noRunner())
    expect(out.join('\n')).not.toContain(KEY)
    expect(out.join('\n')).toContain('some-model')
  })
})

describe('commitLabel', () => {
  it('flags a working tree with uncommitted changes', () => {
    expect(commitLabel('abc1234', '')).toBe('abc1234')
    expect(commitLabel('abc1234', ' M backend/benchmarks/cases.ts\n')).toBe('abc1234 (uncommitted changes)')
    expect(commitLabel(null, ' M x')).toBeNull()
  })
})

describe('main', () => {
  it('refuses a real run without GROQ_API_KEY, pointing to --dry-run, and calls nothing', async () => {
    const deps = noRunner()
    expect(await main(['--only', 'repo-block'], {}, io, deps)).toBe(1)
    expect(err.join('\n')).toMatch(/GROQ_API_KEY is not set/)
    expect(err.join('\n')).toMatch(/--dry-run/)
    expect(deps.runner).not.toHaveBeenCalled()
  })

  it('refuses an unknown case id and bad options with the usage', async () => {
    expect(await main(['--dry-run', '--only', 'no-such-case'], {}, io, noRunner())).toBe(2)
    expect(err.join('\n')).toContain('Unknown case id: no-such-case')
    err = []
    expect(await main(['--repeats', 'many'], {}, io, noRunner())).toBe(2)
    expect(err.join('\n')).toContain('--repeats must be a whole number')
    expect(err.join('\n')).toContain('Usage:')
  })

  it('shows the usage for --help', async () => {
    expect(await main(['--help'], {}, io, noRunner())).toBe(0)
    expect(out.join('\n')).toContain('--max-tokens N')
  })

  it('runs the chosen cases with the runner, writes the report without the key and prints the summary', async () => {
    const runRepeat: RunRepeat = async (c, repeat, budget) => {
      budget.charge(1_000)
      return {
        caseId: c.id,
        source: c.source,
        repeat,
        answer: 'yes',
        reason: `The AI was called with ${KEY}`,
        quotes: [{ text: 'export function blockUser(', verified: true }],
        flags: [],
        runStatus: 'completed',
        runError: null,
        tokens: 1_000,
        seconds: 2,
        steps: null,
        lines: ['File src/safety/block.ts, lines 1–17'],
      }
    }
    const finish = vi.fn(async () => undefined)
    const runner = vi.fn(async () => ({ runRepeat, model: 'real-model', finish }))
    const deps: CliDeps = { reportDir: dir, runner, now: () => new Date(2026, 10, 16, 9, 0), commit: () => 'abc1234' }

    const code = await main(['--only', 'repo-block,repo-report-post', '--repeats', '2', '--label', 'Smoke'], { GROQ_API_KEY: KEY }, io, deps)

    expect(code).toBe(0)
    expect(runner).toHaveBeenCalledWith(KEY, null)
    expect(finish).toHaveBeenCalledTimes(1)
    expect((await readdir(dir)).sort()).toEqual(['2026-11-16-smoke.json', '2026-11-16-smoke.md'])
    const markdown = await readFile(join(dir, '2026-11-16-smoke.md'), 'utf8')
    const json = await readFile(join(dir, '2026-11-16-smoke.json'), 'utf8')
    expect(markdown).toContain('model `real-model`')
    expect(markdown).toContain('commit abc1234')
    expect(JSON.parse(json).records).toHaveLength(4)
    for (const text of [markdown, json, out.join('\n'), err.join('\n')]) expect(text).not.toContain(KEY)
    expect(out.join('\n')).toMatch(/Accuracy: 100% \(4 of 4\) · strict 100% \(4 of 4\)/)
    expect(out.join('\n')).toContain('2026-11-16-smoke.md')
  })

  it('still writes the report and closes the browser when the cap stops the run early', async () => {
    const runRepeat: RunRepeat = async (c, repeat, budget) => {
      budget.charge(600)
      return { caseId: c.id, source: c.source, repeat, answer: 'not_settled', reason: '', quotes: [], flags: [], runStatus: 'completed', runError: null, tokens: 600, seconds: 1, steps: null, lines: [] }
    }
    const finish = vi.fn(async () => undefined)
    const deps: CliDeps = { reportDir: dir, runner: async () => ({ runRepeat, model: 'm', finish }), now: () => new Date(2026, 10, 16), commit: () => null }
    const code = await main(['--source', 'repo', '--max-tokens', '1000'], { GROQ_API_KEY: KEY }, io, deps)
    expect(code).toBe(0)
    expect(finish).toHaveBeenCalledTimes(1)
    expect(out.join('\n')).toMatch(/Stopped early: The token cap of 1,000 tokens was reached/)
    expect(await readdir(dir)).toHaveLength(2)
  })
})

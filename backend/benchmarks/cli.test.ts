import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CASES } from './cases.js'
import { commitLabel, main, type CliDeps } from './cli.js'
import type { RunRepeat } from './execute.js'
import { buildReport } from './report.js'
import { writeAtomic } from './reportFiles.js'

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

  it('writes the JSON after every repeat, so a run that dies keeps what it did', async () => {
    const jsonPath = join(dir, '2026-11-16-live.json')
    const seenBefore: number[] = []
    const runRepeat: RunRepeat = async (c, repeat) => {
      const before = JSON.parse(await readFile(jsonPath, 'utf8')) as { records: unknown[]; meta: { stoppedEarly: string } }
      seenBefore.push(before.records.length)
      if (before.records.length > 0) expect(before.meta.stoppedEarly).toMatch(/^Still running: 1 of 2 repeats done/)
      return { caseId: c.id, source: c.source, repeat, answer: 'yes', reason: '', quotes: [{ text: 'q', verified: true }], flags: [], runStatus: 'completed', runError: null, tokens: 10, seconds: 1, steps: null, lines: [] }
    }
    const deps: CliDeps = { reportDir: dir, runner: async () => ({ runRepeat, model: 'm', finish: async () => undefined }), now: () => new Date(2026, 10, 16), commit: () => null }
    expect(await main(['--only', 'repo-block,repo-min-age', '--repeats', '1', '--label', 'live'], { GROQ_API_KEY: KEY }, io, deps)).toBe(0)
    expect(seenBefore).toEqual([0, 1])
    const final = JSON.parse(await readFile(jsonPath, 'utf8')) as { records: unknown[]; meta: { stoppedEarly: string | null } }
    expect(final.records).toHaveLength(2)
    expect(final.meta.stoppedEarly).toBeNull()
    expect((await readdir(dir)).sort()).toEqual(['2026-11-16-live.json', '2026-11-16-live.md'])
  })

  it('on Ctrl+C writes the partial report, drops the repeat in progress, closes the browser and exits with 130', async () => {
    let interrupt: (() => Promise<void>) | null = null
    let calls = 0
    const runRepeat: RunRepeat = async (c, repeat) => {
      calls += 1
      if (calls === 2) await interrupt?.()
      return { caseId: c.id, source: c.source, repeat, answer: 'yes', reason: '', quotes: [{ text: 'q', verified: true }], flags: [], runStatus: 'completed', runError: null, tokens: 10, seconds: 1, steps: null, lines: [] }
    }
    const finish = vi.fn(async () => undefined)
    const deps: CliDeps = {
      reportDir: dir,
      runner: async () => ({ runRepeat, model: 'm', finish }),
      now: () => new Date(2026, 10, 16),
      commit: () => null,
      onInterrupt: (handler) => {
        interrupt = handler
      },
    }
    expect(await main(['--source', 'repo', '--repeats', '1', '--label', 'cut'], { GROQ_API_KEY: KEY }, io, deps)).toBe(130)
    expect(calls).toBe(2)
    expect(finish).toHaveBeenCalled()
    const markdown = await readFile(join(dir, '2026-11-16-cut.md'), 'utf8')
    const json = JSON.parse(await readFile(join(dir, '2026-11-16-cut.json'), 'utf8')) as { records: unknown[] }
    expect(markdown).toContain('> Stopped early: Interrupted (Ctrl+C) after 1 of 10 repeats; the repeat in progress was dropped.')
    expect(json.records).toHaveLength(1)
  })

  it('a Ctrl+C during a "Still running" write is written after it, so the partial report is the last word', async () => {
    let interrupt: (() => Promise<void>) | null = null
    const runRepeat: RunRepeat = async (c, repeat) => ({ caseId: c.id, source: c.source, repeat, answer: 'yes', reason: '', quotes: [{ text: 'q', verified: true }], flags: [], runStatus: 'completed', runError: null, tokens: 10, seconds: 1, steps: null, lines: [] })
    // A slow disk: the "Still running" write after the first repeat lets Ctrl+C in before it lands.
    const slowWrite = async (path: string, text: string) => {
      if (text.includes('Still running: 1 of')) {
        void interrupt?.()
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await writeAtomic(path, text)
    }
    const deps: CliDeps = {
      reportDir: dir,
      runner: async () => ({ runRepeat, model: 'm', finish: async () => undefined }),
      now: () => new Date(2026, 10, 16),
      commit: () => null,
      writeFile: slowWrite,
      onInterrupt: (handler) => {
        interrupt = handler
      },
    }
    expect(await main(['--source', 'repo', '--repeats', '1', '--label', 'race'], { GROQ_API_KEY: KEY }, io, deps)).toBe(130)
    const json = JSON.parse(await readFile(join(dir, '2026-11-16-race.json'), 'utf8')) as { meta: { stoppedEarly: string }; records: unknown[] }
    expect(json.meta.stoppedEarly).toMatch(/^Interrupted \(Ctrl\+C\) after 1 of 10 repeats/)
    expect(json.records).toHaveLength(1)
    expect(await readFile(join(dir, '2026-11-16-race.md'), 'utf8')).toContain('Interrupted (Ctrl+C) after 1 of 10 repeats')
  })

  it('merges reports into one with "merge", without a key and without calling the AI', async () => {
    const write = async (name: string, ids: string[], answer: 'yes' | 'no') => {
      const cases = CASES.filter((c) => ids.includes(c.id))
      const records = cases.map((c) => ({ caseId: c.id, source: c.source, repeat: 1, answer, reason: '', quotes: [{ text: 'q', verified: true }], flags: [], runStatus: 'completed', runError: null, tokens: 10, seconds: 1, steps: null, lines: [], excluded: null }))
      const meta = { startedAt: '2026-11-16T10:00:00.000Z', label: name, model: 'm', repeats: 1, maxTokens: 1_000, commit: 'abc1234', stoppedEarly: null }
      const path = join(dir, `${name}.json`)
      await writeFile(path, buildReport({ meta, cases, records }).json)
      return path
    }
    const app = await write('app-only', ['app-private-off', 'app-push-on'], 'no')
    const repo = await write('repo-only', ['repo-teen-ads'], 'no')
    const deps = { ...noRunner(), now: () => new Date(2026, 10, 17) }

    expect(await main(['merge', app, repo, '--label', 'Baseline'], {}, io, deps)).toBe(0)
    expect(deps.runner).not.toHaveBeenCalled()
    const merged = JSON.parse(await readFile(join(dir, '2026-11-17-baseline.json'), 'utf8')) as { records: unknown[]; meta: { mergedFrom: string[] } }
    expect(merged.records).toHaveLength(3)
    expect(merged.meta.mergedFrom).toEqual(['app-only.json', 'repo-only.json'])
    const markdown = await readFile(join(dir, '2026-11-17-baseline.md'), 'utf8')
    expect(markdown).toContain('Merged from app-only.json, repo-only.json')
    expect(out.join('\n')).toMatch(/Accuracy: 100% \(3 of 3\)/)

    err = []
    expect(await main(['merge', app], {}, io, deps)).toBe(2)
    expect(err.join('\n')).toContain('merge needs at least two report files')
    expect(await main(['merge', app, join(dir, 'missing.json')], {}, io, deps)).toBe(1)
    expect(err.join('\n')).toContain('Could not read')
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

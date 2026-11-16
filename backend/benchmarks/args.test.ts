import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_TOKENS, DEFAULT_REPEATS, MAX_REPEATS, parseArgs } from './args.js'

describe('parseArgs', () => {
  it('has defaults: 3 repeats, every case, label "run", a cap of 400 000 tokens', () => {
    expect(DEFAULT_REPEATS).toBe(3)
    expect(DEFAULT_MAX_TOKENS).toBe(400_000)
    expect(parseArgs([])).toEqual({
      ok: true,
      args: { repeats: 3, only: [], source: null, label: 'run', dryRun: false, maxTokens: 400_000, help: false },
    })
  })

  it('reads every flag, in "--flag value" and "--flag=value" form', () => {
    const parsed = parseArgs(['--repeats', '5', '--only', 'app-a', '--only=repo-b,repo-c', '--source=repo', '--label', 'after fix', '--dry-run', '--max-tokens', '120000'])
    expect(parsed).toEqual({
      ok: true,
      args: { repeats: 5, only: ['app-a', 'repo-b', 'repo-c'], source: 'repo', label: 'after fix', dryRun: true, maxTokens: 120_000, help: false },
    })
  })

  it('reads --help and -h', () => {
    expect(parseArgs(['--help'])).toMatchObject({ ok: true, args: { help: true } })
    expect(parseArgs(['-h'])).toMatchObject({ ok: true, args: { help: true } })
  })

  it.each([
    [['--repeats', '0'], `--repeats must be a whole number from 1 to ${MAX_REPEATS}`],
    [['--repeats', '2.5'], `--repeats must be a whole number from 1 to ${MAX_REPEATS}`],
    [['--repeats', String(MAX_REPEATS + 1)], `--repeats must be a whole number from 1 to ${MAX_REPEATS}`],
    [['--repeats'], '--repeats needs a value'],
    [['--repeats', '--dry-run'], '--repeats needs a value'],
    [['--max-tokens', 'lots'], '--max-tokens must be a whole number of at least 1'],
    [['--max-tokens', '0'], '--max-tokens must be a whole number of at least 1'],
    [['--source', 'web'], '--source must be app or repo'],
    [['--only', ''], '--only needs a case id'],
    [['--label', '  '], '--label needs a name'],
    [['--dry-run=yes'], '--dry-run takes no value'],
    [['--verbose'], 'Unknown option: --verbose'],
    [['stray'], 'Unknown option: stray'],
  ])('refuses %j with a clear message', (argv, message) => {
    expect(parseArgs(argv)).toEqual({ ok: false, error: message })
  })
})

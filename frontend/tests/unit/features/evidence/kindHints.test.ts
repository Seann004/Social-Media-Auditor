import { describe, expect, it } from 'vitest'
import { KIND_LABEL, betterSourceHint, fitsSource } from '../../../../src/features/evidence/kindHints'

describe('the chip and the better-source hint', () => {
  it('labels each kind', () => {
    expect(KIND_LABEL).toEqual({ app: 'App', code: 'Code', both: 'App + Code', neither: 'Policy / process' })
  })

  it.each([
    ['app', 'app', true],
    ['app', 'repo', false],
    ['code', 'repo', true],
    ['code', 'app', false],
    ['both', 'app', true],
    ['both', 'repo', true],
    ['neither', 'app', false],
    ['neither', 'repo', false],
  ] as const)('a %s item fits the %s source: %s', (kind, source, fits) => {
    expect(fitsSource(kind, source)).toBe(fits)
  })

  it.each([
    ['code', 'app', 'Better checked with Code'],
    ['app', 'repo', 'Better checked with the App'],
    ['neither', 'app', "Usually can't be shown by an app or code"],
    ['neither', 'repo', "Usually can't be shown by an app or code"],
    ['app', 'app', null],
    ['code', 'repo', null],
    ['both', 'app', null],
    ['both', 'repo', null],
  ] as const)('a %s item on the %s source hints %s', (kind, source, hint) => {
    expect(betterSourceHint(kind, source)).toBe(hint)
  })
})

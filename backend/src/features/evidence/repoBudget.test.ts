import { describe, expect, it } from 'vitest'
import { estimateTokens } from './assess.js'
import { cutToFit, withinBudget } from './repoBudget.js'
import type { PieceDraft } from './repoTypes.js'

const textOf = (d: PieceDraft) => `File ${d.path}, lines ${d.startLine}\u2013${d.endLine}\n${d.code}`

describe('withinBudget', () => {
  it('keeps entries in order while they fit, skipping one that does not', () => {
    expect(withinBudget([5, 4, 3, 1], (n) => n, 9)).toEqual([5, 4])
    expect(withinBudget([5, 6, 3], (n) => n, 9)).toEqual([5, 3])
    expect(withinBudget([5, 4], (n) => n, 9, 5)).toEqual([4])
  })
})

describe('cutToFit', () => {
  it('drops lines from the end, and the end line with them, until the text fits', () => {
    const draft: PieceDraft = { path: 'src/a.ts', startLine: 10, endLine: 13, code: ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40)].join('\n') }
    const cut = cutToFit(draft, textOf, 30)
    expect(estimateTokens(textOf(cut))).toBeLessThanOrEqual(30)
    expect(cut.startLine).toBe(10)
    expect(cut.endLine).toBe(11)
    expect(cut.code).toBe(['a'.repeat(40), 'b'.repeat(40)].join('\n'))
  })
  it('cuts a single long line by characters', () => {
    const draft: PieceDraft = { path: 'src/a.ts', startLine: 1, endLine: 1, code: 'y'.repeat(30_000) }
    const cut = cutToFit(draft, textOf, 100)
    expect(estimateTokens(textOf(cut))).toBeLessThanOrEqual(100)
    expect(cut.endLine).toBe(1)
    expect(cut.code.length).toBeGreaterThan(0)
  })
  it('leaves a draft that fits as it is', () => {
    const draft: PieceDraft = { path: 'a.ts', startLine: 1, endLine: 1, code: 'x' }
    expect(cutToFit(draft, textOf, 100)).toEqual(draft)
  })
})

import { describe, expect, it } from 'vitest'
import { HELD_OUT_SAMPLES, KIND_SAMPLES, ROUND_THREE_SAMPLES, ROUND_TWO_SAMPLES, TUNING_SAMPLES } from './evidenceKind.samples'

const KINDS = ['app', 'code', 'both', 'neither']

describe('the labelled item kinds', () => {
  it('has 79 items in four groups, spanning all four kinds, with no item twice', () => {
    expect(KIND_SAMPLES).toHaveLength(79)
    expect([TUNING_SAMPLES.length, ROUND_TWO_SAMPLES.length, ROUND_THREE_SAMPLES.length, HELD_OUT_SAMPLES.length]).toEqual([37, 15, 15, 12])
    expect(new Set(KIND_SAMPLES.map((s) => s.label))).toEqual(new Set(KINDS))
    expect(new Set(KIND_SAMPLES.map((s) => s.text)).size).toBe(KIND_SAMPLES.length)
  })

  it('uses only the four kinds, and an "also" label is never the label itself', () => {
    for (const s of KIND_SAMPLES) {
      expect(KINDS).toContain(s.label)
      for (const other of s.also ?? []) {
        expect(KINDS).toContain(other)
        expect(other).not.toBe(s.label)
      }
    }
  })
})

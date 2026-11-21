import { describe, expect, it } from 'vitest'
import { buildCalibration, levelOf, type DecidedPair } from './calibration.js'

const decided = (relation: 'equivalent' | 'partial', confidence: number | null, status: 'confirmed' | 'rejected'): DecidedPair => ({ relation, confidence, status })
const many = (n: number, relation: 'equivalent' | 'partial', confidence: number, status: 'confirmed' | 'rejected') =>
  Array.from({ length: n }, () => decided(relation, confidence, status))

describe('levelOf', () => {
  it('splits at 80% and 50%, and treats a missing score as low', () => {
    expect(levelOf(0.8)).toBe('high')
    expect(levelOf(0.79)).toBe('medium')
    expect(levelOf(0.5)).toBe('medium')
    expect(levelOf(0.49)).toBe('low')
    expect(levelOf(null)).toBe('low')
    expect(levelOf(Number.NaN)).toBe('low')
  })
})

describe('buildCalibration', () => {
  it('keeps the AI score when there are no decisions', () => {
    const cal = buildCalibration([])
    expect(cal.learn('equivalent', 0.92)).toEqual({ score: 0.92, from: 0 })
    expect(cal.decided).toBe(0)
  })

  it('returns no score for a pair without an AI score', () => {
    expect(buildCalibration(many(10, 'equivalent', 0.9, 'confirmed')).learn('equivalent', null)).toEqual({ score: null, from: 0 })
  })

  it('moves the score down when pairs at that confidence were mostly rejected', () => {
    const cal = buildCalibration([...many(2, 'equivalent', 0.92, 'confirmed'), ...many(18, 'equivalent', 0.92, 'rejected')])
    const learned = cal.learn('equivalent', 0.92)
    expect(learned.from).toBe(20)
    // (2 + 4 * 0.92) / (20 + 4) = 0.2367
    expect(learned.score).toBe(0.24)
  })

  it('moves the score up when pairs at that confidence were always approved', () => {
    const cal = buildCalibration(many(30, 'partial', 0.62, 'confirmed'))
    // (30 + 4 * 0.62) / 34 = 0.9627
    expect(cal.learn('partial', 0.62).score).toBe(0.96)
  })

  it('trusts the AI score more when the group has few decisions', () => {
    const few = buildCalibration(many(1, 'equivalent', 0.9, 'rejected')).learn('equivalent', 0.9)
    const lots = buildCalibration(many(40, 'equivalent', 0.9, 'rejected')).learn('equivalent', 0.9)
    expect(few.score!).toBeGreaterThan(lots.score!)
    expect(few.score!).toBeGreaterThan(0.6)
  })

  it('keeps relations and bands apart', () => {
    const cal = buildCalibration([...many(20, 'equivalent', 0.9, 'rejected'), ...many(20, 'partial', 0.9, 'confirmed')])
    expect(cal.learn('equivalent', 0.9).score!).toBeLessThan(0.3)
    expect(cal.learn('partial', 0.9).score!).toBeGreaterThan(0.9)
    expect(cal.learn('equivalent', 0.55)).toEqual({ score: 0.55, from: 0 })
  })

  it('counts a confidence of exactly 1 in the top band', () => {
    const cal = buildCalibration(many(10, 'equivalent', 1, 'rejected'))
    expect(cal.learn('equivalent', 0.95).from).toBe(10)
    expect(cal.bands[0]).toMatchObject({ fromPercent: 90, toPercent: 100 })
  })

  it('ignores decisions without a confidence', () => {
    const cal = buildCalibration([decided('equivalent', null, 'confirmed'), ...many(3, 'equivalent', 0.9, 'confirmed')])
    expect(cal.decided).toBe(3)
  })

  it('summarises approvals and rejections, and the approval rate per band', () => {
    const cal = buildCalibration([...many(3, 'equivalent', 0.85, 'confirmed'), ...many(1, 'equivalent', 0.85, 'rejected'), ...many(2, 'partial', 0.55, 'rejected')])
    expect(cal).toMatchObject({ decided: 6, approved: 3, rejected: 3 })
    expect(cal.bands).toEqual([
      { relation: 'equivalent', fromPercent: 80, toPercent: 89, decided: 4, approved: 3, approvalRate: 0.75 },
      { relation: 'partial', fromPercent: 50, toPercent: 59, decided: 2, approved: 0, approvalRate: 0 },
    ])
  })

  it('stays between 0 and 1', () => {
    const cal = buildCalibration(many(5, 'equivalent', 0.3, 'confirmed'))
    expect(cal.learn('equivalent', 1.7).score).toBeLessThanOrEqual(1)
    expect(cal.learn('equivalent', -2).score).toBeGreaterThanOrEqual(0)
  })
})

describe('a pair that is one of the examples', () => {
  it('is scored without its own decision', () => {
    const cal = buildCalibration(many(5, 'equivalent', 0.9, 'confirmed'))
    const withOwn = cal.learn('equivalent', 0.9)
    const without = cal.learn('equivalent', 0.9, 'confirmed')
    expect(withOwn.from).toBe(5)
    expect(without.from).toBe(4)
    expect(without.score!).toBeLessThan(withOwn.score!)
  })

  it('keeps the AI score when it is the only example', () => {
    const cal = buildCalibration(many(1, 'equivalent', 0.9, 'rejected'))
    expect(cal.learn('equivalent', 0.9, 'rejected')).toEqual({ score: 0.9, from: 0 })
  })
})

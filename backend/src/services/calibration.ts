import type { MappingRelation } from './mappingService.js'

/**
 * Learns from the admin's decisions how far the AI's confidence can be trusted.
 *
 * Every approved or rejected pair is one example: the AI said X% and it was right or wrong. Pairs are grouped by
 * relation and by tenth of confidence. A pair's learned score is its own AI score pulled toward the approval rate of
 * its group: with no decisions it stays the AI's score, and the more decisions the group has, the more the real
 * approval rate counts. Nothing is trained; the numbers are recomputed from the decisions every time.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** Lowest score of each level. Anything below the medium limit, or without a score, is low. */
export const LEVEL_LIMITS = { high: 0.8, medium: 0.5 } as const

/** How many decisions in a group count as much as the AI's own score for that pair. */
export const SMOOTHING_WEIGHT = 4

/** A group needs this many decisions before the screen shows a learned score next to the AI's. */
export const MIN_DECISIONS_TO_SHOW = 5

export function levelOf(score: number | null): ConfidenceLevel {
  if (score === null || !Number.isFinite(score)) return 'low'
  if (score >= LEVEL_LIMITS.high) return 'high'
  if (score >= LEVEL_LIMITS.medium) return 'medium'
  return 'low'
}

export interface DecidedPair {
  relation: MappingRelation
  confidence: number | null
  status: 'confirmed' | 'rejected'
}

export interface BandStat {
  relation: MappingRelation
  /** Lowest and highest confidence of the group, in percent. */
  fromPercent: number
  toPercent: number
  decided: number
  approved: number
  /** approved / decided, as a share between 0 and 1. */
  approvalRate: number
}

export interface Learned {
  /** The learned score between 0 and 1, or null when the pair has no AI score. */
  score: number | null
  /** How many decisions the pair's group holds. */
  from: number
}

export interface Calibration {
  decided: number
  approved: number
  rejected: number
  bands: BandStat[]
  learn(relation: MappingRelation, confidence: number | null): Learned
}

const BANDS = 10

function bandIndex(confidence: number): number {
  return Math.min(BANDS - 1, Math.max(0, Math.floor(confidence * BANDS)))
}

const keyOf = (relation: MappingRelation, band: number) => `${relation}|${band}`

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function buildCalibration(decided: readonly DecidedPair[]): Calibration {
  const counts = new Map<string, { relation: MappingRelation; band: number; decided: number; approved: number }>()
  let approved = 0
  let used = 0

  for (const pair of decided) {
    if (pair.confidence === null || !Number.isFinite(pair.confidence)) continue
    const band = bandIndex(pair.confidence)
    const key = keyOf(pair.relation, band)
    const before = counts.get(key) ?? { relation: pair.relation, band, decided: 0, approved: 0 }
    const isApproved = pair.status === 'confirmed'
    counts.set(key, { ...before, decided: before.decided + 1, approved: before.approved + (isApproved ? 1 : 0) })
    used++
    if (isApproved) approved++
  }

  const bands: BandStat[] = Array.from(counts.values())
    .map((c) => ({
      relation: c.relation,
      fromPercent: c.band * 10,
      toPercent: c.band === BANDS - 1 ? 100 : c.band * 10 + 9,
      decided: c.decided,
      approved: c.approved,
      approvalRate: round2(c.approved / c.decided),
    }))
    .sort((a, b) => a.relation.localeCompare(b.relation) || b.fromPercent - a.fromPercent)

  return {
    decided: used,
    approved,
    rejected: used - approved,
    bands,
    learn(relation, confidence) {
      if (confidence === null || !Number.isFinite(confidence)) return { score: null, from: 0 }
      const raw = Math.min(1, Math.max(0, confidence))
      const group = counts.get(keyOf(relation, bandIndex(raw)))
      if (!group) return { score: round2(raw), from: 0 }
      const score = (group.approved + SMOOTHING_WEIGHT * raw) / (group.decided + SMOOTHING_WEIGHT)
      return { score: round2(score), from: group.decided }
    },
  }
}

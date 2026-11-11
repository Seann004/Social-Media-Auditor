export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** Lowest score (0 to 1) of each section. Anything below the medium limit, or without a score, is low. */
export const CONFIDENCE_LIMITS = { high: 0.8, medium: 0.5 } as const

export const CONFIDENCE_SECTIONS: { level: ConfidenceLevel; title: string; range: string }[] = [
  { level: 'high', title: 'High confidence', range: '80% and above' },
  { level: 'medium', title: 'Medium confidence', range: '50% to 79%' },
  { level: 'low', title: 'Low confidence', range: 'Under 50% or no score' },
]

export function confidenceLevel(confidence: number | null): ConfidenceLevel {
  if (confidence === null || !Number.isFinite(confidence)) return 'low'
  if (confidence >= CONFIDENCE_LIMITS.high) return 'high'
  if (confidence >= CONFIDENCE_LIMITS.medium) return 'medium'
  return 'low'
}

/** Splits pairs into the three sections, each sorted by score with the most confident first. Returns new lists. */
export function groupByConfidence<T extends { confidence: number | null }>(pairs: readonly T[]): Record<ConfidenceLevel, T[]> {
  const groups: Record<ConfidenceLevel, T[]> = { high: [], medium: [], low: [] }
  for (const pair of pairs) groups[confidenceLevel(pair.confidence)].push(pair)
  for (const level of Object.keys(groups) as ConfidenceLevel[]) {
    groups[level] = [...groups[level]].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
  }
  return groups
}

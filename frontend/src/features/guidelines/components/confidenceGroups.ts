import type { ConfidenceLevel } from '../../../lib/db'

/** The three sections of the review list. The server decides which pair belongs where (80% and 50% are the limits). */
export const CONFIDENCE_SECTIONS: { level: ConfidenceLevel; title: string; range: string }[] = [
  { level: 'high', title: 'High confidence', range: '80% and above' },
  { level: 'medium', title: 'Medium confidence', range: '50% to 79%' },
  { level: 'low', title: 'Low confidence', range: 'Under 50% or no score' },
]

/** A pair shows its learned score next to the AI's once at least this many past decisions back it. */
export const MIN_DECISIONS_TO_SHOW = 5

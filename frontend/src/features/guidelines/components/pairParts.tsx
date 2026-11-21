import type { ItemMapping, MappingUsage } from '../../../lib/db'
import { MIN_DECISIONS_TO_SHOW } from './confidenceGroups'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Says how much the pair matters: how many projects would actually meet it. */
export function usageLabel(usage: MappingUsage): { text: string; used: boolean } {
  if (usage.together > 0) return { text: `Used together in ${plural(usage.together, 'project')}`, used: true }
  if (usage.projectsA > 0 && usage.projectsB > 0) return { text: 'Both items are in use, in different projects', used: true }
  if (usage.projectsA > 0 || usage.projectsB > 0) return { text: 'Only one of the items is in use', used: false }
  return { text: 'Not used in any project yet', used: false }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** The AI's confidence, with what the admin's past decisions say about it once there are enough of them. */
export function confidenceLabel(pair: ItemMapping): string {
  if (pair.confidence === null) return 'No confidence score'
  const learned = pair.learnedConfidence
  if (learned !== null && pair.learnedFrom >= MIN_DECISIONS_TO_SHOW && Math.abs(learned - pair.confidence) >= 0.01) {
    return `AI ${percent(pair.confidence)} · learned ${percent(learned)} (from ${plural(pair.learnedFrom, 'past decision')})`
  }
  return `${percent(pair.confidence)} sure`
}

/**
 * True when approving the pair as the same requirement would join a group that earlier approvals made, so the admin
 * should confirm it first. A pair that is already in one group adds nothing, and a pair touching no group joins nothing.
 */
export function needsGroupConfirm(pair: ItemMapping): boolean {
  const impact = pair.groupImpact
  if (!impact || pair.status !== 'suggested' || impact.alreadyTogether) return false
  return impact.linkedToA.length > 0 || impact.linkedToB.length > 0
}

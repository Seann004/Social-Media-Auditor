import type { ItemMapping, MappedItem, MappingUsage } from '../../../lib/db'
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

function itemName(item: MappedItem): string {
  return `${item.guidelineName} ${item.itemCode || item.reference || item.text.slice(0, 30)}`
}

/** Says what approving a same-requirement pair does to the groups, so a wide link is not approved by accident. */
export function GroupImpactNote({ pair }: { pair: ItemMapping }) {
  const impact = pair.groupImpact
  if (!impact || pair.status !== 'suggested') return null
  if (impact.alreadyTogether && impact.joins.length === 0) return null
  const shown = impact.joins.slice(0, 4).map(itemName).join(', ')
  const more = impact.joins.length > 4 ? ` and ${impact.joins.length - 4} more` : ''
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${impact.sameGuideline ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-100 bg-blue-50/60 text-slate-600'}`}>
      {impact.alreadyTogether
        ? 'These two items are already in one group, so approving adds nothing new.'
        : <>Approving this as <span className="font-semibold">Same requirement</span> puts both items in one group with {shown}{more}. All of them become the same requirement.</>}
      {impact.sameGuideline && (
        <span className="block mt-1 font-semibold">Two items of one guideline would be in the group. Check that the link is not too wide.</span>
      )}
    </div>
  )
}

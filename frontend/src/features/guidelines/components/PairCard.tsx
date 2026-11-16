import { ArrowsLeftRightIcon as ArrowsLeftRight, CheckIcon as Check, XIcon } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import type { ItemMapping, MappedItem, MappingRelation, MappingStatus, MappingUsage } from '../../../lib/db'
import { MIN_DECISIONS_TO_SHOW } from './confidenceGroups'

export function ItemSide({ item }: { item: MappedItem }) {
  return (
    <div className="flex-1 min-w-0 bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-2xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">
          {item.guidelineName}
        </span>
        {(item.itemCode || item.reference) && (
          <span className="text-2xs font-mono text-slate-500">{item.itemCode || item.reference}</span>
        )}
      </div>
      <p className="text-xs text-slate-700 leading-relaxed">{item.text}</p>
      {item.clause && (
        <details className="mt-2">
          <summary className="text-2xs text-slate-400 cursor-pointer hover:text-slate-600">Clause text</summary>
          <p className="text-2xs text-slate-500 mt-1 whitespace-pre-line leading-relaxed">{item.clause}</p>
        </details>
      )}
    </div>
  )
}

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

interface Props {
  pair: ItemMapping
  busy: boolean
  selected: boolean
  onSelect: (id: string, selected: boolean) => void
  onReview: (pair: ItemMapping, status: MappingStatus, relation?: MappingRelation) => void
}

export default function PairCard({ pair: m, busy, selected, onSelect, onReview }: Props) {
  const usage = usageLabel(m.usage)
  return (
    <div className={`bg-white border rounded-xl px-5 py-4 ${selected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(m.mappingId, e.target.checked)}
            aria-label={`Select this pair: ${m.itemA.text.slice(0, 60)}`}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Select
        </label>
        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-md border ${usage.used ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-slate-500 bg-slate-50 border-slate-200'}`}>
          {usage.text}
        </span>
      </div>

      <div className="flex flex-col md:flex-row items-stretch gap-3">
        <ItemSide item={m.itemA} />
        <div className="flex md:flex-col items-center justify-center gap-1 text-slate-400 shrink-0">
          <ArrowsLeftRight size={16} />
          <span className="text-2xs font-semibold uppercase tracking-wide">{m.relation === 'equivalent' ? 'same' : 'partial'}</span>
        </div>
        <ItemSide item={m.itemB} />
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <p className="flex-1 min-w-0 basis-60 text-xs text-slate-500">
          {m.rationale || 'No reason given.'}
          <span className="ml-2 font-mono text-slate-400">{confidenceLabel(m)}</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {!(m.status === 'confirmed' && m.relation === 'equivalent') && (
            <Button variant="success" size="xs" disabled={busy} onClick={() => onReview(m, 'confirmed', 'equivalent')}>
              <Check size={12} weight="bold" />
              Same requirement
            </Button>
          )}
          {!(m.status === 'confirmed' && m.relation === 'partial') && (
            <Button variant="secondary" size="xs" disabled={busy} onClick={() => onReview(m, 'confirmed', 'partial')}>
              Partly overlaps
            </Button>
          )}
          {m.status !== 'rejected' && (
            <Button variant="danger-outline" size="xs" disabled={busy} onClick={() => onReview(m, 'rejected')}>
              <XIcon size={12} weight="bold" />
              Not related
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

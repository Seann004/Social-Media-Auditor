import { CheckIcon as Check } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import type { ItemMapping, MappedItem } from '../../../lib/db'

interface Props {
  /** The pair about to be approved as the same requirement; the pop-up is closed when there is none. */
  pair: ItemMapping | null
  busy: boolean
  onCancel: () => void
  onConfirm: (pair: ItemMapping) => void
}

function ItemLine({ item }: { item: MappedItem }) {
  return (
    <li className="flex items-baseline gap-2 min-w-0">
      <span className="shrink-0 text-2xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">{item.guidelineName}</span>
      {(item.itemCode || item.reference) && <span className="shrink-0 text-2xs font-mono text-slate-500">{item.itemCode || item.reference}</span>}
      <span className="text-xs text-slate-600 truncate" title={item.text}>{item.text}</span>
    </li>
  )
}

function Linked({ item, others }: { item: MappedItem; others: MappedItem[] }) {
  if (others.length === 0) return null
  return (
    <div>
      <p className="text-xs text-slate-700 mb-1.5">
        <span className="font-semibold">{item.guidelineName} {item.itemCode || item.reference}</span> is already the same requirement as:
      </p>
      <ul className="space-y-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
        {others.map((o) => <ItemLine key={o.itemId} item={o} />)}
      </ul>
    </div>
  )
}

/** Asks before a same-requirement approval that would join a group earlier approvals made, and says where those links come from. */
export default function GroupConfirmModal({ pair, busy, onCancel, onConfirm }: Props) {
  const impact = pair?.groupImpact
  return (
    <Modal open={pair !== null} onClose={onCancel} size="lg" labelledBy="group-confirm-title">
      {pair && impact && (
        <div className="p-6">
          <h2 id="group-confirm-title" className="text-base font-semibold text-slate-900">This joins a group that was already approved</h2>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            One of these items was approved as the same requirement as other items before. Approving this pair as well puts all of them together.
          </p>

          <div className="space-y-4">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">The pair you are approving</p>
              <ul className="space-y-1.5 rounded-lg border border-slate-200 px-3 py-2">
                <ItemLine item={pair.itemA} />
                <ItemLine item={pair.itemB} />
              </ul>
            </div>

            <Linked item={pair.itemA} others={impact.linkedToA} />
            <Linked item={pair.itemB} others={impact.linkedToB} />

            <p className="text-xs text-slate-700">
              If you go on, these {impact.joins.length + 2} items become one group, and each of them is the same requirement as all the others.
            </p>
            {impact.sameGuideline && (
              <p role="note" className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Two items of one guideline would be in the group. Check that the link is not too wide.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 mt-6">
            <Button variant="secondary" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
            <Button variant="success" size="sm" disabled={busy} onClick={() => onConfirm(pair)}>
              <Check size={13} weight="bold" />
              Approve anyway
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

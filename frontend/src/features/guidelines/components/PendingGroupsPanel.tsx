import { useEffect, useState } from 'react'
import { CaretRightIcon as CaretRight, CheckIcon as Check, XIcon } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import { fetchPendingGroups, type PendingGroup } from '../../../lib/db'
import { approvedBadge, GroupItems, GroupLinks, impliedBadge, type OpenItem } from './groupParts'

interface Props {
  /** Changes whenever a decision is made, so the groups are loaded again. */
  version?: string | number
  busy: boolean
  /** Decides the waiting links of a group. */
  onDecide: (mappingIds: string[], status: 'confirmed' | 'rejected') => void
  /** Opens an item in its framework. */
  onOpenItem?: OpenItem
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? 'no score' : `${Math.round(value * 100)}% sure`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function GroupCard({ group, busy, onDecide, onOpenItem }: { group: PendingGroup; busy: boolean; onDecide: Props['onDecide']; onOpenItem?: OpenItem }) {
  const waiting = group.waitingIds.length
  const links = group.links.map((l) => ({
    itemIdA: l.itemIdA,
    itemIdB: l.itemIdB,
    badge: l.state === 'approved'
      ? approvedBadge
      : l.state === 'implied'
        ? impliedBadge
        : <span className="text-2xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">Waiting for you · {percent(l.confidence)}</span>,
  }))

  return (
    <li className={`rounded-lg border px-4 py-3 ${group.sameGuideline ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <p className="flex-1 min-w-0 basis-60 text-xs font-semibold text-slate-700">
          {group.items.length} items would be the same requirement
          <span className="ml-2 font-normal text-slate-400">{plural(waiting, 'link')} waiting for you</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="success" size="xs" disabled={busy} onClick={() => onDecide(group.waitingIds, 'confirmed')}>
            <Check size={12} weight="bold" />
            Approve the group
          </Button>
          <Button variant="danger-outline" size="xs" disabled={busy} onClick={() => onDecide(group.waitingIds, 'rejected')}>
            <XIcon size={12} weight="bold" />
            Not related
          </Button>
        </div>
      </div>
      {group.sameGuideline && (
        <p className="text-xs font-semibold text-amber-800 mt-1">Two items of one guideline would be in this group. Check that the links are not too wide.</p>
      )}
      <GroupItems items={group.items} onOpenItem={onOpenItem} />
      <GroupLinks items={group.items} links={links} onOpenItem={onOpenItem} />
    </li>
  )
}

/**
 * Waiting pairs that meet at one item form a group (A is the same as B and A is the same as C), so they are shown
 * together and can be decided together. Shows nothing when no waiting pairs form a group of three or more.
 */
export default function PendingGroupsPanel({ version = 0, busy, onDecide, onOpenItem }: Props) {
  const [groups, setGroups] = useState<PendingGroup[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchPendingGroups()
      .then((next) => { if (!cancelled) setGroups(next) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [version])

  if (groups.length === 0) return null

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded-xl px-5 py-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <CaretRight size={12} weight="bold" className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm font-semibold text-slate-800">Groups waiting for review</span>
        <span className="text-2xs font-semibold text-slate-400">{groups.length}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-xs text-slate-500 mb-3">
            These waiting pairs meet at one item, so approving them makes all the items in the group the same requirement. The pair nobody
            proposed directly is shown as <em>implied</em>. Approving the group approves every waiting link in it as <em>Same requirement</em>.
          </p>
          <ul className="space-y-3">
            {groups.map((g) => <GroupCard key={g.groupId} group={g} busy={busy} onDecide={onDecide} onOpenItem={onOpenItem} />)}
          </ul>
        </div>
      )}
    </div>
  )
}

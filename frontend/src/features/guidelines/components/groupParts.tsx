import type { ReactNode } from 'react'
import { ArrowsLeftRightIcon as ArrowsLeftRight } from '@phosphor-icons/react'
import type { MappedItem } from '../../../lib/db'

function codeOf(item: MappedItem): string {
  return item.itemCode || item.reference || item.text.slice(0, 24)
}

/** Opens an item in its framework. */
export type OpenItem = (item: MappedItem) => void

/** An item as its guideline and code. It is a link to the item in its framework when `onOpen` is given. */
export function Chip({ item, onOpen }: { item: MappedItem | undefined; onOpen?: OpenItem }) {
  if (!item) return <span className="text-2xs text-slate-400">Unknown item</span>
  const label = (
    <>
      <span className="text-2xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">{item.guidelineName}</span>
      <span className="text-2xs font-mono text-slate-600">{codeOf(item)}</span>
    </>
  )
  if (!onOpen) return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{label}</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={`Open ${item.guidelineName} ${codeOf(item)} in Frameworks`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md cursor-pointer hover:bg-blue-50 hover:underline decoration-blue-300 underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      {label}
    </button>
  )
}

/** The items of a group, one per line. */
export function GroupItems({ items, onOpenItem }: { items: MappedItem[]; onOpenItem?: OpenItem }) {
  return (
    <>
      <p className="text-2xs font-semibold uppercase tracking-wide text-slate-400 mt-3 mb-1.5">Items</p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.itemId} className="flex items-start gap-3 text-xs text-slate-700">
            <span className="shrink-0 w-44"><Chip item={item} onOpen={onOpenItem} /></span>
            <span className="min-w-0 leading-relaxed">{item.text}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

export interface LinkRow {
  /** Lower-case item ids of the two items. */
  itemIdA: string
  itemIdB: string
  /** What is said about the link, such as who approved it. */
  badge: ReactNode
}

/** Each link of a group on one line. A link starts with the item listed first, and the links follow the order of the items. */
export function GroupLinks({ items, links, onOpenItem }: { items: MappedItem[]; links: LinkRow[]; onOpenItem?: OpenItem }) {
  const byId = new Map(items.map((i) => [i.itemId.toLowerCase(), i]))
  const position = new Map(items.map((item, index) => [item.itemId.toLowerCase(), index]))
  const at = (id: string) => position.get(id) ?? 0
  const ordered = links
    .map((l) => (at(l.itemIdA) <= at(l.itemIdB) ? l : { ...l, itemIdA: l.itemIdB, itemIdB: l.itemIdA }))
    .sort((x, y) => at(x.itemIdA) - at(y.itemIdA) || at(x.itemIdB) - at(y.itemIdB))

  return (
    <>
      <p className="text-2xs font-semibold uppercase tracking-wide text-slate-400 mt-3 mb-1.5">How they are linked</p>
      <ul className="space-y-1.5">
        {ordered.map((link) => (
          <li key={`${link.itemIdA}-${link.itemIdB}`} className="flex items-center gap-2 flex-wrap text-xs">
            <Chip item={byId.get(link.itemIdA)} onOpen={onOpenItem} />
            <ArrowsLeftRight size={12} className="text-slate-400 shrink-0" aria-label="is the same requirement as" />
            <Chip item={byId.get(link.itemIdB)} onOpen={onOpenItem} />
            {link.badge}
          </li>
        ))}
      </ul>
    </>
  )
}

export const approvedBadge = (
  <span className="text-2xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">Approved by an admin</span>
)

export const impliedBadge = (
  <span className="text-2xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">Implied by the other links</span>
)

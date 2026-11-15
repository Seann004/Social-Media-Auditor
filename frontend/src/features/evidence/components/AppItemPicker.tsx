import { useId, useMemo, useState } from 'react'
import { CaretDownIcon as CaretDown, InfoIcon as Info } from '@phosphor-icons/react'
import SeverityBadge from '../../audits/components/SeverityBadge'
import { MAX_APP_ITEMS, PICK_TIP, groupPickItems } from '../appState'
import type { PickItem } from '../appState'

interface Props {
  items: PickItem[]
  picked: ReadonlySet<string>
  onChange(next: Set<string>): void
  /** How many items may be picked. */
  limit?: number
  /** Names the kind of run in the cap note: "app" or "repository". */
  verb?: 'app' | 'repository'
}

const SMALL_BUTTON =
  'rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent'

/**
 * Tickboxes grouped by category, each category folding away. Once `limit` are picked the rest are
 * disabled. Each box is named by its item text alone; the code and severity sit beside it.
 */
export default function AppItemPicker({ items, picked, onChange, limit = MAX_APP_ITEMS, verb = 'app' }: Props) {
  const full = picked.size >= limit
  const noteId = useId()
  const baseId = useId()
  const groups = useMemo(() => groupPickItems(items), [items])
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  /** Picks in checklist order, keeping what is picked, until the limit. */
  const selectAll = (): void => {
    const next = new Set(picked)
    for (const item of items) {
      if (next.size >= limit) break
      next.add(item.id)
    }
    onChange(next)
  }
  const fold = (key: string): void => {
    const next = new Set(folded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setFolded(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-slate-700">
          Items to check <span className="ml-1 font-normal tabular-nums text-slate-500">{picked.size} of {limit} picked</span>
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={selectAll} disabled={picked.size >= Math.min(limit, items.length)} className={SMALL_BUTTON}>
            Select all
          </button>
          <button type="button" onClick={() => onChange(new Set())} disabled={picked.size === 0} className={SMALL_BUTTON}>
            Clear
          </button>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Info size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
        {PICK_TIP}
      </p>
      {items.length === 0 ? <p className="text-xs text-slate-500">This checklist has no items yet.</p> : null}
      {groups.map((group, index) => {
        const open = !folded.has(group.key)
        // Category names hold spaces, so the list id uses the position.
        const listId = `${baseId}-group-${index}`
        const pickedHere = group.items.filter((item) => picked.has(item.id)).length
        return (
          <div key={group.key} className="overflow-hidden rounded-lg border border-slate-200">
            <fieldset>
              <legend className="w-full">
                <button
                  type="button"
                  onClick={() => fold(group.key)}
                  aria-expanded={open}
                  aria-controls={listId}
                  className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                >
                  <CaretDown size={12} weight="bold" aria-hidden="true" className={`shrink-0 text-slate-500 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} />
                  <span className="min-w-0 flex-1 text-xs font-semibold text-slate-900">{group.category}</span>
                  <span aria-hidden="true" className="shrink-0 text-2xs tabular-nums text-slate-500">
                    {pickedHere}/{group.items.length}
                  </span>
                </button>
              </legend>
              {open ? (
                <ul id={listId} className="divide-y divide-slate-100 border-t border-slate-200">
                  {group.items.map((item) => {
                    const checked = picked.has(item.id)
                    const boxId = `${baseId}-${item.id}`
                    return (
                      <li key={item.id} className="flex items-start gap-2.5 px-3 py-2">
                        <input
                          id={boxId}
                          type="checkbox"
                          checked={checked}
                          disabled={full && !checked}
                          aria-describedby={full && !checked ? noteId : undefined}
                          onChange={() => toggle(item.id)}
                          className="mt-1 shrink-0 accent-blue-600"
                        />
                        {item.code ? <span className="mt-0.5 shrink-0 text-2xs font-semibold tabular-nums text-slate-500">{item.code}</span> : null}
                        <label htmlFor={boxId} className="min-w-0 flex-1 cursor-pointer text-xs text-slate-700">
                          {item.label}
                        </label>
                        {item.severity ? (
                          <span className="mt-0.5 shrink-0">
                            <SeverityBadge severity={item.severity} />
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </fieldset>
          </div>
        )
      })}
      {full ? <p id={noteId} className="text-xs text-slate-500">Up to {limit} items per {verb} run.</p> : null}
    </div>
  )
}

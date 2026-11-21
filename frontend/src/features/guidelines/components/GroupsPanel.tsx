import { useEffect, useState } from 'react'
import { CaretRightIcon as CaretRight } from '@phosphor-icons/react'
import { fetchMappingGroups, type MappingGroup } from '../../../lib/db'
import { ItemSide } from './PairCard'

interface Props {
  /** Changes whenever a decision is made, so an open panel loads the new groups. */
  version?: string | number
}

/**
 * The groups of items approved as the same requirement. Items linked through a shared item (A is the same as B and
 * A is the same as C) are in one group, and answering one item of a group answers all of them.
 */
export default function GroupsPanel({ version = 0 }: Props) {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<MappingGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchMappingGroups()
      .then((next) => { if (!cancelled) { setGroups(next); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the groups.') })
    return () => { cancelled = true }
  }, [open, version])

  function toggle() {
    if (open) setGroups(null)
    setOpen(!open)
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="w-full flex items-center gap-2 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <CaretRight size={12} weight="bold" className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm font-semibold text-slate-800">Groups of items that are the same requirement</span>
        {groups && <span className="text-2xs font-semibold text-slate-400">{groups.length}</span>}
      </button>

      {open && (
        <div className="mt-3">
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {!error && groups === null && <p role="status" className="text-xs text-slate-400">Loading…</p>}
          {groups && groups.length === 0 && (
            <p className="text-xs text-slate-400">No groups yet. A group appears when you approve a pair as <em>Same requirement</em>.</p>
          )}
          {groups && groups.length > 0 && (
            <>
              <p className="text-xs text-slate-500 mb-3">
                Items linked through a shared item are one group: if A is the same as B and A is the same as C, then B is the same as C.
                When an auditor answers one item of a group, the others follow.
              </p>
              <ul className="space-y-3">
                {groups.map((g) => (
                  <li key={g.groupId} className={`rounded-lg border px-3 py-3 ${g.sameGuideline ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                      {g.items.length} items · {g.directPairs} approved {g.directPairs === 1 ? 'pair' : 'pairs'}
                    </p>
                    {g.sameGuideline && (
                      <p className="text-xs font-semibold text-amber-800 mb-2">Two items of one guideline are in this group. Check that the links are not too wide.</p>
                    )}
                    <div className="grid gap-2 md:grid-cols-2">
                      {g.items.map((item) => <ItemSide key={item.itemId} item={item} />)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

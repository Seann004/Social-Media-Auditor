import { useEffect, useState } from 'react'
import { ArrowsLeftRightIcon as ArrowsLeftRight, InfoIcon as Info } from '@phosphor-icons/react'
import { fetchSimilarItems, type SimilarPair } from '../../../lib/db'

interface Props {
  projectId: string
}

function describe(pair: SimilarPair): string {
  return pair.relation === 'equivalent' ? 'Same requirement' : 'Partly overlaps'
}

/** Tells an auditor which items chosen for this project an admin has approved as similar. Shows nothing when there are none. */
export default function SimilarItemsNotice({ projectId }: Props) {
  const [pairs, setPairs] = useState<SimilarPair[]>([])

  useEffect(() => {
    let cancelled = false
    fetchSimilarItems(projectId)
      .then((list) => { if (!cancelled) setPairs(list) })
      .catch(() => { if (!cancelled) setPairs([]) })
    return () => { cancelled = true }
  }, [projectId])

  if (pairs.length === 0) return null

  return (
    <details className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-blue-800">
        <Info size={14} weight="fill" className="shrink-0" />
        {pairs.length === 1
          ? 'Two items in this project were marked as similar'
          : `${pairs.length} pairs of items in this project were marked as similar`}
      </summary>
      <p className="mt-2 text-xs text-slate-600">
        An admin approved these pairs. Once you answer one item, the other can reuse that answer.
      </p>
      <ul className="mt-2 space-y-2">
        {pairs.map((p) => (
          <li key={p.mappingId} className="rounded-md border border-blue-100 bg-white px-3 py-2 text-xs text-slate-700">
            <div className="flex flex-col gap-1 md:flex-row md:items-start md:gap-3">
              <p className="min-w-0 flex-1"><span className="font-semibold text-blue-700">{p.itemA.guidelineName}</span> {p.itemA.text}</p>
              <span className="flex shrink-0 items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                <ArrowsLeftRight size={12} /> {describe(p)}
              </span>
              <p className="min-w-0 flex-1"><span className="font-semibold text-blue-700">{p.itemB.guidelineName}</span> {p.itemB.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}

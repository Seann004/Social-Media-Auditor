import { useEffect, useRef, useState } from 'react'
import { CaretRightIcon as CaretRight, CheckIcon as Check, XIcon } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import {
  fetchMappingsPage,
  type ConfidenceLevel,
  type ItemMapping,
  type MappedItem,
  type MappingFilters,
  type MappingRelation,
  type MappingStatus,
} from '../../../lib/db'
import Pager, { PAGE_SIZES } from './Pager'
import { confidenceLabel, GroupImpactNote, usageLabel } from './pairParts'

interface SectionAction {
  status: MappingStatus
  label: string
}

interface Props {
  level: ConfidenceLevel
  title: string
  range: string
  /** How many pairs the section holds across all its pages. */
  total: number
  /** The filters of the list, without the level. */
  filters: MappingFilters
  /** Changes whenever a decision is made, so the page shown is loaded again. */
  version: number
  open: boolean
  onToggle: () => void
  /** The decisions the whole section can take, such as Approve all. */
  actions: SectionAction[]
  selected: ReadonlySet<string>
  onSelect: (ids: string[], on: boolean) => void
  busyId: string | null
  bulkBusy: boolean
  onReview: (pair: ItemMapping, status: MappingStatus, relation?: MappingRelation) => void
  onDecideAll: (status: MappingStatus) => void
}

function ItemCell({ item }: { item: MappedItem }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-2xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">{item.guidelineName}</span>
        {(item.itemCode || item.reference) && <span className="text-2xs font-mono text-slate-500">{item.itemCode || item.reference}</span>}
      </div>
      <p className="text-xs text-slate-700 leading-snug line-clamp-2" title={item.text}>{item.text}</p>
    </div>
  )
}

/** One pair: the two items side by side, and under them what the AI found with the decision buttons in one slim strip. */
function PairRows({ pair: m, busy, selected, onSelect, onReview }: {
  pair: ItemMapping
  busy: boolean
  selected: boolean
  onSelect: (id: string, on: boolean) => void
  onReview: Props['onReview']
}) {
  const [details, setDetails] = useState(false)
  const usage = usageLabel(m.usage)
  const impact = m.groupImpact && m.status === 'suggested'
  const shade = selected ? 'bg-blue-50/60' : 'hover:bg-slate-50/60'
  const hasDetails = Boolean(m.rationale || m.itemA.clause || m.itemB.clause)

  return (
    <>
      <tr className={`align-top border-t border-slate-100 ${shade}`}>
        <td className="pt-3 pl-3 pr-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(m.mappingId, e.target.checked)}
            aria-label={`Select this pair: ${m.itemA.text.slice(0, 60)}`}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
        </td>
        <td className="pt-3 pr-5 w-1/2"><ItemCell item={m.itemA} /></td>
        <td className="pt-3 pr-4 w-1/2 border-l border-slate-100 pl-4"><ItemCell item={m.itemB} /></td>
      </tr>
      <tr className={shade}>
        <td />
        <td colSpan={2} className="pt-2 pb-3 pr-4">
          <div className="flex items-center gap-x-3 gap-y-2 flex-wrap rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0 flex-1 basis-72 text-2xs">
              <span className="font-semibold text-slate-700 whitespace-nowrap">{m.relation === 'equivalent' ? 'Same requirement' : 'Partly overlaps'}</span>
              <span className="font-mono text-slate-400 whitespace-nowrap">{confidenceLabel(m)}</span>
              <span className={`font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${usage.used ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-slate-500 bg-white border-slate-200'}`}>{usage.text}</span>
              {hasDetails && (
                <button
                  type="button"
                  aria-expanded={details}
                  onClick={() => setDetails(!details)}
                  className="text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded"
                >
                  {details ? 'Hide details' : 'Details'}
                </button>
              )}
            </div>
            <div role="group" aria-label="Your decision" className="flex items-center gap-1.5 flex-wrap ml-auto">
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
        </td>
      </tr>
      {details && (
        <tr className={shade}>
          <td />
          <td colSpan={2} className="pb-3 pr-4">
            <div className="rounded-lg border border-slate-100 px-3 py-2.5 space-y-2 text-2xs text-slate-600 leading-relaxed">
              {m.rationale && <p><span className="font-semibold text-slate-700">Why the AI linked them: </span>{m.rationale}</p>}
              {m.itemA.clause && <p className="whitespace-pre-line"><span className="font-semibold text-slate-700">{m.itemA.guidelineName} clause: </span>{m.itemA.clause}</p>}
              {m.itemB.clause && <p className="whitespace-pre-line"><span className="font-semibold text-slate-700">{m.itemB.guidelineName} clause: </span>{m.itemB.clause}</p>}
            </div>
          </td>
        </tr>
      )}
      {impact && (
        <tr className={shade}>
          <td />
          <td colSpan={2} className="pb-3 pr-4"><GroupImpactNote pair={m} /></td>
        </tr>
      )}
    </>
  )
}

/**
 * One confidence section of the review list: its header with the decisions for the whole section, and a table of its
 * pairs that loads one page at a time, with paging under it.
 */
export default function ConfidenceSection({
  level, title, range, total, filters, version, open, onToggle, actions, selected, onSelect, busyId, bulkBusy, onReview, onDecideAll,
}: Props) {
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  // The page belongs to the filters and the size it was chosen under; a change of either starts again at the first page.
  const scope = `${JSON.stringify(filters)}|${pageSize}`
  const [position, setPosition] = useState({ scope, index: 0 })
  const index = position.scope === scope ? position.index : 0
  const goTo = (next: number) => setPosition({ scope, index: next })

  const [rows, setRows] = useState<ItemMapping[]>([])
  const [shownTotal, setShownTotal] = useState(total)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<MappingStatus | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    if (!open) return
    const request = ++latest.current
    setLoading(true)
    fetchMappingsPage({ ...filters, level }, index * pageSize, pageSize)
      .then((next) => {
        if (request !== latest.current) return
        // A page past the end (the list got shorter) falls back to the last one.
        if (next.items.length === 0 && next.total > 0 && index > 0) {
          setPosition({ scope, index: Math.ceil(next.total / pageSize) - 1 })
          return
        }
        setRows(next.items)
        setShownTotal(next.total)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (request !== latest.current) return
        setError(err instanceof Error ? err.message : 'Could not load these pairs.')
        setLoading(false)
      })
    // `scope` stands for the filters and the page size, which is what the page depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, level, scope, index, version])

  const bodyId = `confidence-${level}`
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.mappingId))
  const handleSelect = (id: string, on: boolean) => onSelect([id], on)

  return (
    <section aria-label={title}>
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex-1 min-w-[260px] flex items-center gap-2 text-left bg-white border border-slate-200 rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <CaretRight size={12} weight="bold" className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          <span className="text-xs font-semibold text-slate-700">{title}</span>
          <span className="text-xs text-slate-400">({range})</span>
          <span className="ml-auto text-xs font-mono text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5">{total}</span>
        </button>

        {pending ? (
          <div role="alert" className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-amber-800">
              {pending === 'confirmed' ? 'Approve' : 'Reject'} all {total} pair{total !== 1 ? 's' : ''} in this section (every page, not only the one shown)?
            </span>
            <Button variant={pending === 'confirmed' ? 'success' : 'danger-outline'} size="xs" disabled={bulkBusy} onClick={() => { onDecideAll(pending); setPending(null) }}>
              Yes, {pending === 'confirmed' ? 'approve' : 'reject'} {total}
            </Button>
            <button type="button" onClick={() => setPending(null)} className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {actions.map((a) => (
              <Button key={a.status} variant={a.status === 'confirmed' ? 'secondary' : 'danger-outline'} size="xs" disabled={bulkBusy} onClick={() => setPending(a.status)}>
                {a.label} ({total})
              </Button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div id={bodyId} className="bg-white border border-slate-200 rounded-xl">
          {error && <p role="alert" className="text-xs text-rose-700 px-4 py-3">{error}</p>}
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            <table className="w-full text-left border-collapse">
              <caption className="sr-only">{title} pairs</caption>
              <thead>
                <tr className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
                  <th scope="col" className="py-2.5 pl-3 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => onSelect(rows.map((r) => r.mappingId), e.target.checked)}
                      aria-label={`Select the ${rows.length} shown in this section`}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                  </th>
                  <th scope="col" className="py-2.5 pr-5 font-semibold w-1/2">First item</th>
                  <th scope="col" className="py-2.5 pr-4 pl-4 font-semibold w-1/2">Second item</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <PairRows key={m.mappingId} pair={m} busy={busyId === m.mappingId} selected={selected.has(m.mappingId)} onSelect={handleSelect} onReview={onReview} />
                ))}
                {rows.length === 0 && !loading && !error && (
                  <tr><td colSpan={3} className="py-6 text-center text-xs text-slate-400">No pairs on this page.</td></tr>
                )}
                {rows.length === 0 && loading && (
                  <tr><td colSpan={3} role="status" className="py-6 text-center text-xs text-slate-400">Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3">
            <Pager page={index} pageSize={pageSize} total={shownTotal} label={title} onPage={goTo} onPageSize={(n) => setPageSize(n)} />
          </div>
        </div>
      )}
    </section>
  )
}

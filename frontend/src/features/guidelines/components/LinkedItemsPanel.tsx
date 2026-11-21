import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretRightIcon as CaretRight, SparkleIcon as Sparkle } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import {
  bulkReviewMappings,
  fetchMappingsPage,
  generateMappings,
  reviewMapping,
  type ConfidenceLevel,
  type ItemMapping,
  type MappingFilters,
  type MappingPage,
  type MappingRelation,
  type MappingStatus,
} from '../../../lib/db'
import { CONFIDENCE_SECTIONS } from './confidenceGroups'
import LearningPanel from './LearningPanel'
import GroupsPanel from './GroupsPanel'
import PairCard from './PairCard'

interface Props {
  guidelines: { id: string; name: string; shortName: string }[]
}

const STATUS_TABS: { key: MappingStatus; label: string }[] = [
  { key: 'suggested', label: 'Awaiting review' },
  { key: 'confirmed', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

const PAGE_SIZE = 50
const MAX_REFRESH = 200

type SectionAction = { level: ConfidenceLevel; status: MappingStatus }

const selectClass = 'text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300'

/** Admin screen: the pairs of similar items the AI found, ranked and filtered for a long queue, with bulk decisions. */
export default function LinkedItemsPanel({ guidelines }: Props) {
  const [tab, setTab] = useState<MappingStatus>('suggested')
  const [guidelineFilter, setGuidelineFilter] = useState('')
  const [relationFilter, setRelationFilter] = useState<'' | MappingRelation>('')
  const [inUseOnly, setInUseOnly] = useState(false)

  const [page, setPage] = useState<MappingPage | null>(null)
  const [items, setItems] = useState<ItemMapping[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<ConfidenceLevel, boolean>>({ high: false, medium: false, low: false })
  const [pendingSection, setPendingSection] = useState<SectionAction | null>(null)

  const [target, setTarget] = useState('')
  const [running, setRunning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filters = useMemo<MappingFilters>(() => ({
    status: tab,
    ...(guidelineFilter ? { guidelineId: guidelineFilter } : {}),
    ...(relationFilter ? { relation: relationFilter } : {}),
    ...(inUseOnly ? { inUse: true } : {}),
  }), [tab, guidelineFilter, relationFilter, inUseOnly])

  const latest = useRef(0)

  const load = useCallback(async (limit = PAGE_SIZE) => {
    const request = ++latest.current
    try {
      const next = await fetchMappingsPage(filters, 0, limit)
      if (request !== latest.current) return
      setPage(next)
      setItems(next.items)
      setSelected(new Set())
      setPendingSection(null)
      setError(null)
    } catch (err) {
      if (request !== latest.current) return
      setError(err instanceof Error ? err.message : 'Could not load linked items.')
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await fetchMappingsPage(filters, items.length, PAGE_SIZE)
      setPage(next)
      setItems((prev) => {
        const known = new Set(prev.map((i) => i.mappingId))
        return [...prev, ...next.items.filter((i) => !known.has(i.mappingId))]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more pairs.')
    } finally {
      setLoadingMore(false)
    }
  }

  const refresh = () => load(Math.min(MAX_REFRESH, Math.max(PAGE_SIZE, items.length)))

  async function handleGenerate() {
    if (!target) return
    setRunning(true)
    setMessage(null)
    setError(null)
    try {
      const res = await generateMappings(target)
      setMessage(res.suggested > 0
        ? `Found ${res.suggested} possible link${res.suggested !== 1 ? 's' : ''} across ${res.checked} items.`
        : `No new links found across ${res.checked} items.`)
      if (res.failedBatches > 0) {
        setError(`${res.failedBatches} batch${res.failedBatches !== 1 ? 'es' : ''} failed, so some items weren't checked. Run Find links again to retry them.`)
      }
      if (tab === 'suggested') await load()
      else setTab('suggested')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching failed.')
    } finally {
      setRunning(false)
    }
  }

  async function handleReview(m: ItemMapping, status: MappingStatus, relation?: MappingRelation) {
    setBusyId(m.mappingId)
    try {
      await reviewMapping(m.mappingId, status, relation)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update link.')
    } finally {
      setBusyId(null)
    }
  }

  function handleSelect(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function selectLoaded(level: ConfidenceLevel, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const item of items) {
        if (item.level !== level) continue
        if (on) next.add(item.mappingId)
        else next.delete(item.mappingId)
      }
      return next
    })
  }

  async function runBulk(body: Parameters<typeof bulkReviewMappings>[0], done: (updated: number) => string) {
    setBulkBusy(true)
    setMessage(null)
    try {
      const { updated } = await bulkReviewMappings(body)
      setMessage(done(updated))
      setError(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update those pairs.')
      setPendingSection(null)
    } finally {
      setBulkBusy(false)
    }
  }

  const decideSelected = (status: MappingStatus, relation?: MappingRelation) =>
    runBulk({ ids: Array.from(selected), status, ...(relation ? { relation } : {}) }, (n) => `Updated ${n} pair${n !== 1 ? 's' : ''}.`)

  function decideSection({ level, status }: SectionAction) {
    const count = page?.levels[level] ?? 0
    return runBulk(
      { filter: { ...filters, level }, expectedCount: count, status },
      (n) => `${status === 'confirmed' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Sent back'} ${n} pair${n !== 1 ? 's' : ''}.`,
    )
  }

  if (page === null) {
    return error
      ? <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-4 py-3">{error}</div>
      : <p role="status" className="text-sm text-slate-400 py-10 text-center">Loading linked items…</p>
  }

  const reviewed = page.totals.confirmed + page.totals.rejected
  const withoutLinks = guidelines.filter((g) => !page.linkedGuidelineIds.includes(g.id))
  const filtered = Boolean(guidelineFilter || relationFilter || inUseOnly)
  const sectionStatuses: { status: MappingStatus; label: string }[] = tab === 'suggested'
    ? [{ status: 'confirmed', label: 'Approve all' }, { status: 'rejected', label: 'Reject all' }]
    : tab === 'confirmed'
      ? [{ status: 'rejected', label: 'Reject all' }]
      : [{ status: 'confirmed', label: 'Approve all' }]

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">Awaiting your review</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{page.totals.suggested}</p>
          <p className="text-xs text-slate-400 mt-1">Found by the AI, not used in audits yet</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">Approved links</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{page.totals.confirmed}</p>
          <p className="text-xs text-slate-400 mt-1">Shown to auditors when both items are in a project</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">AI match precision</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">
            {reviewed > 0 ? `${Math.round((page.totals.confirmed / reviewed) * 100)}%` : 'n/a'}
          </p>
          <p className="text-xs text-slate-400 mt-1">Approved out of {reviewed} reviewed</p>
        </div>
      </div>

      {withoutLinks.length > 0 && (
        <div role="note" className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-3">
          No linked items are saved yet for: <span className="font-semibold">{withoutLinks.map((g) => g.shortName || g.name).join(', ')}</span>.
          The automatic check may still be running, may have failed, or may have found nothing. Choose a framework below and press Find links to check it again.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
        <p className="text-sm font-semibold text-slate-800">Find links</p>
        <p className="text-xs text-slate-500 mb-3">
          This runs by itself when a framework is uploaded. Use it to check an existing framework again. Nothing is used in audits until you approve it below.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="mapping-target" className="sr-only">Framework</label>
          <select id="mapping-target" value={target} onChange={(e) => setTarget(e.target.value)} className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 min-w-[240px] focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">Choose a framework…</option>
            {guidelines.map((g) => (
              <option key={g.id} value={g.id}>{g.shortName || g.name}</option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={handleGenerate} disabled={!target || running}>
            <Sparkle size={13} weight="bold" />
            {running ? 'Matching… this can take a minute' : 'Find links'}
          </Button>
        </div>
        {message && <p className="text-xs text-slate-600 mt-3" role="status">{message}</p>}
      </div>

      <GroupsPanel version={`${page.totals.confirmed}-${page.counts.confirmed}`} />

      <LearningPanel version={reviewed} />

      <div>
        <div className="flex items-center gap-1 mb-3 border-b border-slate-200">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label} <span className="font-mono text-slate-400">{page.counts[t.key]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap mb-4">
          <label htmlFor="filter-guideline" className="sr-only">Filter by framework</label>
          <select id="filter-guideline" value={guidelineFilter} onChange={(e) => setGuidelineFilter(e.target.value)} className={selectClass}>
            <option value="">All frameworks</option>
            {guidelines.map((g) => (
              <option key={g.id} value={g.id}>{g.shortName || g.name}</option>
            ))}
          </select>
          <label htmlFor="filter-relation" className="sr-only">Filter by AI label</label>
          <select id="filter-relation" value={relationFilter} onChange={(e) => setRelationFilter(e.target.value as '' | MappingRelation)} className={selectClass}>
            <option value="">Any AI label</option>
            <option value="equivalent">Same requirement</option>
            <option value="partial">Partly overlaps</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={inUseOnly} onChange={(e) => setInUseOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
            Only pairs that are in use
          </label>
          {filtered && (
            <button type="button" onClick={() => { setGuidelineFilter(''); setRelationFilter(''); setInUseOnly(false) }} className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer">
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-slate-400">
            Pairs used by more projects come first inside each section.
          </span>
        </div>

        {selected.size > 0 && (
          <div role="toolbar" aria-label="Decide the selected pairs" className="sticky top-2 z-10 mb-4 flex items-center gap-2 flex-wrap bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
            <span className="text-xs font-semibold text-blue-800 mr-2">{selected.size} selected</span>
            <Button variant="success" size="xs" disabled={bulkBusy} onClick={() => decideSelected('confirmed', 'equivalent')}>Same requirement</Button>
            <Button variant="secondary" size="xs" disabled={bulkBusy} onClick={() => decideSelected('confirmed', 'partial')}>Partly overlaps</Button>
            <Button variant="danger-outline" size="xs" disabled={bulkBusy} onClick={() => decideSelected('rejected')}>Not related</Button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-slate-700 ml-auto cursor-pointer">Clear selection</button>
          </div>
        )}

        {page.total === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">{filtered ? 'No pairs match these filters.' : 'Nothing here yet.'}</p>
        ) : (
          <div className="space-y-6">
            {CONFIDENCE_SECTIONS.map(({ level, title, range }) => {
              const total = page.levels[level]
              if (total === 0) return null
              const loaded = items.filter((i) => i.level === level)
              const isOpen = !collapsed[level]
              const bodyId = `confidence-${level}`
              const allLoadedSelected = loaded.length > 0 && loaded.every((i) => selected.has(i.mappingId))
              return (
                <section key={level} aria-label={title}>
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={bodyId}
                      onClick={() => setCollapsed((prev) => ({ ...prev, [level]: !prev[level] }))}
                      className="flex-1 min-w-[260px] flex items-center gap-2 text-left bg-white border border-slate-200 rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <CaretRight size={12} weight="bold" className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="text-xs font-semibold text-slate-700">{title}</span>
                      <span className="text-xs text-slate-400">({range})</span>
                      <span className="ml-auto text-xs font-mono text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5">{total}</span>
                    </button>

                    {pendingSection?.level === level ? (
                      <div role="alert" className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                        <span className="text-xs text-amber-800">
                          {pendingSection.status === 'confirmed' ? 'Approve' : 'Reject'} all {total} pair{total !== 1 ? 's' : ''} in this section (every page, not only the ones loaded)?
                        </span>
                        <Button variant={pendingSection.status === 'confirmed' ? 'success' : 'danger-outline'} size="xs" disabled={bulkBusy} onClick={() => decideSection(pendingSection)}>
                          Yes, {pendingSection.status === 'confirmed' ? 'approve' : 'reject'} {total}
                        </Button>
                        <button type="button" onClick={() => setPendingSection(null)} className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {sectionStatuses.map((a) => (
                          <Button key={a.status} variant={a.status === 'confirmed' ? 'secondary' : 'danger-outline'} size="xs" disabled={bulkBusy} onClick={() => setPendingSection({ level, status: a.status })}>
                            {a.label} ({total})
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>

                  {isOpen && (
                    <div id={bodyId} className="space-y-3">
                      <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer px-1">
                        <input type="checkbox" checked={allLoadedSelected} onChange={(e) => selectLoaded(level, e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                        Select the {loaded.length} shown in this section
                      </label>
                      {loaded.map((m) => (
                        <PairCard key={m.mappingId} pair={m} busy={busyId === m.mappingId} selected={selected.has(m.mappingId)} onSelect={handleSelect} onReview={handleReview} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}

            {items.length < page.total && (
              <div className="text-center">
                <Button variant="secondary" size="sm" disabled={loadingMore} onClick={loadMore}>
                  {loadingMore ? 'Loading…' : `Show ${Math.min(PAGE_SIZE, page.total - items.length)} more (${items.length} of ${page.total} shown)`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

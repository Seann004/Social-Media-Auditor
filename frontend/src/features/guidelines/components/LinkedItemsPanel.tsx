import { useEffect, useMemo, useState } from 'react'
import { ArrowsLeftRightIcon as ArrowsLeftRight, SparkleIcon as Sparkle, CheckIcon as Check, XIcon } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import {
  fetchMappings,
  generateMappings,
  reviewMapping,
  type ItemMapping,
  type MappingRelation,
  type MappingStatus,
  type MappedItem,
} from '../../../lib/db'
import { CONFIDENCE_SECTIONS, groupByConfidence } from './confidenceGroups'

interface Props {
  guidelines: { id: string; name: string; shortName: string }[]
}

const STATUS_TABS: { key: MappingStatus; label: string }[] = [
  { key: 'suggested', label: 'Awaiting review' },
  { key: 'confirmed', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

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

/** Admin screen: every pair of similar items the AI found, grouped by how sure it was, for the admin to approve or reject. */
export default function LinkedItemsPanel({ guidelines }: Props) {
  const [mappings, setMappings] = useState<ItemMapping[] | null>(null)
  const [tab, setTab] = useState<MappingStatus>('suggested')
  const [target, setTarget] = useState('')
  const [running, setRunning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setMappings(await fetchMappings())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load linked items.')
    }
  }

  useEffect(() => { load() }, [])

  const counts = useMemo(() => {
    const out: Record<MappingStatus, number> = { suggested: 0, confirmed: 0, rejected: 0 }
    for (const m of mappings ?? []) out[m.status]++
    return out
  }, [mappings])

  const groups = useMemo(
    () => groupByConfidence((mappings ?? []).filter((m) => m.status === tab)),
    [mappings, tab],
  )

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
      setTab('suggested')
      await load()
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
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update link.')
    } finally {
      setBusyId(null)
    }
  }

  if (mappings === null) {
    return error
      ? <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-4 py-3">{error}</div>
      : <p role="status" className="text-sm text-slate-400 py-10 text-center">Loading linked items…</p>
  }

  const reviewed = counts.confirmed + counts.rejected
  const linkedGuidelineIds = new Set(mappings.flatMap((m) => [m.itemA.guidelineId, m.itemB.guidelineId]))
  const withoutLinks = guidelines.filter((g) => !linkedGuidelineIds.has(g.id))
  const shown = groups.high.length + groups.medium.length + groups.low.length

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">Awaiting your review</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{counts.suggested}</p>
          <p className="text-xs text-slate-400 mt-1">Found by the AI, not used in audits yet</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">Approved links</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{counts.confirmed}</p>
          <p className="text-xs text-slate-400 mt-1">Shown to auditors when both items are in a project</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">AI match precision</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">
            {reviewed > 0 ? `${Math.round((counts.confirmed / reviewed) * 100)}%` : 'n/a'}
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
          <select
            id="mapping-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 min-w-[240px] focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
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
              {t.label} <span className="font-mono text-slate-400">{counts[t.key]}</span>
            </button>
          ))}
        </div>

        {shown === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">Nothing here yet.</p>
        ) : (
          <div className="space-y-6">
            {CONFIDENCE_SECTIONS.map(({ level, title, range }) => {
              const list = groups[level]
              if (list.length === 0) return null
              return (
                <section key={level} aria-label={title}>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">
                    {title} <span className="font-normal text-slate-400">({range})</span>{' '}
                    <span className="font-mono text-slate-400">{list.length}</span>
                  </h3>
                  <div className="space-y-3">
                    {list.map((m) => (
                      <PairCard key={m.mappingId} pair={m} busy={busyId === m.mappingId} onReview={handleReview} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PairCard({ pair: m, busy, onReview }: {
  pair: ItemMapping
  busy: boolean
  onReview: (m: ItemMapping, status: MappingStatus, relation?: MappingRelation) => void
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
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
          {m.confidence !== null && (
            <span className="ml-2 font-mono text-slate-400">{Math.round(m.confidence * 100)}% sure</span>
          )}
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

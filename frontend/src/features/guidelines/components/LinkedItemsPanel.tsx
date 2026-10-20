import { useEffect, useMemo, useState } from 'react'
import { ArrowsLeftRightIcon as ArrowsLeftRight, SparkleIcon as Sparkle, CheckIcon as Check, XIcon } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import {
  fetchMappings,
  fetchMappingCoverage,
  generateMappings,
  reviewMapping,
  type ItemMapping,
  type MappingCoverage,
  type MappingRelation,
  type MappingStatus,
  type MappedItem,
} from '../../../lib/db'

interface Props {
  guidelines: { id: string; name: string; shortName: string }[]
  isAdmin: boolean
}

const STATUS_TABS: { key: MappingStatus; label: string }[] = [
  { key: 'suggested', label: 'Awaiting review' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'rejected', label: 'Rejected' },
]

function ItemSide({ item }: { item: MappedItem }) {
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

export default function LinkedItemsPanel({ guidelines, isAdmin }: Props) {
  const [coverage, setCoverage] = useState<MappingCoverage | null>(null)
  const [mappings, setMappings] = useState<ItemMapping[]>([])
  const [tab, setTab] = useState<MappingStatus>('suggested')
  const [target, setTarget] = useState('')
  const [running, setRunning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [cov, maps] = await Promise.all([fetchMappingCoverage(), isAdmin ? fetchMappings() : Promise.resolve([])])
      setCoverage(cov)
      setMappings(maps)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load linked items.')
    }
  }

  useEffect(() => { load() }, [isAdmin])

  const pairCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of coverage?.pairs ?? []) {
      map.set(`${p.guidelineA}|${p.guidelineB}`, p.count)
      map.set(`${p.guidelineB}|${p.guidelineA}`, p.count)
    }
    return map
  }, [coverage])

  const visible = mappings.filter((m) => m.status === tab)
  const matrixGuidelines = (coverage?.guidelines ?? []).filter((g) => g.totalItems > 0)
  const decided = (coverage?.decisions.accepted ?? 0) + (coverage?.decisions.dismissed ?? 0)
  const reviewed = (coverage?.mappings.confirmed ?? 0) + (coverage?.mappings.rejected ?? 0)

  async function handleGenerate() {
    if (!target) return
    setRunning(true)
    setMessage(null)
    setError(null)
    try {
      const res = await generateMappings(target)
      const found = res.suggested > 0
        ? `Found ${res.suggested} possible link${res.suggested !== 1 ? 's' : ''} across ${res.checked} items.`
        : `No new links found across ${res.checked} items.`
      setMessage(found)
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

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">Confirmed links</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">{coverage?.mappings.confirmed ?? 0}</p>
          <p className="text-xs text-slate-400 mt-1">{coverage?.mappings.suggested ?? 0} awaiting review</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">AI match precision</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">
            {reviewed > 0 ? `${Math.round(((coverage?.mappings.confirmed ?? 0) / reviewed) * 100)}%` : 'n/a'}
          </p>
          <p className="text-xs text-slate-400 mt-1">Confirmed out of {reviewed} reviewed</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm text-slate-500 font-medium mb-1">Suggestions accepted</p>
          <p className="text-2xl font-semibold text-slate-900 tabular-nums">
            {decided > 0 ? `${Math.round(((coverage?.decisions.accepted ?? 0) / decided) * 100)}%` : 'n/a'}
          </p>
          <p className="text-xs text-slate-400 mt-1">{coverage?.decisions.accepted ?? 0} of {decided} by auditors</p>
        </div>
      </div>

      {matrixGuidelines.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">Shared requirements</p>
          <p className="text-xs text-slate-500 mb-4">Confirmed links between frameworks, and how much of each one overlaps with the others.</p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-2" />
                  {matrixGuidelines.map((g) => (
                    <th key={g.guidelineId} className="p-2 font-semibold text-slate-600 text-left whitespace-nowrap">{g.name}</th>
                  ))}
                  <th className="p-2 font-semibold text-slate-600 text-left whitespace-nowrap">Shared</th>
                </tr>
              </thead>
              <tbody>
                {matrixGuidelines.map((row) => (
                  <tr key={row.guidelineId} className="border-t border-slate-100">
                    <th className="p-2 font-semibold text-slate-600 text-left whitespace-nowrap">{row.name}</th>
                    {matrixGuidelines.map((col) => {
                      const count = row.guidelineId === col.guidelineId ? null : pairCount.get(`${row.guidelineId}|${col.guidelineId}`) ?? 0
                      return (
                        <td key={col.guidelineId} className="p-2 text-center font-mono tabular-nums">
                          {count === null ? (
                            <span className="text-slate-300">·</span>
                          ) : (
                            <span className={count > 0 ? 'inline-block min-w-[2rem] rounded-md bg-blue-50 text-blue-700 px-1.5 py-0.5' : 'text-slate-300'}>
                              {count}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="p-2 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {row.linkedItems}/{row.totalItems} ({Math.round((row.linkedItems / row.totalItems) * 100)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">Find links</p>
          <p className="text-xs text-slate-500 mb-3">
            The AI compares a framework's items with every other framework. Nothing is used in audits until you confirm it below.
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
      )}

      {isAdmin && (
        <div>
          <div className="flex items-center gap-1 mb-3 border-b border-slate-200">
            {STATUS_TABS.map((t) => {
              const count = mappings.filter((m) => m.status === t.key).length
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                    tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label} <span className="font-mono text-slate-400">{count}</span>
                </button>
              )
            })}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-slate-400 py-10 text-center">Nothing here yet.</p>
          ) : (
            <div className="space-y-3">
              {visible.map((m) => (
                <div key={m.mappingId} className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                  <div className="flex flex-col md:flex-row items-stretch gap-3">
                    <ItemSide item={m.itemA} />
                    <div className="flex md:flex-col items-center justify-center gap-1 text-slate-400 shrink-0">
                      <ArrowsLeftRight size={16} />
                      <span className="text-2xs font-semibold uppercase tracking-wide">{m.relation}</span>
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
                        <Button
                          variant="success"
                          size="xs"
                          disabled={busyId === m.mappingId}
                          onClick={() => handleReview(m, 'confirmed', 'equivalent')}
                        >
                          <Check size={12} weight="bold" />
                          Same requirement
                        </Button>
                      )}
                      {!(m.status === 'confirmed' && m.relation === 'partial') && (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={busyId === m.mappingId}
                          onClick={() => handleReview(m, 'confirmed', 'partial')}
                        >
                          Partly overlaps
                        </Button>
                      )}
                      {m.status !== 'rejected' && (
                        <Button
                          variant="danger-outline"
                          size="xs"
                          disabled={busyId === m.mappingId}
                          onClick={() => handleReview(m, 'rejected')}
                        >
                          <XIcon size={12} weight="bold" />
                          Not related
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isAdmin && coverage && coverage.pairs.length === 0 && (
        <p className="text-sm text-slate-400 py-10 text-center">No confirmed links between frameworks yet.</p>
      )}
    </div>
  )
}

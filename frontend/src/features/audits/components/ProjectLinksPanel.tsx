import { useState } from 'react'
import { ArrowsLeftRightIcon as ArrowsLeftRight, SparkleIcon as Sparkle, CheckIcon as Check, XIcon, CaretRightIcon as CaretRight } from '@phosphor-icons/react'
import Button from '../../../components/ui/Button'
import { ItemSide } from '../../guidelines/components/LinkedItemsPanel'
import {
  fetchProjectMappings,
  generateProjectMappings,
  reviewProjectMapping,
  type ItemMapping,
  type MappingRelation,
  type MappingStatus,
} from '../../../lib/db'

interface Props {
  projectId: string
}

/**
 * Head auditor's review of the AI links between the guidelines this project uses.
 * Nothing is loaded until the panel is opened, so audits that never need it pay nothing.
 */
export default function ProjectLinksPanel({ projectId }: Props) {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<ItemMapping[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    try {
      setLinks(await fetchProjectMappings(projectId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load linked requirements.')
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && links === null) load()
  }

  async function handleReview(m: ItemMapping, status: MappingStatus, relation?: MappingRelation) {
    setBusyId(m.mappingId)
    try {
      await reviewProjectMapping(projectId, m.mappingId, status, relation)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this link.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleFind() {
    setFinding(true)
    setMessage(null)
    setError(null)
    try {
      const res = await generateProjectMappings(projectId)
      setMessage(res.suggested > 0
        ? `Found ${res.suggested} possible link${res.suggested !== 1 ? 's' : ''}.`
        : 'No new links found.')
      if (res.failedBatches > 0) setError(`${res.failedBatches} batch${res.failedBatches !== 1 ? 'es' : ''} failed. Try again to check the rest.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching failed.')
    } finally {
      setFinding(false)
    }
  }

  const waiting = (links ?? []).filter((m) => m.status === 'suggested')

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ring-1 bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        Review linked requirements
        <CaretRight size={11} weight="bold" className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {error && (
            <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-4 py-3">{error}</div>
          )}
          {message && <p className="text-xs text-slate-600" role="status">{message}</p>}

          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-slate-500">
              {links === null ? 'Loading…' : `${waiting.length} awaiting review. Only links between this project's guidelines are shown. Nothing is reused until you confirm it.`}
            </p>
            <Button variant="secondary" size="xs" onClick={handleFind} disabled={finding}>
              <Sparkle size={12} weight="bold" />
              {finding ? 'Matching… this can take a minute' : 'Find links'}
            </Button>
          </div>

          {links !== null && waiting.length === 0 && (
            <p className="text-sm text-slate-400 py-4">No links to review right now.</p>
          )}

          {waiting.map((m) => (
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
                <p className="flex-1 min-w-0 basis-60 text-xs text-slate-500">{m.rationale || 'No reason given.'}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="success" size="xs" disabled={busyId === m.mappingId} onClick={() => handleReview(m, 'confirmed', 'equivalent')}>
                    <Check size={12} weight="bold" />
                    Same requirement
                  </Button>
                  <Button variant="secondary" size="xs" disabled={busyId === m.mappingId} onClick={() => handleReview(m, 'confirmed', 'partial')}>
                    Partly overlaps
                  </Button>
                  <Button variant="danger-outline" size="xs" disabled={busyId === m.mappingId} onClick={() => handleReview(m, 'rejected')}>
                    <XIcon size={12} weight="bold" />
                    Not related
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

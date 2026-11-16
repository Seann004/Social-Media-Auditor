import { useEffect, useState } from 'react'
import { CaretRightIcon as CaretRight } from '@phosphor-icons/react'
import { fetchMappingLearning, type MappingLearning } from '../../../lib/db'

interface Props {
  /** Changes whenever a decision is made, so an open panel loads the new numbers. */
  version?: number
}

/** Shows how well the AI's confidence has matched the admin's decisions, which is what the learned scores come from. */
export default function LearningPanel({ version = 0 }: Props) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<MappingLearning | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchMappingLearning()
      .then((next) => { if (!cancelled) { setData(next); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load how the AI is doing.') })
    return () => { cancelled = true }
  }, [open, version])

  function toggle() {
    // Numbers from an earlier visit are dropped, so a reopened panel never shows old figures while it loads.
    if (open) setData(null)
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
        <span className="text-sm font-semibold text-slate-800">How the AI is learning from your decisions</span>
      </button>

      {open && (
        <div className="mt-3">
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {!error && data === null && <p role="status" className="text-xs text-slate-400">Loading…</p>}
          {data && (
            <>
              <p className="text-xs text-slate-500 mb-3">
                Each approval or rejection teaches the app how far the AI's confidence can be trusted. A pair's learned score is the AI's own score, pulled toward how often
                pairs like it were approved. It appears next to the AI's score once {data.minDecisionsToShow} or more decisions back it.
                So far: <span className="font-semibold text-slate-700">{data.decided}</span> decisions
                ({data.approved} approved, {data.rejected} rejected).
              </p>
              {data.bands.length === 0 ? (
                <p className="text-xs text-slate-400">Nothing to learn from yet. Approve or reject some pairs first.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse w-full max-w-xl">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1.5 pr-4 font-semibold">AI label</th>
                        <th className="py-1.5 pr-4 font-semibold">AI confidence</th>
                        <th className="py-1.5 pr-4 font-semibold">Decided</th>
                        <th className="py-1.5 font-semibold">Approved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bands.map((b) => (
                        <tr key={`${b.relation}-${b.fromPercent}`} className="border-t border-slate-100">
                          <td className="py-1.5 pr-4 text-slate-700">{b.relation === 'equivalent' ? 'Same requirement' : 'Partly overlaps'}</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-600">{b.fromPercent}–{b.toPercent}%</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-600">{b.decided}</td>
                          <td className="py-1.5 font-mono text-slate-600">{Math.round(b.approvalRate * 100)}% ({b.approved} of {b.decided})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

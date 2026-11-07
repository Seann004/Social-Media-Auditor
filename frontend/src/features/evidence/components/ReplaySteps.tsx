import { CaretLeftIcon as CaretLeft, CaretRightIcon as CaretRight, XIcon as X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { EvidenceApiError, getScreenshotUrl, getSuggestionSteps } from '../api'
import { OUTCOME_LABEL } from '../appState'
import { isHttpUrl } from '../safeUrl'
import type { AppStepView, StepsResponse } from '../types'
import AppChanges from './AppChanges'
import { useModal } from './useModal'

interface Props {
  suggestionId: string
  onClose: () => void
}

type Loaded = { state: 'loading' } | { state: 'ready'; data: StepsResponse } | { state: 'failed'; message: string }
type Shot = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed' }

const NO_STEPS = 'This suggestion has no recorded steps.'
const SHOT_FAILED = 'The screenshot could not be loaded.'

function OutcomeChip({ step }: { step: AppStepView }) {
  if (step.outcome === 'done') return null
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{OUTCOME_LABEL[step.outcome]}</span>
}

/** The screenshot of one step. The signed link is fetched when the step is shown and never cached. */
function StepShot({ step }: { step: AppStepView }) {
  const [shot, setShot] = useState<Shot>({ state: 'loading' })
  const pageId = step.hasScreenshot ? step.pageId : null

  useEffect(() => {
    if (pageId === null) return
    let alive = true
    setShot({ state: 'loading' })
    getScreenshotUrl('page', pageId)
      .then((url) => {
        if (alive) setShot(isHttpUrl(url) ? { state: 'ready', url } : { state: 'failed' })
      })
      .catch(() => {
        if (alive) setShot({ state: 'failed' })
      })
    return () => {
      alive = false
    }
  }, [pageId])

  const note = 'rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500'
  if (pageId === null) return <p className={note}>No screenshot for this step</p>
  if (shot.state === 'loading') return <p className={note}>Loading screenshot…</p>
  if (shot.state === 'failed') return <p className={note}>{SHOT_FAILED}</p>
  return (
    <img
      src={shot.url}
      alt={`Screenshot of step ${step.position}`}
      onError={() => setShot({ state: 'failed' })}
      className="h-auto max-w-full rounded-lg border border-slate-200"
    />
  )
}

/** Every step the AI took inside the app for one suggestion, with the screenshot of each. */
export default function ReplaySteps({ suggestionId, onClose }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [index, setIndex] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const modalKeys = useModal(root, onClose)

  useEffect(() => {
    let alive = true
    setLoaded({ state: 'loading' })
    setIndex(0)
    getSuggestionSteps(suggestionId)
      .then((data) => {
        if (alive) setLoaded({ state: 'ready', data })
      })
      .catch((err: unknown) => {
        if (!alive) return
        const message = err instanceof EvidenceApiError && err.status === 404 ? NO_STEPS : err instanceof Error ? err.message : 'The steps could not be loaded.'
        setLoaded({ state: 'failed', message })
      })
    return () => {
      alive = false
    }
  }, [suggestionId])

  const steps = loaded.state === 'ready' ? loaded.data.steps : []
  const move = (by: number) => setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + by)))

  // On the document, not the dialog: when a click disables Next, focus drops to the page and the keys must still work.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1)
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1)
      else if (event.key === 'Escape' && !root.current?.contains(event.target as Node)) onClose()
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const current = steps[index]
  const navBtn =
    'inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="Replay of the AI's steps"
        tabIndex={-1}
        onKeyDown={modalKeys}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Replay steps</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close replay"
            className="rounded-lg p-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {loaded.state === 'loading' && <p className="p-8 text-center text-sm text-slate-500">Loading steps…</p>}
        {loaded.state === 'failed' && (
          <p role="alert" className="p-8 text-center text-sm text-slate-600">
            {loaded.message}
          </p>
        )}
        {loaded.state === 'ready' && !current && <p className="p-8 text-center text-sm text-slate-600">{NO_STEPS}</p>}
        {loaded.state === 'ready' && current && (
          <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 md:grid-cols-[18rem_1fr]">
            <ol aria-label="Steps" className="space-y-1 md:max-h-[70vh] md:overflow-auto">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={i === index ? 'step' : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      i === index ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{s.position}.</span>
                      {s.accountLabel && <span className="text-slate-500">{s.accountLabel}</span>}
                      <OutcomeChip step={s} />
                    </span>
                    <span className="mt-0.5 block break-words">{s.line}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Step {current.position} of {steps.length}
                </p>
                {current.accountLabel && <span className="text-xs text-slate-500">{current.accountLabel}</span>}
                <OutcomeChip step={current} />
              </div>
              <p className="break-words text-sm text-slate-900">{current.line}</p>
              {current.outcome !== 'done' && current.refusalReason && <p className="text-sm text-slate-600">{current.refusalReason}</p>}
              <StepShot step={current} />
              <div className="flex gap-2">
                <button type="button" onClick={() => move(-1)} disabled={index === 0} className={navBtn}>
                  <CaretLeft size={14} aria-hidden="true" />
                  Previous
                </button>
                <button type="button" onClick={() => move(1)} disabled={index >= steps.length - 1} className={navBtn}>
                  Next
                  <CaretRight size={14} aria-hidden="true" />
                </button>
              </div>
              {loaded.data.changes.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <AppChanges changes={loaded.data.changes} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

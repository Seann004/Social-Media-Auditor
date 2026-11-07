import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowsClockwiseIcon as ArrowsClockwise, PlayIcon as Play, RobotIcon as Robot } from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import { EvidenceApiError, getSources, reassess, saveSources, setPermission, startRun } from '../api'
import { toPickItems } from '../appState'
import type { EvidencePermission, RunScope, RunSource } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import { useAppSetup } from '../useAppSetup'
import type { ChecklistItem, UserRole } from '../../../types'
import AppRunSection from './AppRunSection'
import PanelBoundary from './PanelBoundary'
import PermissionControl from './PermissionControl'
import { RunProgress, RunSummary } from './RunSummary'
import SourceChoice from './SourceChoice'

interface Props {
  projectId: string
  role: UserRole
  evidence: UseEvidenceResult
  /** The audit is pending review or approved: nothing may start. */
  locked: boolean
  /** The project's checklist, for the App item picker and item names. */
  checklistItems?: ChecklistItem[]
}

const SIGN_IN_AGAIN = 'AI evidence assessment is not available in this session. Sign out and sign in again. If this message stays, the server is not set up for it yet.'
const ACTIVE = ['queued', 'capturing', 'assessing']
const spring = { type: 'spring', stiffness: 100, damping: 20 } as const

export const parseLinks = (text: string): string[] =>
  text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

const asApiError = (err: unknown): EvidenceApiError =>
  err instanceof EvidenceApiError ? err : new EvidenceApiError(0, 'Something went wrong. Try again.')

const isBlocking = (err: EvidenceApiError | null): boolean => err !== null && (err.status === 401 || err.status === 403 || err.status === 503)

export default function EvidencePanel(props: Props) {
  if (props.role !== 'auditor' && props.role !== 'head_auditor') return null
  return (
    <PanelBoundary>
      <PanelBody key={props.projectId} {...props} />
    </PanelBoundary>
  )
}

function PanelBody({ projectId, role, evidence, locked, checklistItems }: Props) {
  const [text, setText] = useState('')
  const [savedLinks, setSavedLinks] = useState<string[]>([])
  const [permission, setPermissionState] = useState<EvidencePermission | null>(null)
  const [sourcesState, setSourcesState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [sourcesTry, setSourcesTry] = useState(0)
  const [sourcesError, setSourcesError] = useState<EvidenceApiError | null>(null)
  const [actionError, setActionError] = useState<EvidenceApiError | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const { run, pages, resultRun, suggestionsByItem, refresh } = evidence
  const sessionToken = useStore((s) => s.sessionToken)
  const [chosenSource, setChosenSource] = useState<RunSource | null>(null)
  const source: RunSource = chosenSource ?? resultRun?.source ?? 'pages'
  const appSetup = useAppSetup(projectId, { enabled: source === 'app' })
  const pickItems = useMemo(() => toPickItems(checklistItems ?? []), [checklistItems])

  useEffect(() => {
    let alive = true
    setSourcesState('loading')
    getSources(projectId)
      .then((res) => {
        if (!alive) return
        const urls = res.source?.startUrls ?? []
        setSavedLinks(urls)
        setText(urls.join('\n'))
        setPermissionState(res.permission)
        setSourcesError(null)
        setSourcesState('ok')
      })
      .catch((err: unknown) => {
        if (!alive) return
        setSourcesError(asApiError(err))
        setSourcesState('error')
      })
    return () => {
      alive = false
    }
    // Again when the session token arrives: a load made before it got a 401, as useEvidence did.
  }, [projectId, sourcesTry, sessionToken])

  // Any successful load or poll replaces these objects: a blocking action error is over by then.
  useEffect(() => {
    setActionError(null)
  }, [run, resultRun])

  const flaggedCount = useMemo(
    () => [...suggestionsByItem.values()].filter((s) => s.flags.length > 0).length,
    [suggestionsByItem],
  )

  const blocking = [evidence.error, sourcesError, actionError].find(isBlocking) ?? null
  if (blocking) {
    return (
      <div className="mx-4 my-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 md:mx-8">
        <p role="alert">{blocking.status === 401 ? SIGN_IN_AGAIN : blocking.message}</p>
        {blocking === actionError && blocking.status !== 401 ? (
          <button
            type="button"
            onClick={() => {
              setActionError(null)
              void refresh()
            }}
            className="rounded text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Try again
          </button>
        ) : null}
      </div>
    )
  }

  const running = run !== null && ACTIVE.includes(run.status)
  const canStart = !locked && sourcesState === 'ok' && !busy && !running
  // Re-assess acts on the result run, so it does not depend on the chosen source or the page links.
  const canReassess = source === 'pages' ? canStart : !locked && !busy && !running

  /**
   * Runs one action once at a time. A 409 from starting a run means one is already going, and the
   * refresh shows it. With `sayConflict` the 409 means something else, so its sentence is shown.
   */
  async function perform(action: () => Promise<unknown>, sayConflict = false): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    let blocked = false
    try {
      await action()
    } catch (err) {
      const error = asApiError(err)
      if (isBlocking(error)) {
        blocked = true
        setActionError(error)
      } else if (sayConflict || error.status !== 409) setMessage(error.message)
    }
    try {
      if (!blocked) await refresh()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const onRun = () =>
    perform(async () => {
      const links = parseLinks(text)
      if (!sameList(links, savedLinks)) {
        await saveSources(projectId, links)
        setSavedLinks(links)
      }
      await startRun(projectId)
    })

  const onReassess = (scope: RunScope) => perform(() => reassess(projectId, resultRun!.id, scope), true)

  /** Resolves to an error sentence to show beside the control, or null when saved. */
  const onSavePermission = async (granted: boolean, note: string | undefined): Promise<string | null> => {
    try {
      const res = await setPermission(projectId, granted, note)
      setPermissionState(res.permission)
      return null
    } catch (err) {
      const error = asApiError(err)
      if (isBlocking(error)) setActionError(error)
      return error.message
    }
  }

  return (
    <motion.section
      aria-labelledby="evidence-panel-title"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="mx-4 my-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250/0.06)] md:mx-8"
    >
      <div className="flex items-center gap-2">
        <Robot size={16} className="text-blue-600" aria-hidden="true" />
        <h2 id="evidence-panel-title" className="text-sm font-semibold text-slate-900">AI evidence assessment</h2>
      </div>
      <p className="max-w-[65ch] text-xs text-slate-500">
        Suggestions only. Nothing changes your answers or the score until you accept or override it.
      </p>

      <SourceChoice value={source} onChange={setChosenSource} />

      {source === 'app' ? (
        appSetup.setup ? (
          <AppRunSection
            projectId={projectId}
            setup={appSetup.setup}
            items={pickItems}
            evidence={evidence}
            locked={locked}
            onStarted={refresh}
            onSetupSaved={appSetup.reload}
          />
        ) : appSetup.error ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-xs text-rose-600">{appSetup.error.message}</p>
            <button
              type="button"
              onClick={() => void appSetup.reload()}
              className="rounded text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Loading…</p>
        )
      ) : sourcesState === 'loading' ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : sourcesState === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-rose-600">{sourcesError?.message}</p>
          <button
            type="button"
            onClick={() => setSourcesTry((n) => n + 1)}
            className="rounded text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Try again
          </button>
        </div>
      ) : (
        <div>
          <label htmlFor="evidence-links" className="mb-1 block text-xs font-medium text-slate-700">
            Website links (one per line)
          </label>
          <textarea
            id="evidence-links"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={locked}
            rows={3}
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
          />
        </div>
      )}

      {evidence.error ? <p role="alert" className="text-xs text-rose-600">{evidence.error.message}</p> : null}
      {message ? <p role="alert" className="text-xs text-rose-600">{message}</p> : null}

      {!locked ? (
        <div className="flex flex-wrap items-center gap-2">
          {source === 'pages' ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={() => void onRun()}
            disabled={!canStart}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={14} weight="fill" aria-hidden="true" />
            Run assessment
          </motion.button>
          ) : null}
          {resultRun ? (
            <>
              <button
                type="button"
                onClick={() => void onReassess('unfinished')}
                disabled={!canReassess}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowsClockwise size={14} aria-hidden="true" />
                Re-assess unfinished
              </button>
              <button
                type="button"
                onClick={() => void onReassess('all')}
                disabled={!canReassess}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Re-assess all categories
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {run && running ? <RunProgress run={run} pages={pages} items={pickItems} /> : null}
      {run && run.status === 'failed' && run.error ? (
        <p role="alert" className="text-xs text-rose-600">{run.error}</p>
      ) : null}
      {resultRun ? (
        <RunSummary
          resultRun={resultRun}
          suggestionCount={suggestionsByItem.size}
          flaggedCount={flaggedCount}
          pages={pages}
          pagesBelongToResult={run?.id === resultRun.id}
          items={pickItems}
        />
      ) : null}

      {role === 'head_auditor' && sourcesState === 'ok' && source === 'pages' ? (
        <PermissionControl permission={permission} onSave={onSavePermission} />
      ) : null}
    </motion.section>
  )
}

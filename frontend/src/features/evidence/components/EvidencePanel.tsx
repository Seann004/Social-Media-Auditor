import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { EvidenceApiError, getSources, reassess, saveSources, setPermission, startRun } from '../api'
import { isAppSetupComplete, toPickItems } from '../appState'
import { SOURCE_LABEL, barStatus } from '../barStatus'
import type { SetupState } from '../barStatus'
import { PUBLIC_PAGES_ENABLED_IN_BUILD } from '../config'
import type { EvidencePermission, RunScope, RunSource } from '../types'
import type { UseEvidenceResult } from '../useEvidence'
import { isRunActive } from '../useItemRun'
import { useAppSetup } from '../useAppSetup'
import type { UseAppSetupResult } from '../useAppSetup'
import { useRepoSetup } from '../useRepoSetup'
import type { UseRepoSetupResult } from '../useRepoSetup'
import type { ChecklistItem, UserRole } from '../../../types'
import AppRunSection from './AppRunSection'
import DrawerStep from './DrawerStep'
import EvidenceBar, { BlockedBar } from './EvidenceBar'
import EvidenceDrawer from './EvidenceDrawer'
import PagesSection from './PagesSection'
import PanelBoundary from './PanelBoundary'
import RepoRunSection from './RepoRunSection'
import RunResults from './RunResults'
import SourceChoice from './SourceChoice'

interface Props {
  projectId: string
  role: UserRole
  evidence: UseEvidenceResult
  /** The audit is pending review or approved: nothing may start. */
  locked: boolean
  /** The project's checklist, for the App item picker and item names. */
  checklistItems?: ChecklistItem[]
  /** Offer the Public pages source. Defaults to the switch in config.ts; tests override it. */
  publicPagesEnabled?: boolean
}

const SIGN_IN_AGAIN = 'AI evidence assessment is not available in this session. Sign out and sign in again. If this message stays, the server is not set up for it yet.'

export const parseLinks = (text: string): string[] =>
  text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

const asApiError = (err: unknown): EvidenceApiError =>
  err instanceof EvidenceApiError ? err : new EvidenceApiError(0, 'Something went wrong. Try again.')

const isBlocking = (err: EvidenceApiError | null): boolean => err !== null && (err.status === 401 || err.status === 403 || err.status === 503)

/** Whether the chosen source has what a run needs, for the bar. */
function setupStateOf(
  source: RunSource,
  app: UseAppSetupResult,
  repo: UseRepoSetupResult,
  pages: { state: 'loading' | 'ok' | 'error'; links: string[] },
): SetupState {
  if (source === 'app') {
    if (app.setup) return isAppSetupComplete(app.setup) ? 'ready' : 'needed'
    return app.error ? 'needed' : 'loading'
  }
  if (source === 'repo') return repo.state === 'loading' ? 'loading' : repo.repo ? 'ready' : 'needed'
  return pages.state === 'loading' ? 'loading' : pages.links.length > 0 ? 'ready' : 'needed'
}

/** Step ② of the App source while its set-up is loading or failed to load. */
function AppSetupPending({ app }: { app: UseAppSetupResult }) {
  return (
    <DrawerStep n={2} title="Set up" state="current">
      {app.error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-rose-600">{app.error.message}</p>
          <button
            type="button"
            onClick={() => void app.reload()}
            className="rounded text-xs text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Try again
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Loading…</p>
      )}
    </DrawerStep>
  )
}

export default function EvidencePanel(props: Props) {
  if (props.role !== 'auditor' && props.role !== 'head_auditor') return null
  return (
    <PanelBoundary>
      <PanelBody key={props.projectId} {...props} />
    </PanelBoundary>
  )
}

function PanelBody({ projectId, role, evidence, locked, checklistItems, publicPagesEnabled = PUBLIC_PAGES_ENABLED_IN_BUILD }: Props) {
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
  const authToken = useStore((s) => s.authToken)
  const [chosenSource, setChosenSource] = useState<RunSource | null>(null)
  // With Public pages off, the screen never shows the page-links flow, even over an old pages run:
  // that run's summary and cards still render, and Re-assess still works on it.
  const wanted: RunSource = chosenSource ?? resultRun?.source ?? (publicPagesEnabled ? 'pages' : 'app')
  const source: RunSource = wanted === 'pages' && !publicPagesEnabled ? 'app' : wanted
  const appSetup = useAppSetup(projectId, { enabled: source === 'app' })
  const repoSetup = useRepoSetup(projectId, { enabled: source === 'repo' })
  const pickItems = useMemo(() => toPickItems(checklistItems ?? []), [checklistItems])
  // The drawer's open state lives here, is not saved, and starts closed.
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drawerId = useId()

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
    // Again when the auth token arrives: a load made before it got a 401, as useEvidence did.
  }, [projectId, sourcesTry, authToken])

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
    const retry = () => {
      setActionError(null)
      void refresh()
    }
    return (
      <BlockedBar
        message={blocking.status === 401 ? SIGN_IN_AGAIN : blocking.message}
        onRetry={blocking === actionError && blocking.status !== 401 ? retry : undefined}
      />
    )
  }

  const openDrawer = (): void => {
    if (open) panelRef.current?.focus()
    else setOpen(true)
  }
  const closeDrawer = (): void => {
    setOpen(false)
    openerRef.current?.focus()
  }
  const status = barStatus({
    locked,
    run,
    resultRun,
    suggestionCount: suggestionsByItem.size,
    flaggedCount,
    items: pickItems,
    setup: setupStateOf(source, appSetup, repoSetup, { state: sourcesState, links: savedLinks }),
  })

  const running = isRunActive(run)
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
    <>
      <EvidenceBar
        sourceLabel={SOURCE_LABEL[source]}
        status={status}
        locked={locked}
        open={open}
        drawerId={drawerId}
        onOpen={openDrawer}
        openerRef={openerRef}
      />
      <EvidenceDrawer id={drawerId} open={open} onClose={closeDrawer} panelRef={panelRef}>
        {evidence.error ? <p role="alert" className="text-xs text-rose-600">{evidence.error.message}</p> : null}
        {message ? <p role="alert" className="text-xs text-rose-600">{message}</p> : null}
        <RunResults
          run={run}
          pages={pages}
          resultRun={resultRun}
          suggestionCount={suggestionsByItem.size}
          flaggedCount={flaggedCount}
          items={pickItems}
          locked={locked}
          canReassess={canReassess}
          onReassess={(scope) => void onReassess(scope)}
        />

        <DrawerStep n={1} title="Source" state="done">
          <SourceChoice value={source} onChange={setChosenSource} publicPagesEnabled={publicPagesEnabled} />
        </DrawerStep>

        {source === 'repo' ? (
          <RepoRunSection projectId={projectId} setup={repoSetup} items={pickItems} evidence={evidence} locked={locked} onStarted={refresh} />
        ) : source === 'app' ? (
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
          ) : (
            <AppSetupPending app={appSetup} />
          )
        ) : (
          <PagesSection
            text={text}
            onText={setText}
            linkCount={parseLinks(text).length}
            locked={locked}
            state={sourcesState}
            error={sourcesError}
            onRetry={() => setSourcesTry((n) => n + 1)}
            hasSavedLinks={savedLinks.length > 0}
            canStart={canStart}
            onRun={() => void onRun()}
            showPermission={role === 'head_auditor' && sourcesState === 'ok'}
            permission={permission}
            onSavePermission={onSavePermission}
          />
        )}
      </EvidenceDrawer>
    </>
  )
}

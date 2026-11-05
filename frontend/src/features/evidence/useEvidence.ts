import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { EvidenceApiError, getLatestRun, getSuggestions } from './api'
import type {
  DecisionView,
  LatestRunResponse,
  PageView,
  RunStatus,
  RunView,
  SuggestionsResponse,
  SuggestionView,
} from './types'

const POLL_INTERVAL_MS = 3000
/** Consecutive failed polls before the panel shows a problem (one 500 in a poll is normal noise). */
const QUIET_FAILURES = 3
const ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set(['queued', 'capturing', 'assessing'])
/** Statuses that will not fix themselves, so polling stops. */
const FATAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 503])
const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'

export interface UseEvidenceResult {
  /** The latest run of any status: progress and failure messages come from here. */
  run: RunView | null
  /** Pages captured by the latest run. */
  pages: PageView[]
  /** The latest completed or partial run: the summary and the suggestions belong to it. */
  resultRun: RunView | null
  suggestionsByItem: Map<string, SuggestionView>
  decisionsByItem: Map<string, DecisionView>
  loading: boolean
  error: EvidenceApiError | null
  refresh(): Promise<void>
}

interface Snapshot {
  projectId: string
  run: RunView | null
  pages: PageView[]
  resultRun: RunView | null
  suggestionsByItem: Map<string, SuggestionView>
  decisionsByItem: Map<string, DecisionView>
}

const emptySnapshot = (projectId: string): Snapshot => ({
  projectId,
  run: null,
  pages: [],
  resultRun: null,
  suggestionsByItem: new Map(),
  decisionsByItem: new Map(),
})

const isActive = (run: RunView | null): boolean => run !== null && ACTIVE_STATUSES.has(run.status)

function toApiError(err: unknown): EvidenceApiError {
  return err instanceof EvidenceApiError ? err : new EvidenceApiError(0, NETWORK_MESSAGE)
}

export function useEvidence(projectId: string, options: { enabled: boolean }): UseEvidenceResult {
  const { enabled } = options
  // The token arrives after login without blocking it. A load made before then got a 401, which stops polling.
  const sessionToken = useStore((s) => s.sessionToken)
  const [snapshot, setSnapshot] = useState<Snapshot>(() => emptySnapshot(projectId))
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<EvidenceApiError | null>(null)
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    if (!enabled) {
      refreshRef.current = () => Promise.resolve()
      return
    }

    setError(null)
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let polling: Promise<void> | null = null
    let refreshing: Promise<void> | null = null
    let failures = 0
    let latestIsActive = false
    let stopped = false
    /** A finished run whose suggestions have not been fetched yet: keep retrying until they arrive. */
    let suggestionsPending = false

    const applyLatest = (res: LatestRunResponse): void => {
      latestIsActive = isActive(res.run)
      setSnapshot((prev) => ({ ...(prev.projectId === projectId ? prev : emptySnapshot(projectId)), run: res.run, pages: res.pages }))
    }

    const applySuggestions = (res: SuggestionsResponse): void => {
      setSnapshot((prev) => ({
        ...(prev.projectId === projectId ? prev : emptySnapshot(projectId)),
        resultRun: res.run,
        suggestionsByItem: new Map(res.suggestions.map((s) => [s.itemId, s])),
        decisionsByItem: new Map(res.decisions.map((d) => [d.itemId, d])),
      }))
    }

    const succeeded = (): void => {
      failures = 0
      setError(null)
    }

    const failed = (err: EvidenceApiError, quiet: boolean): void => {
      if (FATAL_STATUSES.has(err.status)) {
        stopped = true
        setError(err)
        return
      }
      failures += 1
      if (!quiet || failures >= QUIET_FAILURES) setError(err)
    }

    const schedule = (): void => {
      if (!alive || stopped || !(latestIsActive || suggestionsPending) || timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void poll()
      }, POLL_INTERVAL_MS)
    }

    async function pollOnce(): Promise<void> {
      const wasActive = latestIsActive
      try {
        const res = await getLatestRun(projectId)
        if (!alive) return
        applyLatest(res)
        if (wasActive && !latestIsActive) suggestionsPending = true // finished, or swept as failed
        if (suggestionsPending) {
          const suggestions = await getSuggestions(projectId)
          if (!alive) return
          applySuggestions(suggestions)
          suggestionsPending = false
        }
        succeeded()
      } catch (err) {
        if (alive) failed(toApiError(err), true)
      }
    }

    async function poll(): Promise<void> {
      if (polling || refreshing) return // whoever is running will schedule the next poll
      polling = pollOnce()
      await polling
      polling = null
      schedule()
    }

    async function loadAll(): Promise<void> {
      const [latest, suggestions] = await Promise.allSettled([getLatestRun(projectId), getSuggestions(projectId)])
      if (!alive) return
      if (latest.status === 'fulfilled') applyLatest(latest.value)
      if (suggestions.status === 'fulfilled') {
        applySuggestions(suggestions.value)
        suggestionsPending = false
      } else if (latest.status === 'fulfilled' && !latestIsActive) {
        suggestionsPending = true
      }
      const problems = [latest, suggestions]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => toApiError(r.reason))
      if (problems.length === 0) succeeded()
      else failed(problems.find((p) => FATAL_STATUSES.has(p.status)) ?? problems[0], false)
    }

    /** A refresh asked for during another: the one in flight may predate it, so load once more afterwards. */
    let reloadAfter = false
    const refresh = (): Promise<void> => {
      if (refreshing) {
        reloadAfter = true
        return refreshing
      }
      refreshing = (async () => {
        if (polling) await polling
        stopped = false
        do {
          reloadAfter = false
          await loadAll()
        } while (reloadAfter && alive)
        refreshing = null
        schedule()
      })()
      return refreshing
    }

    refreshRef.current = refresh
    void refresh().then(() => {
      if (alive) setLoadedFor(projectId)
    })

    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
      refreshRef.current = () => Promise.resolve()
    }
  }, [projectId, enabled, sessionToken])

  const refresh = useCallback((): Promise<void> => refreshRef.current(), [])
  const current = snapshot.projectId === projectId ? snapshot : emptySnapshot(projectId)

  return {
    run: current.run,
    pages: current.pages,
    resultRun: current.resultRun,
    suggestionsByItem: current.suggestionsByItem,
    decisionsByItem: current.decisionsByItem,
    loading: enabled && loadedFor !== projectId,
    error: enabled ? error : null,
    refresh,
  }
}

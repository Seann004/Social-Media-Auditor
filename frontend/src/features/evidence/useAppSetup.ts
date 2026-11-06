import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { EvidenceApiError, getAppSetup } from './api'
import type { AppSetupResponse } from './types'

const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'

export interface UseAppSetupResult {
  setup: AppSetupResponse | null
  loading: boolean
  /** A 401, 403 or 503 stops loading and is shown here; so is any other failure. */
  error: EvidenceApiError | null
  reload(): Promise<void>
}

interface Loaded {
  projectId: string
  setup: AppSetupResponse | null
  error: EvidenceApiError | null
}

/** Loads the app address, test accounts and key state of a project once, and again on reload(). */
export function useAppSetup(projectId: string, options: { enabled: boolean }): UseAppSetupResult {
  const { enabled } = options
  const sessionToken = useStore((s) => s.sessionToken)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const loadRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    if (!enabled) {
      loadRef.current = () => Promise.resolve()
      return
    }
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const setup = await getAppSetup(projectId)
        if (alive) setLoaded({ projectId, setup, error: null })
      } catch (err) {
        const error = err instanceof EvidenceApiError ? err : new EvidenceApiError(0, NETWORK_MESSAGE)
        if (alive) setLoaded((prev) => ({ projectId, setup: prev?.projectId === projectId ? prev.setup : null, error }))
      }
    }
    loadRef.current = load
    void load()
    return () => {
      alive = false
      loadRef.current = () => Promise.resolve()
    }
  }, [projectId, enabled, sessionToken])

  const reload = useCallback((): Promise<void> => loadRef.current(), [])
  const current = loaded?.projectId === projectId ? loaded : null
  return {
    setup: enabled ? (current?.setup ?? null) : null,
    loading: enabled && current === null,
    error: enabled ? (current?.error ?? null) : null,
    reload,
  }
}

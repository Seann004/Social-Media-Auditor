import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { EvidenceApiError, getRepoSource, saveRepoSource } from './api'
import type { RepoSourceView } from './types'

export interface RepoInput {
  repoUrl: string
  branch: string | null
}

export interface UseRepoSetupResult {
  repo: RepoSourceView | null
  state: 'loading' | 'ok' | 'error'
  /** Resolves to the server's refusal sentence, or null when saved. */
  save(input: RepoInput): Promise<string | null>
}

interface Loaded {
  projectId: string
  repo: RepoSourceView | null
  failed: boolean
}

const sentence = (err: unknown): string => (err instanceof EvidenceApiError ? err.message : 'Something went wrong. Try again.')

/** Loads the saved repository of a project once, and saves a new one. */
export function useRepoSetup(projectId: string, options: { enabled: boolean }): UseRepoSetupResult {
  const { enabled } = options
  const sessionToken = useStore((s) => s.sessionToken)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    getRepoSource(projectId)
      .then((res) => {
        if (alive) setLoaded({ projectId, repo: res.repo, failed: false })
      })
      .catch(() => {
        if (alive) setLoaded((prev) => ({ projectId, repo: prev?.projectId === projectId ? prev.repo : null, failed: true }))
      })
    return () => {
      alive = false
    }
  }, [projectId, enabled, sessionToken])

  const save = useCallback(
    async (input: RepoInput): Promise<string | null> => {
      try {
        const res = await saveRepoSource(projectId, input)
        setLoaded({ projectId, repo: res.repo, failed: false })
        return null
      } catch (err) {
        return sentence(err)
      }
    },
    [projectId],
  )

  const current = loaded?.projectId === projectId ? loaded : null
  const state = !enabled || current === null ? 'loading' : current.failed ? 'error' : 'ok'
  return { repo: enabled ? (current?.repo ?? null) : null, state, save }
}

import { useEffect, useState } from 'react'
import { getSuggestions } from './api'
import type { DecisionView } from './types'

/**
 * The decisions of a project, by item, for the provenance badges on a report.
 * Best effort: the report never waits for this, and any failure (no session, 401, 403, 503, network) means no badges.
 * Null until the decisions are known, so "Manual" is never shown for an answer whose source could not be checked.
 */
export function useReportDecisions(projectId: string | null): ReadonlyMap<string, DecisionView> | null {
  const [loaded, setLoaded] = useState<{ projectId: string; decisions: ReadonlyMap<string, DecisionView> } | null>(null)

  useEffect(() => {
    if (projectId === null) return
    let alive = true
    getSuggestions(projectId)
      .then((res) => {
        if (alive) setLoaded({ projectId, decisions: new Map(res.decisions.map((d) => [d.itemId, d])) })
      })
      .catch(() => {
        // No badges. The report is complete without them.
      })
    return () => {
      alive = false
    }
  }, [projectId])

  return loaded !== null && loaded.projectId === projectId ? loaded.decisions : null
}

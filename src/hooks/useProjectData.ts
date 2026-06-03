import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import * as db from '../lib/db'
import type { AuditResponse, ChecklistItem } from '../types'

interface ProjectData {
  checklistItems: ChecklistItem[]
  responses: Record<string, AuditResponse>
  loading: boolean
  error: string | null
  reload: () => void
}

export function useProjectData(projectId: string | undefined): ProjectData {
  const currentUserId = useStore((s) => s.currentUserId)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [responses, setResponses] = useState<Record<string, AuditResponse>>({})

  const load = useCallback(async () => {
    if (!projectId || !currentUserId) return
    setLoading(true)
    setError(null)
    try {
      const [dbItems, dbResults] = await Promise.all([
        db.fetchProjectChecklistItems(projectId),
        db.fetchAuditResults(projectId),
      ])

      const mapped: ChecklistItem[] = dbItems.map((i) => ({
        id: i.itemId,
        guidelineId: i.guidelineId,
        category: i.category ?? 'General',
        text: i.itemDescription,
        severity: i.severity,
        reference: i.reference ?? undefined,
        feature: i.feature ?? undefined,
      }))

      const respMap: Record<string, AuditResponse> = {}
      for (const r of dbResults) {
        respMap[`${projectId}__${r.itemId}`] = {
          id: r.resultId,
          projectId: r.projectId,
          checklistItemId: r.itemId,
          status: r.result,
          notes: r.notes ?? '',
          auditorId: r.userId,
          updatedAt: r.timeSubmitted?.split('T')[0] ?? '',
        }
      }

      setItems(mapped)
      setResponses(respMap)

      // Sync into the store so getProjectScore / getCategoryScore work
      useStore.setState((state) => {
        const untouched = state.checklistItems.filter((ci) => !mapped.some((m) => m.id === ci.id))
        return {
          checklistItems: [...untouched, ...mapped],
          responses: { ...state.responses, ...respMap },
        }
      })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId, currentUserId])

  useEffect(() => { load() }, [load])

  return { checklistItems: items, responses, loading, error, reload: load }
}

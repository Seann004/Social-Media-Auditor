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
      const [dbItems, dbResults, projectDetails] = await Promise.all([
        db.fetchProjectChecklistItems(projectId),
        db.fetchAuditResults(projectId),
        db.fetchProjectDetails(projectId),
      ])

      const mapped: ChecklistItem[] = dbItems.map((i) => ({
        id: i.itemId,
        guidelineId: i.guidelineId,
        category: i.category ?? 'General',
        text: i.itemDescription,
        severity: i.severity,
        reference: i.reference ?? undefined,
        itemName: i.itemName ?? undefined,
        itemCode: i.itemCode ?? undefined,
        rowType: i.rowType ?? undefined,
        helpText: i.helpText ?? undefined,
        verbatimClauseText: i.verbatimClauseText ?? undefined,
        answerOptions: i.answerOptions ?? undefined,
      }))

      const respMap: Record<string, AuditResponse> = {}
      for (const r of dbResults) {
        respMap[`${projectId}__${r.itemId}`] = {
          id: r.resultId,
          projectId: r.projectId,
          checklistItemId: r.itemId,
          status: r.result,
          notes: r.notes ?? '',
          findings: r.findings ?? undefined,
          auditorId: r.userId,
          updatedAt: r.timeSubmitted?.split('T')[0] ?? '',
        }
      }

      setItems(mapped)
      setResponses(respMap)

      // Sync into the store so getProjectScore / getCategoryScore work
      useStore.setState((state) => {
        const untouched = state.checklistItems.filter((ci) => !mapped.some((m) => m.id === ci.id))
        
        // Map project guidelines
        const mappedGuidelines = (projectDetails?.guidelines || []).map((g: any) => ({
          id: g.guidelineId,
          name: g.guidelineName,
          shortName: g.shortName || g.guidelineName,
          version: g.version || '1.0',
          description: g.description || '',
          source: g.source || '',
          categories: g.categories || [],
          itemCount: g.itemCount || 0,
          lastUpdated: g.lastUpdated || '',
          isDeleted: false,
          projectId: projectId,
          originalGuidelineId: g.originalGuidelineId || null
        }))

        // Merge guidelines
        const otherGuidelines = state.guidelines.filter(g => !mappedGuidelines.some(mg => mg.id === g.id))

        // Update project in projects list
        const updatedProjects = state.projects.map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              guidelineIds: mappedGuidelines.map(mg => mg.id),
              scope: projectDetails?.scope || [],
              auditorIds: (projectDetails?.members || []).map((m: any) => m.userId),
            }
          }
          return p
        })

        return {
          checklistItems: [...untouched, ...mapped],
          responses: { ...state.responses, ...respMap },
          guidelines: [...otherGuidelines, ...mappedGuidelines],
          projects: updatedProjects,
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

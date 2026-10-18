import { useEffect, useState, useCallback, useRef } from 'react'
import { useStore, reconcileResponse, type ResolutionInfo } from '../store/useStore'
import * as db from '../lib/db'
import type { AuditResponse, ChecklistItem } from '../types'

interface ProjectData {
  checklistItems: ChecklistItem[]
  responses: Record<string, AuditResponse>
  allResponses: Record<string, AuditResponse[]>
  resolutions: Record<string, ResolutionInfo>
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
  const [allResponses, setAllResponses] = useState<Record<string, AuditResponse[]>>({})
  const [resolutions, setResolutions] = useState<Record<string, ResolutionInfo>>({})
  const loadGen = useRef(0)

  const load = useCallback(async () => {
    const myGen = ++loadGen.current
    if (!projectId || !currentUserId) return
    setLoading(true)
    setError(null)
    try {
      const [dbItems, dbResults, projectDetails, dbResolutions] = await Promise.all([
        db.fetchProjectChecklistItems(projectId),
        db.fetchAuditResults(projectId),
        db.fetchProjectDetails(projectId),
        db.fetchResolutions(projectId),
      ])

      // A newer load (project id changed, reload, logout) has started; drop this stale response.
      if (myGen !== loadGen.current) return

      const resolutionMap: Record<string, ResolutionInfo> = {}
      for (const r of dbResolutions) {
        resolutionMap[`${projectId}__${r.itemId}`] = {
          status: r.resolvedStatus,
          resolvedBy: r.resolvedBy,
          notes: r.notes ?? undefined,
          resolvedAt: r.resolvedAt?.split('T')[0] ?? '',
        }
      }

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

      const grouped = new Map<string, AuditResponse[]>()
      for (const r of dbResults) {
        const key = `${projectId}__${r.itemId}`
        const resp: AuditResponse = {
          id: r.resultId,
          projectId: r.projectId,
          checklistItemId: r.itemId,
          status: r.result,
          notes: r.notes ?? '',
          findings: r.findings ?? undefined,
          auditorId: r.userId,
          updatedAt: r.timeSubmitted?.split('T')[0] ?? '',
        }
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(resp)
      }

      const respMap: Record<string, AuditResponse> = {}
      const allRespMap: Record<string, AuditResponse[]> = {}
      for (const [key, rows] of grouped) {
        allRespMap[key] = rows
        const reconciled = reconcileResponse(rows, resolutionMap[key]?.status)
        if (reconciled) respMap[key] = reconciled
      }

      setItems(mapped)
      setResponses(respMap)
      setAllResponses(allRespMap)
      setResolutions(resolutionMap)

      useStore.setState((state) => {
        const untouched = state.checklistItems.filter((ci) => !mapped.some((m) => m.id === ci.id))
        
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

        const otherGuidelines = state.guidelines.filter(g => !mappedGuidelines.some(mg => mg.id === g.id))

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
          allResponses: { ...state.allResponses, ...allRespMap },
          resolutions: { ...state.resolutions, ...resolutionMap },
          guidelines: [...otherGuidelines, ...mappedGuidelines],
          projects: updatedProjects,
        }
      })
    } catch (err) {
      if (myGen !== loadGen.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (myGen === loadGen.current) setLoading(false)
    }
  }, [projectId, currentUserId])

  useEffect(() => { load() }, [load])

  return { checklistItems: items, responses, allResponses, resolutions, loading, error, reload: load }
}

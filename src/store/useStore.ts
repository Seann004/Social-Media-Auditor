import { create } from 'zustand'
import type { AuditProject, AuditResponse, ChecklistItemStatus, Platform, ProjectScore } from '../types'
import {
  USERS,
  CURRENT_USER_ID,
  GUIDELINES,
  CHECKLIST_ITEMS,
  AUDIT_PROJECTS,
  INITIAL_RESPONSES,
} from '../data/mockData'

type ResponseMap = Record<string, AuditResponse>

interface NewProjectInput {
  platform: Platform
  guidelineIds: string[]
  auditorIds: string[]
  dueDate?: string
  notes?: string
}

interface StoreState {
  isAuthenticated: boolean
  users: typeof USERS
  currentUserId: string
  guidelines: typeof GUIDELINES
  checklistItems: typeof CHECKLIST_ITEMS
  projects: AuditProject[]
  responses: ResponseMap
  login: (userId: string) => void
  logout: () => void
  createProject: (input: NewProjectInput) => string
  setResponse: (projectId: string, itemId: string, status: ChecklistItemStatus, notes?: string) => void
  getProjectScore: (projectId: string) => ProjectScore
  getCategoryScore: (projectId: string, category: string) => ProjectScore
}

export const MOCK_CREDENTIALS: Record<string, { password: string; userId: string }> = {
  'jackie@safetyaudit.org': { password: 'audit2026', userId: 'u1' },
  'john@safetyaudit.org': { password: 'audit2026', userId: 'u2' },
  'ahmad@safetyaudit.org': { password: 'audit2026', userId: 'u3' },
  'sanji@safetyaudit.org': { password: 'audit2026', userId: 'u4' },
}

function rkey(projectId: string, itemId: string) {
  return `${projectId}__${itemId}`
}

function emptyScore(): ProjectScore {
  return { total: 0, compliant: 0, nonCompliant: 0, notApplicable: 0, answered: 0, applicable: 0, percentage: 0, progress: 0 }
}

function calcScore(items: typeof CHECKLIST_ITEMS, responses: ResponseMap, projectId: string): ProjectScore {
  const total = items.length
  let compliant = 0
  let nonCompliant = 0
  let notApplicable = 0
  let answered = 0

  for (const item of items) {
    const resp = responses[rkey(projectId, item.id)]
    if (!resp || resp.status === 'not_started') continue
    answered++
    if (resp.status === 'compliant') compliant++
    else if (resp.status === 'non_compliant') nonCompliant++
    else if (resp.status === 'not_applicable') notApplicable++
  }

  const applicable = answered - notApplicable
  const percentage = applicable > 0 ? Math.round((compliant / applicable) * 1000) / 10 : 0
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0
  return { total, compliant, nonCompliant, notApplicable, answered, applicable, percentage, progress }
}

export const useStore = create<StoreState>((set, get) => ({
  isAuthenticated: false,
  users: USERS,
  currentUserId: CURRENT_USER_ID,
  guidelines: GUIDELINES,
  checklistItems: CHECKLIST_ITEMS,
  projects: AUDIT_PROJECTS,
  responses: INITIAL_RESPONSES.reduce<ResponseMap>((acc, r) => {
    acc[rkey(r.projectId, r.checklistItemId)] = r
    return acc
  }, {}),

  login: (userId) => set({ isAuthenticated: true, currentUserId: userId }),
  logout: () => set({ isAuthenticated: false, currentUserId: CURRENT_USER_ID }),

  createProject: ({ platform, guidelineIds, auditorIds, dueDate, notes }) => {
    const id = `p_${Date.now()}`
    const today = new Date().toISOString().split('T')[0]
    const newProject: AuditProject = {
      id,
      platform,
      guidelineIds,
      status: 'draft',
      headAuditorId: get().currentUserId,
      auditorIds: Array.from(new Set([get().currentUserId, ...auditorIds])),
      createdAt: today,
      updatedAt: today,
      dueDate: dueDate || undefined,
      scope: [],
      notes: notes ?? '',
    }
    set((state) => ({ projects: [...state.projects, newProject] }))
    return id
  },

  setResponse: (projectId, itemId, status, notes = '') => {
    set((state) => {
      const key = rkey(projectId, itemId)
      const existing = state.responses[key]
      return {
        responses: {
          ...state.responses,
          [key]: {
            id: existing?.id ?? `r_${Date.now()}`,
            projectId,
            checklistItemId: itemId,
            status,
            notes,
            auditorId: state.currentUserId,
            updatedAt: new Date().toISOString().split('T')[0],
          },
        },
      }
    })
  },

  getProjectScore: (projectId) => {
    const { projects, checklistItems, responses } = get()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return emptyScore()
    const items = checklistItems.filter((item) => project.guidelineIds.includes(item.guidelineId))
    return calcScore(items, responses, projectId)
  },

  getCategoryScore: (projectId, category) => {
    const { projects, checklistItems, responses } = get()
    const project = projects.find((p) => p.id === projectId)
    if (!project) return emptyScore()
    const items = checklistItems.filter(
      (item) => project.guidelineIds.includes(item.guidelineId) && item.category === category,
    )
    return calcScore(items, responses, projectId)
  },
}))
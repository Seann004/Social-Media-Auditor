import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AuditProject,
  AuditResponse,
  AuditStatus,
  ChecklistItem,
  ChecklistItemStatus,
  Guideline,
  Platform,
  ProjectScore,
  SubmissionStatus,
  User,
  UserRole,
  Severity,
} from '../types'
import * as db from '../lib/db'

type ResponseMap = Record<string, AuditResponse>

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-blue-600',
  head_auditor: 'bg-violet-500',
  auditor: 'bg-emerald-500',
}

function rkey(projectId: string, itemId: string) {
  return `${projectId}__${itemId}`
}

function emptyScore(): ProjectScore {
  return { total: 0, compliant: 0, nonCompliant: 0, notApplicable: 0, answered: 0, applicable: 0, percentage: 0, progress: 0 }
}

function calcScore(items: ChecklistItem[], responses: ResponseMap, projectId: string): ProjectScore {
  const total = items.length
  let compliant = 0, nonCompliant = 0, notApplicable = 0, answered = 0
  for (const item of items) {
    const resp = responses[rkey(projectId, item.id)]
    if (!resp || resp.status === 'not_started' || resp.status === 'needs_review') continue
    answered++
    if (resp.status === 'compliant') compliant++
    else if (resp.status === 'non_compliant' || resp.status === 'partially') nonCompliant++
    else if (resp.status === 'not_applicable') notApplicable++
  }
  const applicable = answered - notApplicable
  const percentage = applicable > 0 ? Math.round((compliant / applicable) * 1000) / 10 : 0
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0
  return { total, compliant, nonCompliant, notApplicable, answered, applicable, percentage, progress }
}

// Map DB row → frontend AuditProject
function mapDbProject(p: db.DbProject): AuditProject {
  return {
    id: p.projectId,
    name: p.projectTitle,
    platform: p.smPlatform,
    status: p.projectStatus,
    submissionStatus: p.submissionStatus,
    submissionRemarks: p.submissionRemarks ?? undefined,
    headAuditorId: p.headAuditorId,
    auditorIds: p.memberIds ?? [],
    guidelineIds: p.guidelineIds ?? [],
    notes: p.projectNotes ?? '',
    dueDate: p.dueDate ?? undefined,
    createdAt: p.timeCreated?.split('T')[0] ?? '',
    updatedAt: p.updatedAt?.split('T')[0] ?? '',
    scope: [],
  }
}

// Map DB row → frontend Guideline
function mapDbGuideline(g: db.DbGuideline): Guideline {
  return {
    id: g.guidelineId,
    name: g.guidelineName,
    shortName: g.shortName ?? g.guidelineName,
    version: g.version ?? '1.0',
    description: g.description ?? '',
    source: g.source ?? '',
    categories: g.categories ?? [],
    itemCount: g.itemCount ?? 0,
    lastUpdated: g.lastUpdated ?? '',
    isDeleted: g.isDeleted,
  }
}

// Map DB row → frontend ChecklistItem
function mapDbItem(i: db.DbChecklistItem): ChecklistItem {
  return {
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
  }
}

interface StoreState {
  isAuthenticated: boolean
  users: User[]
  currentUserId: string
  guidelines: Guideline[]
  checklistItems: ChecklistItem[]
  projects: AuditProject[]
  responses: ResponseMap
  complianceMap: Record<string, number>  // projectId → avg score % from DB
  loading: boolean
  dbError: string | null

  login: (userId: string, name: string, role: UserRole) => void
  logout: () => void
  register: (email: string, name: string, role: UserRole, password?: string) => Promise<void>
  initFromDb: () => Promise<void>

  // Audit Management
  createProject: (input: {
    name: string; platform: Platform; guidelineIds: string[]
    auditorIds: string[]; dueDate?: string; notes?: string
  }) => Promise<string>
  updateProject: (projectId: string, updates: Partial<Pick<AuditProject, 'name' | 'platform' | 'status' | 'notes' | 'dueDate' | 'scope'>>) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>

  // Manage Guideline Used
  syncProjectGuidelines: (projectId: string, guidelineIds: string[]) => Promise<void>

  // Manage Audit Feature (scope)
  syncProjectScope: (projectId: string, features: string[]) => Promise<void>

  // Manage Auditors
  addAuditorToProject: (projectId: string, userId: string) => Promise<void>
  removeAuditorFromProject: (projectId: string, userId: string) => Promise<void>

  // Checklist Item management
  updateChecklistItem: (itemId: string, updates: Partial<Pick<ChecklistItem, 'text' | 'severity' | 'category'>>) => Promise<void>
  deleteChecklistItem: (itemId: string) => Promise<void>
  addChecklistItem: (projectId: string, input: {
    category: string
    text: string
    severity: Severity
    reference?: string
    guidelineId: string
    itemName?: string
    itemCode?: string
    helpText?: string
    verbatimClauseText?: string
    answerOptions?: string
  }) => Promise<void>
  toggleProjectChecklistCategory: (projectId: string, input: {
    category: string
    enabled: boolean
    guidelineId: string
  }) => Promise<void>

  // Submission workflow
  submitForReview: (projectId: string) => Promise<void>
  reviewSubmission: (projectId: string, approved: boolean, remarks: string) => Promise<void>

  // Guideline management (admin)
  deleteGuideline: (guidelineId: string) => Promise<void>
  addSyntheticGuideline: (guideline: Guideline, items: ChecklistItem[]) => Promise<void>

  // Audit responses
  setResponse: (projectId: string, itemId: string, guidelineId: string, status: ChecklistItemStatus, notes?: string, findings?: string) => Promise<void>
  saveFindings: (projectId: string, itemId: string, findings: string) => Promise<void>

  // Score helpers
  getProjectScore: (projectId: string) => ProjectScore
  getCategoryScore: (projectId: string, category: string) => ProjectScore
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
  isAuthenticated: false,
  users: [],
  currentUserId: '',
  guidelines: [],
  checklistItems: [],
  projects: [],
  responses: {},
  complianceMap: {},
  loading: false,
  dbError: null,

  login: (userId, name, role) => {
    const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const color = ROLE_COLORS[role] ?? 'bg-slate-500'
    const loggedInUser: User = { id: userId, name, role, initials, color }
    set((state) => ({
      isAuthenticated: true,
      currentUserId: userId,
      users: state.users.some((u) => u.id === userId)
        ? state.users.map((u) => (u.id === userId ? loggedInUser : u))
        : [...state.users, loggedInUser],
    }))
  },

  logout: () => set({ isAuthenticated: false, currentUserId: '', projects: [], responses: {}, checklistItems: [] }),

  register: async (email, name, role, password) => {
    const id = window.crypto.randomUUID()
    const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const color = ROLE_COLORS[role] ?? 'bg-slate-500'
    
    set({ loading: true, dbError: null })
    try {
      await db.createUser({
        userId: id,
        userName: name,
        userEmail: email,
        role: role,
        userPassword: password
      })
      set((state) => ({
        isAuthenticated: true,
        currentUserId: id,
        users: [...state.users, { id, name, role, initials, color }],
        loading: false
      }))
    } catch (err) {
      console.error('Registration failed:', err)
      set({ loading: false, dbError: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  initFromDb: async () => {
    const { currentUserId } = get()
    if (!currentUserId) return
    set({ loading: true, dbError: null })
    try {
      // Load users, guidelines, projects in parallel
      const [dbUsers, dbGuidelines, dbProjects] = await Promise.all([
        db.fetchAllUsers(),
        db.fetchGuidelines(),
        db.fetchUserProjects(currentUserId),
      ])
      // Fetch compliance scores for all projects from DB
      const projectIds = (dbProjects ?? []).map((p) => p.projectId)
      const complianceMap = await db.fetchProjectComplianceSummary(projectIds)

      const users: User[] = dbUsers.map((u) => ({
        id: u.userId,
        name: u.userName,
        role: u.role,
        initials: u.userName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
        color: ROLE_COLORS[u.role] ?? 'bg-slate-500',
      }))

      const guidelines = dbGuidelines.map(mapDbGuideline)
      const projects = (dbProjects ?? []).map(mapDbProject)

      // Ensure current user is in users list
      const currentUser = get().users.find((u) => u.id === currentUserId)
      if (currentUser && !users.some((u) => u.id === currentUserId)) {
        users.push(currentUser)
      }

      // Load global checklist items for all guidelines (for admin/guidelines view)
      const allGuidelineItems = await Promise.all(
        dbGuidelines.map(g => db.fetchGuidelineItems(g.guidelineId).catch(() => []))
      )
      const globalChecklistItems = allGuidelineItems.flat().map(mapDbItem)

      set({ users, guidelines, projects, complianceMap, checklistItems: globalChecklistItems, loading: false })
    } catch (err) {
      set({ loading: false, dbError: String(err) })
    }
  },

  createProject: async ({ name, platform, guidelineIds, auditorIds, dueDate, notes }) => {
    const { currentUserId } = get()
    const projectId = await db.createProject({
      title: name,
      platform,
      headAuditorId: currentUserId,
      notes,
      dueDate,
      status: 'draft',
    })
    // Add head auditor as member + selected auditors
    const allMembers = Array.from(new Set([currentUserId, ...auditorIds]))
    await Promise.all([
      db.syncProjectMembers(projectId, allMembers),
      db.syncProjectGuidelines(projectId, guidelineIds),
    ])
    // Refresh projects
    const dbProjects = await db.fetchUserProjects(currentUserId)
    set({ projects: (dbProjects ?? []).map(mapDbProject) })
    return projectId
  },

  updateProject: async (projectId, updates) => {
    const dbUpdates: Parameters<typeof db.updateProject>[1] = {}
    if (updates.name) dbUpdates.projectTitle = updates.name
    if (updates.platform) dbUpdates.smPlatform = updates.platform
    if (updates.status) dbUpdates.projectStatus = updates.status
    if (updates.notes !== undefined) dbUpdates.projectNotes = updates.notes
    if (updates.dueDate !== undefined) dbUpdates.dueDate = updates.dueDate ?? null
    await db.updateProject(projectId, dbUpdates)
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, ...updates, updatedAt: new Date().toISOString().split('T')[0] } : p
      ),
    }))
  },

  deleteProject: async (projectId) => {
    await db.deleteProject(projectId)
    set((state) => ({ projects: state.projects.filter((p) => p.id !== projectId) }))
  },

  syncProjectGuidelines: async (projectId, guidelineIds) => {
    await db.syncProjectGuidelines(projectId, guidelineIds)
    set((state) => ({
      projects: state.projects.map((p) => p.id === projectId ? { ...p, guidelineIds } : p),
    }))
  },

  syncProjectScope: async (projectId, features) => {
    await db.syncProjectScope(projectId, features)
    set((state) => ({
      projects: state.projects.map((p) => p.id === projectId ? { ...p, scope: features } : p),
    }))
  },

  addAuditorToProject: async (projectId, userId) => {
    await db.addProjectMember(projectId, userId)
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId && !p.auditorIds.includes(userId)
          ? { ...p, auditorIds: [...p.auditorIds, userId] } : p
      ),
    }))
  },

  removeAuditorFromProject: async (projectId, userId) => {
    await db.removeProjectMember(projectId, userId)
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, auditorIds: p.auditorIds.filter((id) => id !== userId && id !== p.headAuditorId) }
          : p
      ),
    }))
  },

  updateChecklistItem: async (itemId, updates) => {
    await db.updateChecklistItem(itemId, {
      itemDescription: updates.text,
      severity: updates.severity,
      category: updates.category,
    })
    set((state) => ({
      checklistItems: state.checklistItems.map((ci) =>
        ci.id === itemId ? { ...ci, ...updates } : ci
      ),
    }))
  },

  deleteChecklistItem: async (itemId) => {
    await db.deleteChecklistItem(itemId)
    set((state) => ({
      checklistItems: state.checklistItems.filter((ci) => ci.id !== itemId),
    }))
  },

  addChecklistItem: async (projectId, input) => {
    const itemId = await db.createChecklistItem(projectId, input)
    set((state) => ({
      checklistItems: [
        ...state.checklistItems,
        {
          id: itemId,
          guidelineId: input.guidelineId,
          category: input.category,
          text: input.text,
          severity: input.severity,
          reference: input.reference,
          itemName: input.itemName,
          itemCode: input.itemCode,
          helpText: input.helpText,
          verbatimClauseText: input.verbatimClauseText,
          answerOptions: input.answerOptions,
        }
      ]
    }))
  },

  toggleProjectChecklistCategory: async (projectId, input) => {
    await db.toggleProjectChecklistCategory(projectId, input)
  },

  submitForReview: async (projectId) => {
    await db.submitForReview(projectId)
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? { ...p, submissionStatus: 'pending_review' as SubmissionStatus, status: 'under_review' as AuditStatus }
          : p
      ),
    }))
  },

  reviewSubmission: async (projectId, approved, remarks) => {
    await db.reviewSubmission(projectId, approved, remarks)
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              submissionStatus: (approved ? 'approved' : 'rejected') as SubmissionStatus,
              status: (approved ? 'completed' : 'in_progress') as AuditStatus,
              submissionRemarks: remarks,
            }
          : p
      ),
    }))
  },

  deleteGuideline: async (guidelineId) => {
    await db.deleteGuideline(guidelineId)
    set((state) => ({
      guidelines: state.guidelines.filter((g) => g.id !== guidelineId),
      checklistItems: state.checklistItems.filter((ci) => ci.guidelineId !== guidelineId),
    }))
  },

  addSyntheticGuideline: async (guideline, items) => {
    const { currentUserId } = get()
    await db.createGuideline({
      guideline: {
        guidelineId: guideline.id,
        guidelineName: guideline.name,
        shortName: guideline.shortName,
        version: guideline.version,
        description: guideline.description,
        source: guideline.source,
        categories: guideline.categories,
        lastUpdated: guideline.lastUpdated,
        userId: currentUserId
      },
      items: items.map(item => ({
        id: item.id,
        category: item.category,
        text: item.text,
        severity: item.severity,
        reference: item.reference,
        helpText: item.helpText,
        verbatimClauseText: item.verbatimClauseText,
        itemName: item.itemName,
        itemCode: item.itemCode,
        answerOptions: item.answerOptions,
      }))
    })

    set((state) => ({
      guidelines: [guideline, ...state.guidelines],
      checklistItems: [...items, ...state.checklistItems],
    }))
  },

  saveFindings: async (projectId, itemId, findings) => {
    const { currentUserId } = get()
    await db.saveAuditFindings(projectId, itemId, currentUserId, findings)
    set((state) => {
      const key = rkey(projectId, itemId)
      const existing = state.responses[key]
      if (!existing) return state
      return { responses: { ...state.responses, [key]: { ...existing, findings } } }
    })
  },

  setResponse: async (projectId, itemId, guidelineId, status, notes = '', findings) => {
    const { currentUserId } = get()
    // Optimistic update
    set((state) => {
      const key = rkey(projectId, itemId)
      const existing = state.responses[key]
      return {
        responses: {
          ...state.responses,
          [key]: {
            id: existing?.id ?? `r_${Date.now()}`,
            projectId, checklistItemId: itemId,
            status, notes,
            findings: findings ?? existing?.findings,
            auditorId: currentUserId,
            updatedAt: new Date().toISOString().split('T')[0],
          },
        },
      }
    })
    // Persist to DB + auto-transition draft → in_progress + update complianceMap
    try {
      const scoreData = await db.upsertAuditResult(projectId, itemId, currentUserId, guidelineId, status, notes)

      // Update complianceMap so Dashboard avg reflects the latest score immediately
      if (scoreData) {
        set((state) => ({
          complianceMap: { ...state.complianceMap, [projectId]: scoreData.percentage },
        }))
      }

      // Auto-advance project from draft → in_progress the moment the first response is saved
      const { projects } = get()
      const proj = projects.find((p) => p.id === projectId)
      if (proj?.status === 'draft') {
        await db.updateProject(projectId, { projectStatus: 'in_progress' })
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, status: 'in_progress' as AuditStatus } : p
          ),
        }))
      }
    } catch {
      // Response already set optimistically — fail silently in UI
    }
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
    }),
    {
      name: 'safetyaudit-session',
      // Only persist auth — all other data is re-fetched from DB on login
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        currentUserId: state.currentUserId,
        users: state.users.filter((u) => u.id === state.currentUserId),
      }),
    }
  )
)

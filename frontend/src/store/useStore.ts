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
import { hashPassword } from '../lib/crypto'

type ResponseMap = Record<string, AuditResponse>

export interface ResolutionInfo {
  status: ChecklistItemStatus
  resolvedBy: string
  notes?: string
  resolvedAt: string
}


const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-blue-600',
  head_auditor: 'bg-violet-500',
  auditor: 'bg-emerald-500',
}

function rkey(projectId: string, itemId: string) {
  return `${projectId}__${itemId}`
}

const pendingWritesByKey = new Map<string, Promise<unknown>>()
function serializeByKey<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = pendingWritesByKey.get(key) ?? Promise.resolve()
  const next = prior.then(work, work)
  pendingWritesByKey.set(key, next.catch(() => {}))
  return next
}

const complianceRequestGen: Record<string, number> = {}
let initFromDbGen = 0

const guidelineItemsCache = new Map<string, ChecklistItem[]>()

export function reconcileResponse(rows: AuditResponse[], resolvedStatus?: ChecklistItemStatus): AuditResponse | undefined {
  if (rows.length === 0) return undefined
  const distinctStatuses = new Set(rows.map((r) => r.status))
  const status = resolvedStatus ?? (distinctStatuses.size === 1 ? rows[0].status : 'needs_review')
  const latest = rows.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b))
  return { ...latest, status }
}

function emptyScore(): ProjectScore {
  return { total: 0, compliant: 0, nonCompliant: 0, notApplicable: 0, answered: 0, applicable: 0, percentage: 0, progress: 0 }
}

export function calcScore(items: ChecklistItem[], responses: ResponseMap, projectId: string): ProjectScore {
  const total = items.length
  let compliant = 0, nonCompliant = 0, notApplicable = 0, answered = 0, weightedCompliant = 0
  for (const item of items) {
    const resp = responses[rkey(projectId, item.id)]
    if (!resp || resp.status === 'not_started' || resp.status === 'needs_review') continue
    answered++
    if (resp.status === 'compliant') { compliant++; weightedCompliant += 1 }
    else if (resp.status === 'partially') { nonCompliant++; weightedCompliant += 0.5 }
    else if (resp.status === 'non_compliant') nonCompliant++
    else if (resp.status === 'not_applicable') notApplicable++
  }
  const applicable = answered - notApplicable
  const percentage = applicable > 0 ? Math.round((weightedCompliant / applicable) * 1000) / 10 : 0
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0
  return { total, compliant, nonCompliant, notApplicable, answered, applicable, percentage, progress }
}

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
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  authToken: string | null
  users: User[]
  currentUserId: string
  guidelines: Guideline[]
  checklistItems: ChecklistItem[]
  projects: AuditProject[]
  responses: ResponseMap
  allResponses: Record<string, AuditResponse[]>
  resolutions: Record<string, ResolutionInfo>
  complianceMap: Record<string, number>
  projectItemCounts: Record<string, { answered: number; total: number }>
  loading: boolean
  dbError: string | null

  login: (userId: string, name: string, role: UserRole, token: string) => void
  logout: () => void
  /** Puts an answer the server applied into `responses`. Null findings keep what is stored. */
  applyServerAnswer: (
    projectId: string,
    itemId: string,
    answer: { status: ChecklistItemStatus; findings: string | null },
  ) => void
  /** After an answer is stored (by setResponse or a decision): refresh the compliance map and move a draft project to in_progress. */
  refreshAfterAnswer: (projectId: string) => Promise<void>
  register: (email: string, name: string, role: UserRole, password?: string) => Promise<void>
  initFromDb: () => Promise<void>

  createProject: (input: {
    name: string; platform: Platform; guidelineIds: string[]
    auditorIds: string[]; dueDate?: string; notes?: string
  }) => Promise<string>
  updateProject: (projectId: string, updates: Partial<Pick<AuditProject, 'name' | 'platform' | 'status' | 'notes' | 'dueDate' | 'scope'>>) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>

  syncProjectGuidelines: (projectId: string, guidelineIds: string[]) => Promise<void>

  syncProjectScope: (projectId: string, features: string[]) => Promise<void>

  addAuditorToProject: (projectId: string, userId: string) => Promise<void>
  removeAuditorFromProject: (projectId: string, userId: string) => Promise<void>

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

  submitForReview: (projectId: string) => Promise<void>
  reviewSubmission: (projectId: string, approved: boolean, remarks: string) => Promise<void>

  deleteGuideline: (guidelineId: string) => Promise<void>
  addSyntheticGuideline: (guideline: Guideline, items: ChecklistItem[]) => Promise<void>
  addGuidelineFromRealtime: (dbGuideline: db.DbGuideline, dbItems: db.DbChecklistItem[]) => void


  setResponse: (projectId: string, itemId: string, guidelineId: string, status: ChecklistItemStatus, notes?: string, findings?: string) => Promise<void>
  saveFindings: (projectId: string, itemId: string, findings: string) => Promise<void>
  resolveDisagreement: (projectId: string, itemId: string, status: ChecklistItemStatus, notes?: string) => Promise<void>

  getProjectScore: (projectId: string) => ProjectScore
  getCategoryScore: (projectId: string, category: string) => ProjectScore
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
  isAuthenticated: false,
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  authToken: null,
  users: [],
  currentUserId: '',
  guidelines: [],
  checklistItems: [],
  projects: [],
  responses: {},
  allResponses: {},
  resolutions: {},
  complianceMap: {},
  projectItemCounts: {},
  loading: false,
  dbError: null,

  login: (userId, name, role, token) => {
    const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const color = ROLE_COLORS[role] ?? 'bg-slate-500'
    const loggedInUser: User = { id: userId, name, role, initials, color }
    set((state) => ({
      isAuthenticated: true,
      authToken: token,
      currentUserId: userId,
      users: state.users.some((u) => u.id === userId)
        ? state.users.map((u) => (u.id === userId ? loggedInUser : u))
        : [...state.users, loggedInUser],
    }))
  },

  logout: () => set({ isAuthenticated: false, authToken: null, currentUserId: '', projects: [], responses: {}, allResponses: {}, resolutions: {}, checklistItems: [], complianceMap: {}, projectItemCounts: {}, dbError: null }),

  applyServerAnswer: (projectId, itemId, answer) =>
    set((state) => {
      const key = rkey(projectId, itemId)
      const { currentUserId } = state
      const existingRows = state.allResponses[key] ?? []
      const mine = existingRows.find((r) => r.auditorId === currentUserId)
      const shown = state.responses[key]
      // The server puts the result on every auditor's row of the item; the findings it returns are the deciding auditor's.
      const base: AuditResponse | undefined = mine ?? (existingRows.length === 0 ? shown : undefined)
      const myRow: AuditResponse = base
        ? { ...base, status: answer.status, findings: answer.findings ?? base.findings }
        : {
            id: `r_${Date.now()}`,
            projectId,
            checklistItemId: itemId,
            status: answer.status,
            findings: answer.findings ?? undefined,
            auditorId: currentUserId,
            updatedAt: new Date().toISOString().split('T')[0],
          }
      const others = existingRows
        .filter((r) => r.auditorId !== currentUserId)
        .map((r) => ({ ...r, status: answer.status }))
      // Mine first, so that it is the row shown when the dates tie.
      const rows = [myRow, ...others]
      const reconciled = reconcileResponse(rows, state.resolutions[key]?.status) ?? myRow
      return {
        allResponses: { ...state.allResponses, [key]: rows },
        responses: { ...state.responses, [key]: reconciled },
      }
    }),

  register: async (email, name, role, password) => {
    const id = window.crypto.randomUUID()
    const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const color = ROLE_COLORS[role] ?? 'bg-slate-500'

    set({ loading: true, dbError: null })
    try {
      const hashedPassword = password ? await hashPassword(password) : undefined
      const { token } = await db.createUser({
        userId: id,
        userName: name,
        userEmail: email,
        role: role,
        userPassword: hashedPassword
      })
      set((state) => ({
        isAuthenticated: true,
        authToken: token,
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
    // Only the most recent call (for the same signed-in user) may commit, so an
    // older, slower response can't overwrite fresher data or repopulate after logout.
    const myGen = ++initFromDbGen
    const isStale = () => myGen !== initFromDbGen || get().currentUserId !== currentUserId
    set({ loading: true, dbError: null })
    try {
      const [dbUsers, dbGuidelines, dbProjects] = await Promise.all([
        db.fetchAllUsers(),
        db.fetchGuidelines(),
        db.fetchUserProjects(currentUserId),
      ])
      const projectIds = (dbProjects ?? []).map((p) => p.projectId)
      const complianceSummary = await db.fetchProjectComplianceSummary(projectIds)
      const complianceMap: Record<string, number> = {}
      const projectItemCounts: Record<string, { answered: number; total: number }> = {}
      for (const [pid, s] of Object.entries(complianceSummary)) {
        complianceMap[pid] = s.percentage
        projectItemCounts[pid] = { answered: s.answered, total: s.total }
      }

      const users: User[] = dbUsers.map((u) => ({
        id: u.userId,
        name: u.userName,
        role: u.role,
        initials: u.userName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
        color: ROLE_COLORS[u.role] ?? 'bg-slate-500',
      }))

      const guidelines = dbGuidelines.map(mapDbGuideline)
      const projects = (dbProjects ?? []).map(mapDbProject)

      const currentUser = get().users.find((u) => u.id === currentUserId)
      if (currentUser && !users.some((u) => u.id === currentUserId)) {
        users.push(currentUser)
      }

      const guidelinesNeedingFetch = dbGuidelines.filter((g) => !guidelineItemsCache.has(g.guidelineId))
      await Promise.all(
        guidelinesNeedingFetch.map(async (g) => {
          const items = await db.fetchGuidelineItems(g.guidelineId).catch(() => [])
          guidelineItemsCache.set(g.guidelineId, items.map(mapDbItem))
        })
      )
      const globalChecklistItems = dbGuidelines.flatMap((g) => guidelineItemsCache.get(g.guidelineId) ?? [])

      if (isStale()) { if (myGen === initFromDbGen) set({ loading: false }); return }
      set((state) => {
        const projectSpecificGuidelines = state.guidelines.filter((g) => g.projectId)
        const projectSpecificItems = state.checklistItems.filter(
          (ci) => !globalChecklistItems.some((gi) => gi.id === ci.id)
        )
        return {
          users, projects, complianceMap, projectItemCounts,
          guidelines: [...projectSpecificGuidelines, ...guidelines],
          checklistItems: [...projectSpecificItems, ...globalChecklistItems],
          loading: false,
        }
      })
    } catch (err) {
      if (isStale()) { if (myGen === initFromDbGen) set({ loading: false }); return }
      set({ loading: false, dbError: err instanceof Error ? err.message : String(err) })
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
      status: 'in_progress',
    })
    const allMembers = Array.from(new Set([currentUserId, ...auditorIds]))
    await Promise.all([
      db.syncProjectMembers(projectId, allMembers),
      db.syncProjectGuidelines(projectId, guidelineIds),
    ])
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
    guidelineItemsCache.delete(guidelineId)
    set((state) => ({
      guidelines: state.guidelines.filter((g) => g.id !== guidelineId),
      checklistItems: state.checklistItems.filter((ci) => ci.guidelineId !== guidelineId),
    }))
  },

  addGuidelineFromRealtime: (dbGuideline, dbItems) => {
    const mapped = mapDbGuideline({ ...dbGuideline, itemCount: dbItems.length })
    const mappedItems = dbItems.map(mapDbItem)
    guidelineItemsCache.set(mapped.id, mappedItems)
    set((state) => {
      if (state.guidelines.some((g) => g.id === mapped.id)) return state
      return {
        guidelines: [mapped, ...state.guidelines],
        checklistItems: [...mappedItems, ...state.checklistItems],
      }
    })
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

    guidelineItemsCache.set(guideline.id, items)
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

  resolveDisagreement: async (projectId, itemId, status, notes = '') => {
    const { currentUserId } = get()
    await db.resolveDisagreement(projectId, itemId, status, notes)
    set((state) => {
      const key = rkey(projectId, itemId)
      const resolution: ResolutionInfo = {
        status, resolvedBy: currentUserId, notes,
        resolvedAt: new Date().toISOString().split('T')[0],
      }
      const rows = state.allResponses[key] ?? []
      const reconciled = reconcileResponse(rows, status)
      return {
        resolutions: { ...state.resolutions, [key]: resolution },
        responses: reconciled ? { ...state.responses, [key]: reconciled } : state.responses,
      }
    })
    const updated = await db.fetchProjectComplianceSummary([projectId])
    if (updated[projectId] !== undefined) {
      set((state) => ({
        complianceMap: { ...state.complianceMap, [projectId]: updated[projectId].percentage },
        projectItemCounts: {
          ...state.projectItemCounts,
          [projectId]: { answered: updated[projectId].answered, total: updated[projectId].total },
        },
      }))
    }
  },

  setResponse: async (projectId, itemId, guidelineId, status, notes = '', findings) => {
    const { currentUserId } = get()
    const key = rkey(projectId, itemId)
    const previousRows = get().allResponses[key]
    const previousResponse = get().responses[key]
    set((state) => {
      const existingRows = state.allResponses[key] ?? []
      const myExisting = existingRows.find((r) => r.auditorId === currentUserId)
      const myRow: AuditResponse = {
        id: myExisting?.id ?? `r_${Date.now()}`,
        projectId, checklistItemId: itemId,
        status, notes,
        findings: findings ?? myExisting?.findings,
        auditorId: currentUserId,
        updatedAt: new Date().toISOString().split('T')[0],
      }
      const updatedRows = [...existingRows.filter((r) => r.auditorId !== currentUserId), myRow]
      const reconciled = reconcileResponse(updatedRows, state.resolutions[key]?.status)
      return {
        allResponses: { ...state.allResponses, [key]: updatedRows },
        responses: reconciled ? { ...state.responses, [key]: reconciled } : state.responses,
      }
    })
    try {
      await serializeByKey(key, () => db.upsertAuditResult(projectId, itemId, currentUserId, guidelineId, status, notes))
    } catch (err) {
      set((state) => {
        const allResponses = { ...state.allResponses }
        const responses = { ...state.responses }
        if (previousRows) allResponses[key] = previousRows
        else delete allResponses[key]
        if (previousResponse) responses[key] = previousResponse
        else delete responses[key]
        return { allResponses, responses }
      })
      throw err
    }

    try {
      await get().refreshAfterAnswer(projectId)
    } catch (err) {
      console.error('[setResponse] Answer saved, but refreshing the project summary failed:', err)
    }
  },

  refreshAfterAnswer: async (projectId) => {
    // Refresh the compliance summary; a newer request for the same project wins over an older one.
    const myGen = (complianceRequestGen[projectId] ?? 0) + 1
    complianceRequestGen[projectId] = myGen
    const updated = await db.fetchProjectComplianceSummary([projectId])
    if (updated[projectId] !== undefined && complianceRequestGen[projectId] === myGen) {
      set((state) => ({
        complianceMap: { ...state.complianceMap, [projectId]: updated[projectId].percentage },
        projectItemCounts: {
          ...state.projectItemCounts,
          [projectId]: { answered: updated[projectId].answered, total: updated[projectId].total },
        },
      }))
    }

    // Auto-advance project from draft → in_progress the moment the first response is saved
    const { projects } = get()
    const proj = projects.find((p) => p.id === projectId)
    if (proj?.status === 'draft') {
      await db.activateProject(projectId)
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId ? { ...p, status: 'in_progress' as AuditStatus } : p
        ),
      }))
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
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        sidebarCollapsed: state.sidebarCollapsed,
        authToken: state.authToken,
        currentUserId: state.currentUserId,
        users: state.users.filter((u) => u.id === state.currentUserId),
      }),
    }
  )
)

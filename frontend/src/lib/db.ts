import type { AuditStatus, ChecklistItemStatus, Platform, Severity, SubmissionStatus, UserRole } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// ─── DB row types ─────────────────────────────────────────────────────────────

export interface DbProject {
  projectId: string
  projectTitle: string
  smPlatform: Platform
  projectStatus: AuditStatus
  submissionStatus: SubmissionStatus
  submissionRemarks: string | null
  headAuditorId: string
  projectNotes: string | null
  dueDate: string | null
  timeCreated: string
  updatedAt: string
  memberIds?: string[]
  guidelineIds?: string[]
}

export interface DbGuideline {
  guidelineId: string
  guidelineName: string
  shortName: string | null
  version: string | null
  description: string | null
  source: string | null
  lastUpdated: string | null
  categories: string[] | null
  itemCount: number
  isDeleted: boolean
}

export interface DbChecklistItem {
  itemId: string
  guidelineId: string
  category: string
  itemDescription: string
  severity: Severity
  reference: string | null
  itemName: string | null
  itemCode: string | null
  rowType: string | null
  helpText: string | null
  verbatimClauseText: string | null
  answerOptions: string | null
}

export interface DbAuditResult {
  resultId: string
  projectId: string
  itemId: string
  userId: string
  guidelineId: string
  result: ChecklistItemStatus
  notes: string | null
  findings: string | null
  evidenceImages: { url: string; name: string }[] | null
  timeSubmitted: string
}

export interface DbComplianceScore {
  scoreId: string
  guidelineId: string
  guidelineName: string
  shortName: string
  totalItems: number
  answeredItems: number
  compliantItems: number
  nonCompliantItems: number
  notApplicableItems: number
  scorePercentage: number
  timeCalculated: string
}

export interface DbAuditReport {
  projectId: string
  projectTitle: string
  smPlatform: string
  projectStatus: AuditStatus
  submissionStatus: SubmissionStatus
  submissionRemarks: string | null
  headAuditorId: string
  headAuditorName: string
  timeCreated: string
  updatedAt: string
  dueDate: string | null
  scorePercentage: number | null
  guidelineIds: string[]
}

export interface DbUser {
  userId: string
  userName: string
  userEmail: string
  role: UserRole
}

// Helper for HTTP requests
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(errText || res.statusText)
  }
  return res.json()
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function fetchUserProjects(userId: string): Promise<DbProject[]> {
  return request<DbProject[]>(`/projects?userId=${encodeURIComponent(userId)}`)
}

export async function fetchProjectDetails(projectId: string) {
  return request<{
    project: DbProject
    members: { userId: string; userName: string; role: string }[] | null
    guidelines: { guidelineId: string; guidelineName: string; shortName: string; version: string }[] | null
    scope: string[] | null
  }>(`/projects/${projectId}`)
}

export async function createProject(input: {
  title: string
  platform: Platform
  headAuditorId: string
  notes?: string
  dueDate?: string
  status?: AuditStatus
}): Promise<string> {
  const res = await request<{ projectId: string }>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.projectId
}

export async function updateProject(projectId: string, updates: {
  projectTitle?: string
  smPlatform?: Platform
  projectStatus?: AuditStatus
  projectNotes?: string
  dueDate?: string | null
}): Promise<void> {
  await request(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

// Returns average scorePercentage per projectId across all its guidelines
export async function fetchProjectComplianceSummary(
  projectIds: string[]
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}
  return request<Record<string, number>>(`/projects/compliance-summary?ids=${projectIds.join(',')}`)
}

export async function deleteProject(projectId: string): Promise<void> {
  await request(`/projects/${projectId}`, {
    method: 'DELETE',
  })
}

// ─── Project Members ─────────────────────────────────────────────────

export async function addProjectMember(projectId: string, userId: string): Promise<void> {
  await request(`/projects/${projectId}/members/add`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  await request(`/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
  })
}

export async function syncProjectMembers(projectId: string, userIds: string[]): Promise<void> {
  await request(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  })
}

// ─── Project Guidelines ────────────────────────────────────────────────

export async function syncProjectGuidelines(projectId: string, guidelineIds: string[]): Promise<void> {
  await request(`/projects/${projectId}/guidelines`, {
    method: 'POST',
    body: JSON.stringify({ guidelineIds }),
  })
}

// ─── Project Scope / Features ─────────────────────────────────────────

export async function syncProjectScope(projectId: string, features: string[]): Promise<void> {
  await request(`/projects/${projectId}/scope`, {
    method: 'POST',
    body: JSON.stringify({ features }),
  })
}

// ─── Guidelines ───────────────────────────────────────────────────────────────

export async function fetchGuidelines(): Promise<DbGuideline[]> {
  return request<DbGuideline[]>('/guidelines')
}

export async function createGuideline(input: {
  guideline: {
    guidelineId: string
    guidelineName: string
    shortName: string
    version: string
    description: string
    source: string
    categories: string[]
    lastUpdated: string
    userId: string
  }
  items: {
    id: string
    category: string
    text: string
    severity: Severity
    reference?: string
    feature?: string
  }[]
}): Promise<void> {
  await request('/guidelines', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteGuideline(guidelineId: string): Promise<void> {
  await request(`/guidelines/${guidelineId}`, {
    method: 'DELETE',
  })
}

export async function fetchGuidelineItems(guidelineId: string): Promise<DbChecklistItem[]> {
  return request<DbChecklistItem[]>(`/guidelines/${guidelineId}/items`)
}

// ─── Checklist Items ──────────────────────────────────────────────────────────

export async function fetchProjectChecklistItems(projectId: string): Promise<DbChecklistItem[]> {
  return request<DbChecklistItem[]>(`/projects/${projectId}/checklist`)
}

export async function updateChecklistItem(itemId: string, updates: {
  itemDescription?: string
  severity?: Severity
  category?: string
}): Promise<void> {
  await request(`/checklist/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  await request(`/checklist/items/${itemId}`, {
    method: 'DELETE',
  })
}

export async function createChecklistItem(projectId: string, input: {
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
}): Promise<string> {
  const res = await request<{ itemId: string }>(`/projects/${projectId}/checklist/items`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.itemId
}

export async function saveAuditFindings(projectId: string, itemId: string, userId: string, findings: string): Promise<void> {
  await request(`/projects/${projectId}/results/${itemId}/findings`, {
    method: 'PATCH',
    body: JSON.stringify({ userId, findings }),
  })
}

export async function saveEvidenceImages(projectId: string, itemId: string, userId: string, images: { url: string; name: string }[]): Promise<void> {
  await request(`/projects/${projectId}/results/${itemId}/evidence`, {
    method: 'PATCH',
    body: JSON.stringify({ userId, images }),
  })
}

export async function toggleProjectChecklistCategory(projectId: string, input: {
  category: string
  enabled: boolean
  guidelineId: string
}): Promise<void> {
  await request(`/projects/${projectId}/checklist/categories/toggle`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

// ─── Audit Results ───────────────────────────────────────────────────

export async function fetchAuditResults(projectId: string): Promise<DbAuditResult[]> {
  return request<DbAuditResult[]>(`/projects/${projectId}/results`)
}

export async function upsertAuditResult(
  projectId: string,
  itemId: string,
  userId: string,
  guidelineId: string,
  result: ChecklistItemStatus,
  notes: string = ''
): Promise<{ answered: number; compliant: number; nonCompliant: number; notApplicable: number; percentage: number; total: number }> {
  return request<{ answered: number; compliant: number; nonCompliant: number; notApplicable: number; percentage: number; total: number }>(
    `/projects/${projectId}/results`,
    {
      method: 'POST',
      body: JSON.stringify({ itemId, userId, guidelineId, result, notes }),
    }
  )
}

// ─── Submission Workflow ──────────────────────────────────────

export async function submitForReview(projectId: string): Promise<void> {
  await request(`/projects/${projectId}/submit`, {
    method: 'POST',
  })
}

export async function reviewSubmission(projectId: string, approved: boolean, remarks: string): Promise<void> {
  await request(`/projects/${projectId}/review`, {
    method: 'POST',
    body: JSON.stringify({ approved, remarks }),
  })
}

// ─── Compliance Scores ──────────────────────────────────────

export async function fetchComplianceScores(projectId: string): Promise<DbComplianceScore[]> {
  return request<DbComplianceScore[]>(`/projects/${projectId}/compliance-scores`)
}

// ─── Audit Reports ────────────────────────────────────────────

export async function fetchAuditReports(
  userId: string,
  filters?: {
    projectStatusFilter?: AuditStatus
    search?: string
    dateFrom?: string
    dateTo?: string
  }
): Promise<DbAuditReport[]> {
  let query = `userId=${encodeURIComponent(userId)}`
  if (filters?.projectStatusFilter) query += `&projectStatusFilter=${filters.projectStatusFilter}`
  if (filters?.search) query += `&search=${encodeURIComponent(filters.search)}`
  if (filters?.dateFrom) query += `&dateFrom=${filters.dateFrom}`
  if (filters?.dateTo) query += `&dateTo=${filters.dateTo}`
  return request<DbAuditReport[]>(`/reports?${query}`)
}

export async function createAuditReport(projectId: string, userId: string): Promise<string> {
  const res = await request<{ reportId: string }>('/reports', {
    method: 'POST',
    body: JSON.stringify({ projectId, userId }),
  })
  return res.reportId
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function fetchAllUsers(): Promise<DbUser[]> {
  return request<DbUser[]>('/users')
}

export async function createUser(user: {
  userId: string
  userName: string
  userEmail: string
  role: UserRole
  userPassword?: string
}): Promise<void> {
  await request('/users', {
    method: 'POST',
    body: JSON.stringify(user),
  })
}

// ─── Groq Llama Integration ──────────────────────────────────────────

export async function processTextChunk(textChunk: string, platform: string): Promise<any[]> {
  return request<any[]>('/generator/process-chunk', {
    method: 'POST',
    body: JSON.stringify({ textChunk, platform }),
  })
}

export async function mergeChecklistItems(items: any[], platform: string): Promise<{
  name: string
  shortName: string
  categories: string[]
  items: any[]
}> {
  return request<any>('/generator/merge-items', {
    method: 'POST',
    body: JSON.stringify({ items, platform }),
  })
}

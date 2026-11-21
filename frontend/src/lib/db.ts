import type { AuditStatus, ChecklistItemStatus, Platform, Severity, SubmissionStatus, UserRole } from '../types'
import { useStore } from '../store/useStore'

export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

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
  timeSubmitted: string
}

export interface ItemEvidence {
  itemId: string
  userId: string
  images: { url: string; name: string }[]
}

export async function fetchEvidenceForItems(projectId: string, itemIds: string[]): Promise<ItemEvidence[]> {
  if (itemIds.length === 0) return []
  return request<ItemEvidence[]>(`/projects/${projectId}/evidence?itemIds=${itemIds.map(encodeURIComponent).join(',')}`)
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
  weightedCompliant: number
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useStore.getState().authToken
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const errText = await res.text()
    if (res.status === 401 && useStore.getState().isAuthenticated && path !== '/auth/login') {
      useStore.getState().logout()
    }
    let message = errText || res.statusText
    try {
      const parsed = JSON.parse(errText)
      if (parsed?.error) message = parsed.error
    } catch {
    }
    throw new Error(message)
  }
  return res.json()
}

export async function login(email: string, hashedPassword: string): Promise<{
  token: string
  user: { userId: string; userName: string; role: UserRole }
}> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: hashedPassword }),
  })
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function fetchUserProjects(_userId: string): Promise<DbProject[]> {
  return request<DbProject[]>('/projects')
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

export async function activateProject(projectId: string): Promise<void> {
  await request(`/projects/${projectId}/activate`, { method: 'POST' })
}

export interface ProjectComplianceSummary {
  percentage: number
  answered: number
  total: number
}

export async function fetchProjectComplianceSummary(
  projectIds: string[]
): Promise<Record<string, ProjectComplianceSummary>> {
  if (projectIds.length === 0) return {}
  return request<Record<string, ProjectComplianceSummary>>(`/projects/compliance-summary?ids=${projectIds.join(',')}`)
}

export interface ProjectReliability {
  kappa: number | null
  sharedItems: number
  raterPair: [string, string] | null
}

export async function fetchProjectReliability(projectId: string): Promise<ProjectReliability> {
  return request<ProjectReliability>(`/projects/${projectId}/reliability`)
}

export interface DbResolution {
  itemId: string
  resolvedBy: string
  resolvedStatus: ChecklistItemStatus
  notes: string | null
  resolvedAt: string
}

export async function fetchResolutions(projectId: string): Promise<DbResolution[]> {
  return request<DbResolution[]>(`/projects/${projectId}/resolutions`)
}

export async function resolveDisagreement(
  projectId: string,
  itemId: string,
  status: ChecklistItemStatus,
  notes: string = ''
): Promise<void> {
  await request(`/projects/${projectId}/results/${itemId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status, notes }),
  })
}

export async function deleteProject(projectId: string): Promise<void> {
  await request(`/projects/${projectId}`, {
    method: 'DELETE',
  })
}

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

export async function syncProjectGuidelines(projectId: string, guidelineIds: string[]): Promise<void> {
  await request(`/projects/${projectId}/guidelines`, {
    method: 'POST',
    body: JSON.stringify({ guidelineIds }),
  })
}

export async function syncProjectScope(projectId: string, features: string[]): Promise<void> {
  await request(`/projects/${projectId}/scope`, {
    method: 'POST',
    body: JSON.stringify({ features }),
  })
}

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
): Promise<AcceptedAnswer[]> {
  const res = await request<{ filledIn?: AcceptedAnswer[] }>(`/projects/${projectId}/results`, {
    method: 'POST',
    body: JSON.stringify({ itemId, userId, guidelineId, result, notes }),
  })
  // Items an admin approved as the same requirement are filled in with this answer by the server.
  return res?.filledIn ?? []
}

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

export async function fetchComplianceScores(projectId: string): Promise<DbComplianceScore[]> {
  return request<DbComplianceScore[]>(`/projects/${projectId}/compliance-scores`)
}

export async function fetchAuditReports(
  _userId: string,
  filters?: {
    projectStatusFilter?: AuditStatus
    search?: string
    dateFrom?: string
    dateTo?: string
  }
): Promise<DbAuditReport[]> {
  let query = ''
  if (filters?.projectStatusFilter) query += `&projectStatusFilter=${filters.projectStatusFilter}`
  if (filters?.search) query += `&search=${encodeURIComponent(filters.search)}`
  if (filters?.dateFrom) query += `&dateFrom=${encodeURIComponent(filters.dateFrom)}`
  if (filters?.dateTo) query += `&dateTo=${encodeURIComponent(filters.dateTo)}`
  return request<DbAuditReport[]>(`/reports?${query.replace(/^&/, '')}`)
}

export async function createAuditReport(projectId: string): Promise<string> {
  const res = await request<{ reportId: string }>('/reports', {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  })
  return res.reportId
}

export async function fetchAllUsers(): Promise<DbUser[]> {
  return request<DbUser[]>('/users')
}

export async function createUser(user: {
  userId: string
  userName: string
  userEmail: string
  role: UserRole
  userPassword?: string
}): Promise<{ success: boolean; token: string }> {
  return request('/users', {
    method: 'POST',
    body: JSON.stringify(user),
  })
}

export async function processTextChunk(textChunk: string, platform: string): Promise<{
  items: any[]
  _aiUsed: boolean
  _fallbackReason?: string
}> {
  return request<any>('/generator/process-chunk', {
    method: 'POST',
    body: JSON.stringify({ textChunk, platform }),
  })
}

export async function mergeChecklistItems(items: any[], platform: string): Promise<{
  name: string
  shortName: string
  categories: string[]
  items: any[]
  _aiUsed: boolean
  _fallbackReason?: string
}> {
  return request<any>('/generator/merge-items', {
    method: 'POST',
    body: JSON.stringify({ items, platform }),
  })
}

export type MappingRelation = 'equivalent' | 'partial'
export type MappingStatus = 'suggested' | 'confirmed' | 'rejected'

export interface MappedItem {
  itemId: string
  guidelineId: string
  guidelineName: string
  category: string
  itemCode: string | null
  text: string
  reference: string | null
  clause: string | null
}

export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** How many projects use each item of a pair, and how many use both. */
export interface MappingUsage {
  projectsA: number
  projectsB: number
  together: number
}

/** A pair of similar checklist items from two guidelines, with the AI's confidence and the admin's decision. */
export interface ItemMapping {
  mappingId: string
  relation: MappingRelation
  /** The AI's own confidence. */
  confidence: number | null
  /** The confidence after learning from the admin's past decisions (the same as `confidence` while there are none). */
  learnedConfidence: number | null
  /** How many past decisions the learned score rests on. */
  learnedFrom: number
  /** The score the list is ranked and grouped by. */
  score: number | null
  level: ConfidenceLevel
  rationale: string | null
  status: MappingStatus
  createdAt: string
  reviewedAt: string | null
  usage: MappingUsage
  /** What approving the pair as the same requirement does to groups. Null when it touches no group. */
  groupImpact: GroupImpact | null
  itemA: MappedItem
  itemB: MappedItem
}

export interface GroupImpact {
  /** Items that become the same requirement as the two of this pair, through a group one of them is in. */
  joins: MappedItem[]
  /** Two items of one guideline would end up in the group. */
  sameGuideline: boolean
  /** Both items are already in one group. */
  alreadyTogether: boolean
}

/** Items an admin approved as the same requirement, which are all one requirement. */
export interface MappingGroup {
  groupId: string
  items: MappedItem[]
  directPairs: number
  sameGuideline: boolean
}

export interface MappingFilters {
  status: MappingStatus
  guidelineId?: string
  relation?: MappingRelation
  /** Only pairs whose two items are both used by a project. */
  inUse?: boolean
}

export interface MappingPage {
  items: ItemMapping[]
  /** Pairs matching the filters, across all pages. */
  total: number
  counts: Record<MappingStatus, number>
  /** Pairs per status with no filter at all. */
  totals: Record<MappingStatus, number>
  levels: Record<ConfidenceLevel, number>
  linkedGuidelineIds: string[]
}

export interface LearningBand {
  relation: MappingRelation
  fromPercent: number
  toPercent: number
  decided: number
  approved: number
  approvalRate: number
}

export interface MappingLearning {
  decided: number
  approved: number
  rejected: number
  minDecisionsToShow: number
  bands: LearningBand[]
}

export type BulkReviewRequest = {
  status: MappingStatus
  relation?: MappingRelation
} & (
  | { ids: string[] }
  | { filter: MappingFilters & { level: ConfidenceLevel }; expectedCount: number }
)

/** An admin-approved pair whose two items are both in one project. */
export interface SimilarPair {
  mappingId: string
  relation: MappingRelation
  confidence: number | null
  rationale: string | null
  projectItemIdA: string
  projectItemIdB: string
  itemA: MappedItem
  itemB: MappedItem
}

export interface AnswerSuggestion {
  itemId: string
  guidelineId: string
  suggestedStatus: ChecklistItemStatus
  relation: MappingRelation
  sourceProjectId: string
  sourceProjectTitle: string
  sourceGuideline: string
  sourceItemId: string
  sourceItemCode: string | null
  sourceItemText: string | null
  findings: string | null
  evidenceCount: number
  answeredAt: string
  otherSources: number
}

export async function generateMappings(guidelineId: string): Promise<{ checked: number; suggested: number; failedBatches: number }> {
  return request(`/guidelines/${guidelineId}/mappings/generate`, { method: 'POST' })
}

export async function fetchMappingsPage(filters: MappingFilters, offset: number, limit: number): Promise<MappingPage> {
  const query = new URLSearchParams({ status: filters.status, offset: String(offset), limit: String(limit) })
  if (filters.guidelineId) query.set('guidelineId', filters.guidelineId)
  if (filters.relation) query.set('relation', filters.relation)
  if (filters.inUse) query.set('inUse', 'true')
  return request<MappingPage>(`/mappings?${query.toString()}`)
}

export async function fetchMappingGroups(): Promise<MappingGroup[]> {
  return request<MappingGroup[]>('/mappings/groups')
}

export async function fetchMappingLearning(): Promise<MappingLearning> {
  return request<MappingLearning>('/mappings/learning')
}

/** Decides several pairs at once. Returns how many were changed. */
export async function bulkReviewMappings(body: BulkReviewRequest): Promise<{ updated: number }> {
  return request<{ updated: number }>('/mappings/bulk', { method: 'POST', body: JSON.stringify(body) })
}

export async function reviewMapping(mappingId: string, status: MappingStatus, relation?: MappingRelation): Promise<void> {
  await request(`/mappings/${mappingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, relation }),
  })
}

export async function fetchSimilarItems(projectId: string): Promise<SimilarPair[]> {
  return request<SimilarPair[]>(`/projects/${projectId}/similar-items`)
}

export async function fetchAnswerSuggestions(projectId: string): Promise<AnswerSuggestion[]> {
  return request<AnswerSuggestion[]>(`/projects/${projectId}/suggestions`)
}

export interface AcceptedAnswer {
  itemId: string
  result: ChecklistItemStatus
  notes: string | null
  findings: string | null
  timeSubmitted: string
}

export async function acceptAnswerSuggestions(projectId: string, itemIds: string[]): Promise<AcceptedAnswer[]> {
  const res = await request<{ accepted: AcceptedAnswer[] }>(`/projects/${projectId}/suggestions/accept`, {
    method: 'POST',
    body: JSON.stringify({ itemIds }),
  })
  return res.accepted
}

/** Fills in same-requirement items whose linked item was already answered in this project. */
export async function fillInSameRequirementItems(projectId: string): Promise<AcceptedAnswer[]> {
  const res = await request<{ filledIn: AcceptedAnswer[] }>(`/projects/${projectId}/suggestions/fill-in`, { method: 'POST' })
  return res.filledIn
}

export async function dismissAnswerSuggestion(projectId: string, itemId: string, sourceItemId: string): Promise<void> {
  await request(`/projects/${projectId}/suggestions/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ itemId, sourceItemId }),
  })
}

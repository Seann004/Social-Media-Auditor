import { supabase } from './supabase'
import type { AuditStatus, ChecklistItemStatus, Platform, Severity, SubmissionStatus, UserRole } from '../types'

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
}

export interface DbChecklistItem {
  itemId: string
  guidelineId: string
  category: string
  itemDescription: string
  severity: Severity
  reference: string | null
  feature: string | null
}

export interface DbAuditResult {
  resultId: string
  projectId: string
  itemId: string
  userId: string
  guidelineId: string
  result: ChecklistItemStatus
  notes: string | null
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

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function fetchUserProjects(userId: string): Promise<DbProject[]> {
  const { data, error } = await supabase.rpc('get_user_projects', { p_user_id: userId })
  if (error) throw error
  return (data as DbProject[]) ?? []
}

export async function fetchProjectDetails(projectId: string) {
  const { data, error } = await supabase.rpc('get_project_details', { p_project_id: projectId })
  if (error) throw error
  return data as {
    project: DbProject
    members: { userId: string; userName: string; role: string }[] | null
    guidelines: { guidelineId: string; guidelineName: string; shortName: string; version: string }[] | null
    scope: string[] | null
  }
}

export async function createProject(input: {
  title: string
  platform: Platform
  headAuditorId: string
  notes?: string
  dueDate?: string
  status?: AuditStatus
}): Promise<string> {
  const { data, error } = await supabase
    .from('Audit_Project')
    .insert({
      projectTitle: input.title,
      smPlatform: input.platform,
      headAuditorId: input.headAuditorId,
      projectNotes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      projectStatus: input.status ?? 'draft',
      submissionStatus: 'not_submitted',
      updatedAt: new Date().toISOString(),
    })
    .select('projectId')
    .single()
  if (error) throw error
  return (data as { projectId: string }).projectId
}

export async function updateProject(projectId: string, updates: {
  projectTitle?: string
  smPlatform?: Platform
  projectStatus?: AuditStatus
  projectNotes?: string
  dueDate?: string | null
}): Promise<void> {
  const { error } = await supabase
    .from('Audit_Project')
    .update({ ...updates, updatedAt: new Date().toISOString() })
    .eq('projectId', projectId)
  if (error) throw error
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('Audit_Project').delete().eq('projectId', projectId)
  if (error) throw error
}

// ─── Project Members (UC-6.1) ─────────────────────────────────────────────────

export async function addProjectMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('Project_Member').insert({ projectId, userId })
  if (error && !error.message.includes('duplicate')) throw error
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('Project_Member')
    .delete()
    .eq('projectId', projectId)
    .eq('userId', userId)
  if (error) throw error
}

export async function syncProjectMembers(projectId: string, userIds: string[]): Promise<void> {
  await supabase.from('Project_Member').delete().eq('projectId', projectId)
  if (userIds.length === 0) return
  const rows = userIds.map((userId) => ({ projectId, userId }))
  const { error } = await supabase.from('Project_Member').insert(rows)
  if (error) throw error
}

// ─── Project Guidelines (UC-5) ────────────────────────────────────────────────

export async function syncProjectGuidelines(projectId: string, guidelineIds: string[]): Promise<void> {
  await supabase.from('Project_Guideline').delete().eq('projectId', projectId)
  if (guidelineIds.length === 0) return
  const rows = guidelineIds.map((guidelineId) => ({ projectId, guidelineId }))
  const { error } = await supabase.from('Project_Guideline').insert(rows)
  if (error) throw error
}

// ─── Project Scope / Features (UC-6) ─────────────────────────────────────────

export async function syncProjectScope(projectId: string, features: string[]): Promise<void> {
  await supabase.from('Project_Scope').delete().eq('projectId', projectId)
  if (features.length === 0) return
  const rows = features.map((feature) => ({ projectId, feature }))
  const { error } = await supabase.from('Project_Scope').insert(rows)
  if (error) throw error
}

// ─── Guidelines ───────────────────────────────────────────────────────────────

export async function fetchGuidelines(): Promise<DbGuideline[]> {
  const { data, error } = await supabase
    .from('Guideline')
    .select('guidelineId,guidelineName,shortName,version,description,source,lastUpdated')
    .order('guidelineName')
  if (error) throw error
  return (data as DbGuideline[]) ?? []
}

export async function deleteGuideline(guidelineId: string): Promise<void> {
  const { error } = await supabase.from('Guideline').delete().eq('guidelineId', guidelineId)
  if (error) throw error
}

// ─── Checklist Items ──────────────────────────────────────────────────────────

export async function fetchProjectChecklistItems(projectId: string): Promise<DbChecklistItem[]> {
  const { data, error } = await supabase.rpc('get_project_checklist_items', { p_project_id: projectId })
  if (error) throw error
  return (data as DbChecklistItem[]) ?? []
}

export async function updateChecklistItem(itemId: string, updates: {
  itemDescription?: string
  severity?: Severity
  category?: string
}): Promise<void> {
  const { error } = await supabase.from('Checklist_Item').update(updates).eq('itemId', itemId)
  if (error) throw error
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('Checklist_Item').delete().eq('itemId', itemId)
  if (error) throw error
}

// ─── Audit Results (UC-14.1, 14.2, 14.3) ────────────────────────────────────

export async function fetchAuditResults(projectId: string): Promise<DbAuditResult[]> {
  const { data, error } = await supabase
    .from('Audit_Result')
    .select('resultId,projectId,itemId,userId,guidelineId,result,notes,timeSubmitted')
    .eq('projectId', projectId)
  if (error) throw error
  return (data as DbAuditResult[]) ?? []
}

export async function upsertAuditResult(
  projectId: string,
  itemId: string,
  userId: string,
  guidelineId: string,
  result: ChecklistItemStatus,
  notes: string = ''
): Promise<{ answered: number; compliant: number; nonCompliant: number; notApplicable: number; percentage: number; total: number }> {
  const { data, error } = await supabase.rpc('upsert_audit_result', {
    p_project_id: projectId,
    p_item_id: itemId,
    p_user_id: userId,
    p_guideline_id: guidelineId,
    p_result: result,
    p_notes: notes || null,
  })
  if (error) throw error
  return data as { answered: number; compliant: number; nonCompliant: number; notApplicable: number; percentage: number; total: number }
}

// ─── Submission Workflow (UC-12, UC-13) ──────────────────────────────────────

export async function submitForReview(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('Audit_Project')
    .update({
      submissionStatus: 'pending_review',
      projectStatus: 'under_review',
      updatedAt: new Date().toISOString(),
    })
    .eq('projectId', projectId)
  if (error) throw error
}

export async function reviewSubmission(projectId: string, approved: boolean, remarks: string): Promise<void> {
  const { error } = await supabase
    .from('Audit_Project')
    .update({
      submissionStatus: approved ? 'approved' : 'rejected',
      projectStatus: approved ? 'completed' : 'in_progress',
      submissionRemarks: remarks || null,
      updatedAt: new Date().toISOString(),
    })
    .eq('projectId', projectId)
  if (error) throw error
}

// ─── Compliance Scores (UC-14.4, UC-15) ──────────────────────────────────────

export async function fetchComplianceScores(projectId: string): Promise<DbComplianceScore[]> {
  const { data, error } = await supabase.rpc('get_compliance_scores', { p_project_id: projectId })
  if (error) throw error
  return (data as DbComplianceScore[]) ?? []
}

// ─── Audit Reports (UC-16, UC-17) ────────────────────────────────────────────

export async function fetchAuditReports(
  userId: string,
  filters?: {
    statusFilter?: SubmissionStatus
    search?: string
    dateFrom?: string
    dateTo?: string
  }
): Promise<DbAuditReport[]> {
  const { data, error } = await supabase.rpc('get_audit_reports', {
    p_user_id: userId,
    p_status_filter: filters?.statusFilter ?? null,
    p_search: filters?.search ?? null,
    p_date_from: filters?.dateFrom ?? null,
    p_date_to: filters?.dateTo ?? null,
  })
  if (error) throw error
  return (data as DbAuditReport[]) ?? []
}

export async function createAuditReport(projectId: string, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('Audit_Report')
    .insert({ projectId, userId })
    .select('reportId')
    .single()
  if (error) throw error
  return (data as { reportId: string }).reportId
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function fetchAllUsers(): Promise<DbUser[]> {
  const { data, error } = await supabase
    .from('User')
    .select('userId,userName,userEmail,role')
    .order('userName')
  if (error) throw error
  return (data as DbUser[]) ?? []
}

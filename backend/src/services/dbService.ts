import crypto from 'crypto'

function generateSequentialUUID(baseTs: number, offset: number) {
  const ts = (baseTs + offset).toString(16).padStart(12, '0');
  const r = crypto.randomUUID().replace(/-/g, '');
  return `${ts.substring(0,8)}-${ts.substring(8,12)}-7${r.substring(13,16)}-8${r.substring(17,20)}-${r.substring(20,32)}`;
}

import { supabase, getSupabaseClient } from '../config/supabase.js'
import type { AuditStatus, ChecklistItemStatus, Platform, Severity, SubmissionStatus, UserRole } from '../types/index.js'

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

// Returns average scorePercentage per projectId across all its guidelines
export async function fetchProjectComplianceSummary(
  projectIds: string[]
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}
  const { data, error } = await supabase
    .from('Compliance_Score')
    .select('projectId,scorePercentage')
    .in('projectId', projectIds)
  if (error) throw error
  const totals: Record<string, { sum: number; count: number }> = {}
  for (const row of (data ?? []) as { projectId: string; scorePercentage: number | null }[]) {
    if (!totals[row.projectId]) totals[row.projectId] = { sum: 0, count: 0 }
    totals[row.projectId].sum += row.scorePercentage ?? 0
    totals[row.projectId].count += 1
  }
  return Object.fromEntries(
    Object.entries(totals).map(([pid, { sum, count }]) => [pid, Math.round((sum / count) * 10) / 10])
  )
}

export async function deleteProject(projectId: string): Promise<void> {
  const { error } = await supabase.from('Audit_Project').delete().eq('projectId', projectId)
  if (error) throw error
}

// ─── Project Members ─────────────────────────────────────────────────

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

// ─── Project Guidelines ────────────────────────────────────────────────

export async function syncProjectGuidelines(projectId: string, guidelineIds: string[]): Promise<void> {
  await supabase.from('Project_Guideline').delete().eq('projectId', projectId)
  if (guidelineIds.length > 0) {
    const rows = guidelineIds.map((guidelineId) => ({ projectId, guidelineId }))
    const { error } = await supabase.from('Project_Guideline').insert(rows)
    if (error) throw error
  }

  // Delete project-specific checklists for guidelines that are no longer linked
  const { data: existingCL, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId,guidelineId')
    .eq('projectId', projectId)
  if (clError) throw clError

  for (const cl of (existingCL ?? [])) {
    if (!guidelineIds.includes(cl.guidelineId)) {
      await supabase.from('Checklist_Item').delete().eq('checklistId', cl.checklistId)
      await supabase.from('Checklist').delete().eq('checklistId', cl.checklistId)
    }
  }

  // Initialize project-specific checklists for new guidelines
  await initializeProjectChecklists(projectId)
}

// ─── Project Scope / Features ─────────────────────────────────────────

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
    .select(`
      guidelineId,guidelineName,shortName,version,description,source,lastUpdated,categories,
      Checklist(checklistId, projectId)
    `)
    
    .order('guidelineName')
  if (error) throw error
  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const r = row as Record<string, unknown>
    const checklists = (r['Checklist'] as { Checklist_Item?: unknown[] }[] | null) ?? []
    const itemCount = checklists.reduce((sum, c) => sum + (c.Checklist_Item?.length ?? 0), 0)
    return {
      guidelineId: r['guidelineId'] as string,
      guidelineName: r['guidelineName'] as string,
      shortName: r['shortName'] as string | null,
      version: r['version'] as string | null,
      description: r['description'] as string | null,
      source: r['source'] as string | null,
      lastUpdated: r['lastUpdated'] as string | null,
      categories: r['categories'] as string[] | null,
      itemCount,
      isDeleted: !checklists.some((c: any) => c.projectId === null),
    } satisfies DbGuideline
  })
}

export async function deleteGuideline(guidelineId: string): Promise<void> {
  // Soft Delete: We only remove the global template checklist to hide it from admins and prevent new uses.
  // We DO NOT delete the Guideline row, Audit_Result, Project_Guideline, or project-specific Checklists,
  // preserving all Auditor and Head Auditor progress.
  
  // 1. Find the global Checklist for this guideline
  const { data: globalChecklist, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId')
    .eq('guidelineId', guidelineId)
    .is('projectId', null)
    .single()
    
  if (clError) {
    if (clError.code === 'PGRST116') return // Already deleted/doesn't exist
    throw clError
  }

  const checklistId = (globalChecklist as any).checklistId

  // 2. Delete Checklist_Item rows linked to the global checklist
  const { error: ciError } = await supabase.from('Checklist_Item').delete().eq('checklistId', checklistId)
  if (ciError) throw ciError

  // 3. Delete the global Checklist itself
  const { error: cdError } = await supabase.from('Checklist').delete().eq('checklistId', checklistId)
  if (cdError) throw cdError
}

// Fetch global (template) checklist items for a guideline - used by admin view
export async function fetchGuidelineItems(guidelineId: string): Promise<DbChecklistItem[]> {
  // Find the global checklist (projectId IS NULL) for this guideline
  const { data: clData, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId')
    .is('projectId', null)
    .eq('guidelineId', guidelineId)
    .limit(1)
    .single()
  if (clError) {
    // No checklist yet - return empty
    if (clError.code === 'PGRST116') return []
    throw clError
  }
  const checklistId = (clData as any).checklistId

  const { data: items, error: itemsError } = await supabase
    .from('Checklist_Item')
    .select('itemId,category,itemDescription,severity,reference,feature')
    .eq('checklistId', checklistId)
  if (itemsError) throw itemsError

  return (items ?? []).map((i: any) => ({
    itemId: i.itemId,
    guidelineId,
    category: i.category,
    itemDescription: i.itemDescription,
    severity: i.severity,
    reference: i.reference,
    feature: i.feature
  }))
}

// ─── Checklist Items ──────────────────────────────────────────────────────────

export async function initializeProjectChecklists(projectId: string): Promise<void> {
  const { data: projectGuidelines, error: pgError } = await supabase
    .from('Project_Guideline')
    .select('guidelineId')
    .eq('projectId', projectId)
  if (pgError) throw pgError

  const guidelineIds = (projectGuidelines ?? []).map((row: any) => row.guidelineId)
  if (guidelineIds.length === 0) return

  for (const guidelineId of guidelineIds) {
    const { data: existing, error: exError } = await supabase
      .from('Checklist')
      .select('checklistId')
      .eq('projectId', projectId)
      .eq('guidelineId', guidelineId)
    if (exError) throw exError

    if (!existing || existing.length === 0) {
      const { data: globalCL, error: gclError } = await supabase
        .from('Checklist')
        .select('checklistId')
        .is('projectId', null)
        .eq('guidelineId', guidelineId)
        .limit(1)
      if (gclError) throw gclError

      if (globalCL && globalCL.length > 0) {
        const globalChecklistId = globalCL[0].checklistId
        const newChecklistId = crypto.randomUUID()

        const { error: insClError } = await supabase
          .from('Checklist')
          .insert({
            checklistId: newChecklistId,
            projectId,
            guidelineId,
            checklistSource: 'generator',
            timeCreated: new Date().toISOString()
          })
        if (insClError) throw insClError

        const { data: globalItems, error: itemsError } = await supabase
          .from('Checklist_Item')
          .select('itemDescription,category,severity,reference,feature,itemId')
          .order('itemId', { ascending: true })
          .eq('checklistId', globalChecklistId)
        if (itemsError) throw itemsError

        if (globalItems && globalItems.length > 0) {
          const newItems = globalItems.map((item: any) => ({
            itemId: crypto.randomUUID(),
            checklistId: newChecklistId,
            itemDescription: item.itemDescription,
            category: item.category,
            severity: item.severity,
            reference: item.reference,
            feature: item.feature
          }))

          const { error: insItemsError } = await supabase
            .from('Checklist_Item')
            .insert(newItems)
          if (insItemsError) throw insItemsError
        }
      }
    }
  }
}

export async function fetchProjectChecklistItems(projectId: string): Promise<DbChecklistItem[]> {
  await initializeProjectChecklists(projectId)

  const { data: checklists, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId,guidelineId')
    .eq('projectId', projectId)
  if (clError) throw clError

  if (!checklists || checklists.length === 0) return []
  const checklistIds = checklists.map((c: any) => c.checklistId)

  const { data: items, error: itemsError } = await supabase
    .from('Checklist_Item')
    .select('itemId,checklistId,category,itemDescription,severity,reference,feature')
    .in('checklistId', checklistIds)
    .order('itemId', { ascending: true })
  if (itemsError) throw itemsError

  return (items ?? []).map((i: any) => ({
    itemId: i.itemId,
    guidelineId: (checklists.find((c: any) => c.checklistId === i.checklistId) as any)?.guidelineId,
    category: i.category,
    itemDescription: i.itemDescription,
    severity: i.severity,
    reference: i.reference,
    feature: i.feature
  }))
}

export async function addProjectChecklistItem(projectId: string, guidelineId: string, item: {
  category: string
  text: string
  severity: Severity
  reference?: string
  feature?: string
}): Promise<string> {
  const { data: checklist, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId')
    .eq('projectId', projectId)
    .eq('guidelineId', guidelineId)
    .limit(1)
    .single()
  if (clError) throw clError
  const checklistId = (checklist as any).checklistId

  const newItemId = crypto.randomUUID()
  const { error: itemError } = await supabase
    .from('Checklist_Item')
    .insert({
      itemId: newItemId,
      checklistId,
      itemDescription: item.text,
      category: item.category,
      severity: item.severity,
      reference: item.reference || null,
      feature: item.feature || null
    })
  if (itemError) throw itemError
  return newItemId
}

export async function toggleProjectChecklistCategory(projectId: string, guidelineId: string, category: string, enabled: boolean): Promise<void> {
  const { data: checklist, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId')
    .eq('projectId', projectId)
    .eq('guidelineId', guidelineId)
    .limit(1)
    .single()
  if (clError) throw clError
  const checklistId = (checklist as any).checklistId

  if (!enabled) {
    const { error: delError } = await supabase
      .from('Checklist_Item')
      .delete()
      .eq('checklistId', checklistId)
      .eq('category', category)
      .order('itemId', { ascending: true })
    if (delError) throw delError
  } else {
    const { data: globalCL, error: gclError } = await supabase
      .from('Checklist')
      .select('checklistId')
      .is('projectId', null)
      .eq('guidelineId', guidelineId)
      .limit(1)
      .single()
    if (gclError) throw gclError
    const globalChecklistId = (globalCL as any).checklistId

    const { data: globalItems, error: itemsError } = await supabase
      .from('Checklist_Item')
      .select('itemDescription,category,severity,reference,feature,itemId')
          .order('itemId', { ascending: true })
      .eq('checklistId', globalChecklistId)
      .eq('category', category)
      .order('itemId', { ascending: true })
    if (itemsError) throw itemsError

    if (globalItems && globalItems.length > 0) {
      const newItems = globalItems.map((item: any) => ({
        itemId: crypto.randomUUID(),
        checklistId,
        itemDescription: item.itemDescription,
        category: item.category,
        severity: item.severity,
        reference: item.reference,
        feature: item.feature
      }))
      const { error: insError } = await supabase
        .from('Checklist_Item')
        .insert(newItems)
      if (insError) throw insError
    }
  }
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

// ─── Audit Results (14.2, 14.3) ────────────────────────────────────

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

// ─── Submission Workflow ──────────────────────────────────────

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

// ─── Compliance Scores ──────────────────────────────────────

export async function fetchComplianceScores(projectId: string): Promise<DbComplianceScore[]> {
  const { data, error } = await supabase.rpc('get_compliance_scores', { p_project_id: projectId })
  if (error) throw error
  return (data as DbComplianceScore[]) ?? []
}

// ─── Audit Reports ────────────────────────────────────────────

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
  const { guideline, items } = input
  
  let userId = guideline.userId
  if (userId) {
    // Validate if the userId exists
    const { data: validUser } = await supabase.from('User').select('userId').eq('userId', userId).single()
    if (!validUser) {
      userId = '' // Force fallback if invalid
    }
  }
  
  if (!userId) {
    const { data: userData } = await supabase.from('User').select('userId').limit(1).single()
    if (userData) {
      userId = (userData as any).userId
    }
  }

  console.log("createGuideline started. Number of items:", items.length);

  // 1. Insert Guideline row
  console.log("Inserting Guideline row...");
  const { error: gError } = await supabase
    .from('Guideline')
    .insert({
      guidelineId: guideline.guidelineId,
      guidelineName: guideline.guidelineName,
      shortName: guideline.shortName,
      version: guideline.version,
      description: guideline.description,
      source: guideline.source,
      categories: guideline.categories,
      lastUpdated: guideline.lastUpdated,
      userId,
      timeUpdated: new Date().toISOString()
    })
  if (gError) throw gError

  // 2. Insert Checklist row
  console.log("Inserting Checklist row...");
  const checklistId = crypto.randomUUID()
  const { error: clError } = await supabase
    .from('Checklist')
    .insert({
      checklistId,
      guidelineId: guideline.guidelineId,
      checklistSource: 'generator',
      timeCreated: new Date().toISOString()
    })
  if (clError) throw clError

  // 3. Insert Checklist_Item rows
  console.log("Preparing Checklist_Item rows...");
  const dbItems = items.map((item) => ({
    itemId: item.id,
    checklistId,
    itemDescription: item.text,
    category: item.category,
    severity: item.severity,
    reference: item.reference || null,
    feature: item.feature || null
  }))

  // Chunk the items to avoid Supabase connection timeouts and payload limits
  const CHUNK_SIZE = 50;
  console.log("Starting to insert chunks...");
  for (let i = 0; i < dbItems.length; i += CHUNK_SIZE) {
    console.log(`Inserting chunk ${i / CHUNK_SIZE + 1} / ${Math.ceil(dbItems.length / CHUNK_SIZE)}`);
    const chunk = dbItems.slice(i, i + CHUNK_SIZE);
    const { error: itemError } = await supabase
      .from('Checklist_Item')
      .insert(chunk);
    if (itemError) throw itemError;
  }
}

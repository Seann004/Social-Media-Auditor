import https from 'https'
import crypto from 'crypto'



function generateSequentialUUID(baseTs: number, offset: number) {

  const ts = (baseTs + offset).toString(16).padStart(12, '0');

  const r = crypto.randomUUID().replace(/-/g, '');

  return `${ts.substring(0,8)}-${ts.substring(8,12)}-7${r.substring(13,16)}-8${r.substring(17,20)}-${r.substring(20,32)}`;

}



import { supabase, getSupabaseClient } from '../config/supabase.js'

import type { AuditStatus, ChecklistItemStatus, Platform, Severity, SubmissionStatus, UserRole } from '../types/index.js'



// DB row types 

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

  projectId?: string | null

  originalGuidelineId?: string | null

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

export function compareReferences(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aParts = a.split(/(\d+)/);
  const bParts = b.split(/(\d+)/);

  for (let idx = 0; idx < Math.min(aParts.length, bParts.length); idx++) {
    const aPart = aParts[idx];
    const bPart = bParts[idx];

    if (aPart !== bPart) {
      const aNum = parseInt(aPart, 10);
      const bNum = parseInt(bPart, 10);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return aPart.localeCompare(bPart, undefined, { numeric: true, sensitivity: 'base' });
    }
  }

  return aParts.length - bParts.length;
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



// ΓöÇΓöÇΓöÇ Projects ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function fetchUserProjects(userId: string): Promise<DbProject[]> {
  // 1. Get member project IDs
  const { data: memberRows, error: memberError } = await supabase
    .from('Project_Member')
    .select('projectId')
    .eq('userId', userId)
  if (memberError) throw memberError
  
  const memberProjectIds = (memberRows ?? []).map(r => r.projectId)
  
  // 2. Fetch projects
  let query = supabase.from('Audit_Project').select('*')
  if (memberProjectIds.length > 0) {
    query = query.or(`headAuditorId.eq.${userId},projectId.in.(${memberProjectIds.join(',')})`)
  } else {
    query = query.eq('headAuditorId', userId)
  }
  
  const { data: projects, error: projectError } = await query.order('timeCreated', { ascending: false })
  if (projectError) throw projectError
  if (!projects || projects.length === 0) return []
  
  const projectIds = projects.map(p => p.projectId)
  
  // Fetch all members for these projects
  const { data: allMembers, error: membersError } = await supabase
    .from('Project_Member')
    .select('projectId, userId')
    .in('projectId', projectIds)
  if (membersError) throw membersError
  
  // Fetch all cloned guidelines for these projects
  const { data: allGuidelines, error: guidelinesError } = await supabase
    .from('Guideline')
    .select('projectId, guidelineId')
    .in('projectId', projectIds)
  if (guidelinesError) throw guidelinesError
  
  // Map them
  const membersMap = new Map()
  for (const m of (allMembers ?? [])) {
    const list = membersMap.get(m.projectId) || []
    list.push(m.userId)
    membersMap.set(m.projectId, list)
  }
  
  const guidelinesMap = new Map()
  for (const g of (allGuidelines ?? [])) {
    if (g.projectId) {
      const list = guidelinesMap.get(g.projectId) || []
      list.push(g.guidelineId)
      guidelinesMap.set(g.projectId, list)
    }
  }
  
  return projects.map((p: any) => ({
    projectId: p.projectId,
    projectTitle: p.projectTitle,
    smPlatform: p.smPlatform,
    projectStatus: p.projectStatus,
    submissionStatus: p.submissionStatus,
    submissionRemarks: p.submissionRemarks,
    headAuditorId: p.headAuditorId,
    projectNotes: p.projectNotes,
    dueDate: p.dueDate,
    timeCreated: p.timeCreated,
    updatedAt: p.updatedAt,
    memberIds: membersMap.get(p.projectId) ?? [],
    guidelineIds: guidelinesMap.get(p.projectId) ?? [],
  }))
}

export async function fetchProjectDetails(projectId: string) {

  // 1. Fetch project

  const { data: project, error: pError } = await supabase

    .from('Audit_Project')

    .select('*')

    .eq('projectId', projectId)

    .single()

  if (pError) throw pError



  // 2. Fetch members

  const { data: membersData, error: mError } = await supabase

    .from('Project_Member')

    .select(`

      userId,

      User(userName, role)

    `)

    .eq('projectId', projectId)

  if (mError) throw mError



  const members = (membersData || []).map((row: any) => ({

    userId: row.userId,

    userName: row.User?.userName || '',

    role: row.User?.role || '',

  }))



  // 3. Fetch guidelines (project cloned guidelines)
  const { data: gData, error: gError } = await supabase
    .from('Guideline')
    .select('guidelineId, guidelineName, shortName, version, description, source, categories, lastUpdated, originalGuidelineId')
    .eq('projectId', projectId)
  if (gError) throw gError

  const guidelines = (gData || []).map((row: any) => ({
    guidelineId: row.guidelineId,
    guidelineName: row.guidelineName || '',
    shortName: row.shortName || '',
    version: row.version || '',
    description: row.description || '',
    source: row.source || '',
    categories: row.categories || [],
    lastUpdated: row.lastUpdated || '',
    originalGuidelineId: row.originalGuidelineId || null,
  }))
  
  // 4. Fetch scope

  const { data: scopeData, error: sError } = await supabase

    .from('Project_Scope')

    .select('feature')

    .eq('projectId', projectId)

  if (sError) throw sError



  const scope = (scopeData || []).map((row: any) => row.feature)



  return {

    project: project as DbProject,

    members,

    guidelines,

    scope,

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

// Compute live compliance percentage per project directly from Audit_Result rows
// (compliant / applicable) where applicable = compliant + non_compliant + partially

export async function fetchProjectComplianceSummary(
  projectIds: string[]
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}

  const { data: checklists, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId,projectId')
    .in('projectId', projectIds)
  if (clError) throw clError

  const checklistIds = (checklists ?? []).map((c: any) => c.checklistId)

  let activeItemIds = new Set<string>()
  if (checklistIds.length > 0) {
    const { data: activeItems, error: itemsError } = await supabase
      .from('Checklist_Item')
      .select('itemId')
      .in('checklistId', checklistIds)
      .not('category', 'like', '__deactivated__%')
    if (itemsError) throw itemsError
    activeItemIds = new Set((activeItems ?? []).map((i) => i.itemId))
  }

  const { data, error } = await supabase
    .from('Audit_Result')
    .select('projectId,result,itemId')
    .in('projectId', projectIds)

  if (error) throw error

  const buckets: Record<string, { weightedCompliant: number; applicable: number }> = {}
  for (const row of (data ?? []) as { projectId: string; result: string; itemId: string }[]) {
    if (!activeItemIds.has(row.itemId)) continue

    if (!buckets[row.projectId]) buckets[row.projectId] = { weightedCompliant: 0, applicable: 0 }
    if (['compliant', 'non_compliant', 'partially'].includes(row.result)) {
      buckets[row.projectId].applicable++
      if (row.result === 'compliant') buckets[row.projectId].weightedCompliant += 1
      else if (row.result === 'partially') buckets[row.projectId].weightedCompliant += 0.5
    }
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([pid, { weightedCompliant, applicable }]) => [
      pid,
      applicable > 0 ? Math.round((weightedCompliant / applicable) * 1000) / 10 : 0,
    ])
  )
}



export async function deleteProject(projectId: string): Promise<void> {

  // Delete project-specific guidelines

  await supabase.from('Guideline').delete().eq('projectId', projectId)



  // Delete project itself

  const { error } = await supabase.from('Audit_Project').delete().eq('projectId', projectId)

  if (error) throw error

}



// ΓöÇΓöÇΓöÇ Project Members ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



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



// ΓöÇΓöÇΓöÇ Project Guidelines ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function syncProjectGuidelines(projectId: string, globalGuidelineIds: string[]): Promise<void> {
  // 1. Fetch existing cloned guidelines for this project
  const { data: existingClones, error: fetchError } = await supabase
    .from('Guideline')
    .select('guidelineId, originalGuidelineId')
    .eq('projectId', projectId)
  if (fetchError) throw fetchError

  const existingClonesMap = new Map<string, string>() // originalGuidelineId -> clonedGuidelineId
  const keptClonedIds: string[] = []

  for (const clone of (existingClones ?? [])) {
    const origId = (clone as any).originalGuidelineId
    const clonedId = clone.guidelineId
    
    if (origId) {
      if (globalGuidelineIds.includes(origId)) {
        // This guideline is still selected, keep it
        existingClonesMap.set(origId, clonedId)
        keptClonedIds.push(clonedId)
      } else {
        // This guideline was deselected, delete its clone
        const { error: delError } = await supabase
          .from('Guideline')
          .delete()
          .eq('guidelineId', clonedId)
        if (delError) throw delError
      }
    }
  }

  // 2. Clone selected guidelines that haven't been cloned yet
  for (const globalGuidelineId of globalGuidelineIds) {
    if (!existingClonesMap.has(globalGuidelineId)) {
      // Fetch global guideline metadata
      const { data: globalGuideline, error: gError } = await supabase
        .from('Guideline')
        .select('*')
        .eq('guidelineId', globalGuidelineId)
        .single()
      if (gError) throw gError

      if (globalGuideline) {
        const clonedGuidelineId = crypto.randomUUID()
        const { error: insError } = await supabase
          .from('Guideline')
          .insert({
            guidelineId: clonedGuidelineId,
            guidelineName: globalGuideline.guidelineName,
            shortName: globalGuideline.shortName,
            version: globalGuideline.version,
            description: globalGuideline.description,
            source: globalGuideline.source,
            categories: globalGuideline.categories,
            lastUpdated: globalGuideline.lastUpdated,
            userId: globalGuideline.userId,
            projectId: projectId,
            originalGuidelineId: globalGuidelineId,
            timeUpdated: new Date().toISOString()
          })
        if (insError) throw insError
      }
    }
  }

  // 3. Initialize project-specific checklists
  await initializeProjectChecklists(projectId)
}

export async function syncProjectScope(projectId: string, features: string[]): Promise<void> {

  await supabase.from('Project_Scope').delete().eq('projectId', projectId)

  if (features.length === 0) return

  const rows = features.map((feature) => ({ projectId, feature }))

  const { error } = await supabase.from('Project_Scope').insert(rows)

  if (error) throw error

}



// ΓöÇΓöÇΓöÇ Guidelines ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function fetchGuidelines(): Promise<DbGuideline[]> {

  const { data, error } = await supabase

    .from('Guideline')

    .select(`

      guidelineId,guidelineName,shortName,version,description,source,lastUpdated,categories,
Checklist(checklistId, projectId, Checklist_Item(itemId))

    `)

    .is('projectId', null)

    .order('guidelineName')

  if (error) throw error

  return ((data ?? []) as unknown[]).map((row: unknown) => {

    const r = row as Record<string, unknown>
const checklists = (r['Checklist'] as { checklistId: string; projectId: string | null; Checklist_Item?: { itemId: string }[] }[] | null) ?? []
    const globalChecklist = checklists.find((c) => c.projectId === null)
    const itemCount = globalChecklist?.Checklist_Item?.length ?? 0

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
isDeleted: !checklists.some((c) => c.projectId === null),

    } satisfies DbGuideline

  })

}



export async function deleteGuideline(guidelineId: string): Promise<void> {

  // Soft Delete: We only remove the global template checklist to hide it from admins and prevent new uses.

  // We DO NOT delete the Guideline row, Audit_Result, or project-specific Checklists,

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



  // 2. Fetch item IDs so we can delete dependent Audit_Result rows first

  const { data: items, error: itemFetchError } = await supabase

    .from('Checklist_Item')

    .select('itemId')

    .eq('checklistId', checklistId)

  if (itemFetchError) throw itemFetchError

  const itemIds = ((items ?? []) as { itemId: string }[]).map((i) => i.itemId)

  if (itemIds.length > 0) {

    const { error: arError } = await supabase.from('Audit_Result').delete().in('itemId', itemIds)

    if (arError) throw arError

  }



  // 3. Delete Checklist_Item rows linked to the global checklist

  const { error: ciError } = await supabase.from('Checklist_Item').delete().eq('checklistId', checklistId)

  if (ciError) throw ciError



  // 4. Delete the global Checklist itself

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
    .select('itemId,category,itemDescription,severity,reference,itemName,itemCode,rowType,helpText,verbatimClauseText,answerOptions')
    .eq('checklistId', checklistId)

  if (itemsError) throw itemsError

  const mapped = (items ?? []).map((i: any) => ({
    itemId: i.itemId,
    guidelineId,
    category: i.category,
    itemDescription: i.itemDescription,
    severity: i.severity,
    reference: i.reference,
    itemName: i.itemName,
    itemCode: i.itemCode,
    rowType: i.rowType,
    helpText: i.helpText,
    verbatimClauseText: i.verbatimClauseText,
    answerOptions: i.answerOptions,
  }))

  return mapped.sort((a, b) => compareReferences(a.reference, b.reference))
}



// ΓöÇΓöÇΓöÇ Checklist Items ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function initializeProjectChecklists(projectId: string): Promise<void> {
  const { data: projectGuidelines, error: pgError } = await supabase
    .from('Guideline')
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
      // Find originalGuidelineId for this cloned guideline
      const { data: cloneInfo, error: cloneError } = await supabase
        .from('Guideline')
        .select('originalGuidelineId')
        .eq('guidelineId', guidelineId)
        .single()
      if (cloneError) throw cloneError

      const originalGuidelineId = (cloneInfo as any)?.originalGuidelineId
      if (originalGuidelineId) {
        // Find the global checklist (projectId IS NULL) for the original template guideline
        const { data: globalCL, error: gclError } = await supabase
          .from('Checklist')
          .select('checklistId')
          .is('projectId', null)
          .eq('guidelineId', originalGuidelineId)
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
              guidelineId, // associate with clonedGuidelineId
              checklistSource: 'generator',
              timeCreated: new Date().toISOString()
            })
          if (insClError) throw insClError

          const { data: globalItems, error: itemsError } = await supabase
            .from('Checklist_Item')
            .select('itemId,itemDescription,category,severity,reference,itemName,itemCode,rowType,helpText,verbatimClauseText,answerOptions')
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
              itemName: item.itemName,
              itemCode: item.itemCode,
              rowType: item.rowType,
              helpText: item.helpText,
              verbatimClauseText: item.verbatimClauseText,
              answerOptions: item.answerOptions,
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
    .select('itemId,checklistId,category,itemDescription,severity,reference,itemName,itemCode,rowType,helpText,verbatimClauseText,answerOptions')
    .in('checklistId', checklistIds)
    .order('itemId', { ascending: true })

  if (itemsError) throw itemsError

  const mapped = (items ?? [])
    .filter((i: any) => !i.category?.startsWith('__deactivated__'))
    .map((i: any) => ({
      itemId: i.itemId,
      guidelineId: (checklists.find((c: any) => c.checklistId === i.checklistId) as any)?.guidelineId,
      category: i.category,
      itemDescription: i.itemDescription,
      severity: i.severity,
      reference: i.reference,
      itemName: i.itemName,
      itemCode: i.itemCode,
      rowType: i.rowType,
      helpText: i.helpText,
      verbatimClauseText: i.verbatimClauseText,
      answerOptions: i.answerOptions,
    }))

  return mapped.sort((a, b) => compareReferences(a.reference, b.reference))
}



export async function addProjectChecklistItem(projectId: string, guidelineId: string, item: {

  category: string

  text: string

  severity: Severity

  reference?: string

  itemName?: string
  itemCode?: string
  helpText?: string
  verbatimClauseText?: string
  answerOptions?: string

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

      itemName: item.itemName || null,
      itemCode: item.itemCode || null,
      helpText: item.helpText || null,
      verbatimClauseText: item.verbatimClauseText || null,
      answerOptions: item.answerOptions || null,

    })

  if (itemError) throw itemError

  return newItemId

}


export async function saveAuditFindings(projectId: string, itemId: string, userId: string, findings: string): Promise<void> {
  const { error } = await supabase
    .from('Audit_Result')
    .update({ findings: findings || null })
    .eq('projectId', projectId)
    .eq('itemId', itemId)
    .eq('userId', userId)
  if (error) throw error
}

export async function saveEvidenceImages(projectId: string, itemId: string, userId: string, images: { url: string; name: string }[]): Promise<void> {
  const { error } = await supabase
    .from('Audit_Result')
    .update({ evidenceImages: images.length > 0 ? images : [] })
    .eq('projectId', projectId)
    .eq('itemId', itemId)
    .eq('userId', userId)
  if (error) throw error
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
    // Soft-deactivate: prefix the category with "__deactivated__" so they are ignored in active calculations
    const { error: updError } = await supabase
      .from('Checklist_Item')
      .update({ category: `__deactivated__${category}` })
      .eq('checklistId', checklistId)
      .eq('category', category)

    if (updError) throw updError
  } else {
    // Check if we have previously deactivated items for this project/category
    const { data: deactivatedItems, error: deacError } = await supabase
      .from('Checklist_Item')
      .select('itemId')
      .eq('checklistId', checklistId)
      .eq('category', `__deactivated__${category}`)
    if (deacError) throw deacError

    if (deactivatedItems && deactivatedItems.length > 0) {
      // Restore the items by removing the "__deactivated__" prefix from their category
      const { error: restoreError } = await supabase
        .from('Checklist_Item')
        .update({ category: category })
        .eq('checklistId', checklistId)
        .eq('category', `__deactivated__${category}`)
      if (restoreError) throw restoreError
    } else {
      // First-time enablement: clone from the global template
      const { data: guidelineInfo, error: giError } = await supabase
        .from('Guideline')
        .select('originalGuidelineId')
        .eq('guidelineId', guidelineId)
        .single()
      if (giError) throw giError

      const templateGuidelineId = (guidelineInfo as any).originalGuidelineId ?? guidelineId

      const { data: globalCL, error: gclError } = await supabase
        .from('Checklist')
        .select('checklistId')
        .is('projectId', null)
        .eq('guidelineId', templateGuidelineId)
        .limit(1)
        .single()

      if (gclError) throw gclError

      const globalChecklistId = (globalCL as any).checklistId

      const { data: globalItems, error: itemsError } = await supabase
        .from('Checklist_Item')
        .select('itemId,itemDescription,category,severity,reference,itemName,itemCode,rowType,helpText,verbatimClauseText,answerOptions')
        .order('itemId', { ascending: true })
        .eq('checklistId', globalChecklistId)
        .eq('category', category)

      if (itemsError) throw itemsError

      if (globalItems && globalItems.length > 0) {
        const newItems = globalItems.map((item: any) => ({
          itemId: crypto.randomUUID(),
          checklistId,
          itemDescription: item.itemDescription,
          category: item.category,
          severity: item.severity,
          reference: item.reference,
          itemName: item.itemName,
          itemCode: item.itemCode,
          rowType: item.rowType,
          helpText: item.helpText,
          verbatimClauseText: item.verbatimClauseText,
          answerOptions: item.answerOptions,
        }))

        const { error: insError } = await supabase
          .from('Checklist_Item')
          .insert(newItems)

        if (insError) throw insError
      }
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

  // First delete any audit results referencing this item (FK constraint)

  const { error: arError } = await supabase.from('Audit_Result').delete().eq('itemId', itemId)

  if (arError) throw arError

  // Now delete the checklist item itself

  const { error } = await supabase.from('Checklist_Item').delete().eq('itemId', itemId)

  if (error) throw error

}



// ΓöÇΓöÇΓöÇ Audit Results (14.2, 14.3) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function fetchAuditResults(projectId: string): Promise<DbAuditResult[]> {

  const { data, error } = await supabase

    .from('Audit_Result')

    .select('resultId,projectId,itemId,userId,guidelineId,result,notes,findings,evidenceImages,timeSubmitted')

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



// ΓöÇΓöÇΓöÇ Submission Workflow ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



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



// ΓöÇΓöÇΓöÇ Compliance Scores ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function fetchComplianceScores(projectId: string): Promise<DbComplianceScore[]> {
  // 1. Fetch project guidelines
  const { data: projectGuidelines, error: pgError } = await supabase
    .from('Guideline')
    .select('guidelineId')
    .eq('projectId', projectId)
  if (pgError) throw pgError

  const guidelineIds = (projectGuidelines ?? []).map((row: any) => row.guidelineId)
  if (guidelineIds.length === 0) return []

  // 2. Fetch checklists for the project
  const { data: checklists, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId,guidelineId')
    .eq('projectId', projectId)
  if (clError) throw clError

  // 3. Fetch guideline details (names, shortNames, etc.)
  const { data: guidelines, error: gError } = await supabase
    .from('Guideline')
    .select('guidelineId,guidelineName,shortName')
    .in('guidelineId', guidelineIds)
  if (gError) throw gError

  // 4. Fetch checklist items
  const checklistIds = (checklists ?? []).map((c: any) => c.checklistId)
  let items: any[] = []
  if (checklistIds.length > 0) {
    const { data: itemsData, error: itemsError } = await supabase
      .from('Checklist_Item')
      .select('itemId,checklistId,category')
      .in('checklistId', checklistIds)
      .not('category', 'like', '__deactivated__%')
    if (itemsError) throw itemsError
    items = itemsData ?? []
  }

  // 5. Fetch audit results
  const { data: auditResults, error: arError } = await supabase
    .from('Audit_Result')
    .select('itemId,result')
    .eq('projectId', projectId)
  if (arError) throw arError

  const resultsMap = new Map<string, string>()
  for (const r of (auditResults ?? [])) {
    resultsMap.set(r.itemId, r.result)
  }

  const scores: DbComplianceScore[] = []
  for (const guidelineId of guidelineIds) {
    const g = guidelines?.find((x) => x.guidelineId === guidelineId)
    const cl = checklists?.find((x) => x.guidelineId === guidelineId)
    const clId = cl?.checklistId

    const clItems = items.filter((i) => i.checklistId === clId)
    let total = clItems.length
    let answered = 0
    let compliant = 0
    let nonCompliant = 0
    let notApplicable = 0
    let weightedCompliant = 0

    for (const item of clItems) {
      const res = resultsMap.get(item.itemId)
      if (res && res !== 'not_started' && res !== 'needs_review') {
        answered++
        if (res === 'compliant') {
          compliant++
          weightedCompliant += 1
        } else if (res === 'partially') {
          nonCompliant++
          weightedCompliant += 0.5
        } else if (res === 'non_compliant') {
          nonCompliant++
        } else if (res === 'not_applicable') {
          notApplicable++
        }
      }
    }

    const applicable = answered - notApplicable
    const scorePercentage = applicable > 0 ? Math.round((weightedCompliant / applicable) * 1000) / 10 : 0

    scores.push({
      scoreId: crypto.randomUUID(),
      guidelineId,
      guidelineName: g?.guidelineName || 'Guideline',
      shortName: g?.shortName || 'Guideline',
      totalItems: total,
      answeredItems: answered,
      compliantItems: compliant,
      nonCompliantItems: nonCompliant,
      notApplicableItems: notApplicable,
      scorePercentage,
      timeCalculated: new Date().toISOString()
    })
  }

  return scores
}



// ΓöÇΓöÇΓöÇ Audit Reports ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



export async function fetchAuditReports(
  userId: string,
  filters?: {
    projectStatusFilter?: AuditStatus
    search?: string
    dateFrom?: string
    dateTo?: string
  }
): Promise<DbAuditReport[]> {
  // 1. Get member project IDs
  const { data: memberRows, error: memberError } = await supabase
    .from('Project_Member')
    .select('projectId')
    .eq('userId', userId)
  if (memberError) throw memberError
  const memberProjectIds = (memberRows ?? []).map(r => r.projectId)
  
  // 2. Fetch projects
  let pQuery = supabase.from('Audit_Project').select('projectId, projectTitle, smPlatform, projectStatus, submissionStatus, submissionRemarks, headAuditorId, dueDate, timeCreated, updatedAt')
  if (memberProjectIds.length > 0) {
    pQuery = pQuery.or(`headAuditorId.eq.${userId},projectId.in.(${memberProjectIds.join(',')})`)
  } else {
    pQuery = pQuery.eq('headAuditorId', userId)
  }
  const { data: projects, error: projectsError } = await pQuery
  if (projectsError) throw projectsError
  if (!projects || projects.length === 0) return []
  const projectIds = projects.map(p => p.projectId)
  
  // 3. Fetch reports
  const { data: reports, error: reportsError } = await supabase
    .from('Audit_Report')
    .select('reportId, projectId, userId, timeGenerated')
    .in('projectId', projectIds)
  if (reportsError) throw reportsError
  if (!reports || reports.length === 0) return []
  
  const reportProjectIds = Array.from(new Set(reports.map(r => r.projectId)))
  const filteredProjects = projects.filter(p => reportProjectIds.includes(p.projectId))
  
  // Fetch head auditor names
  const headAuditorIds = Array.from(new Set(filteredProjects.map(p => p.headAuditorId)))
  const { data: users, error: usersError } = await supabase
    .from('User')
    .select('userId, userName')
    .in('userId', headAuditorIds)
  if (usersError) throw usersError
  const userNamesMap = new Map()
  for (const u of (users ?? [])) {
    userNamesMap.set(u.userId, u.userName)
  }
  
  // Fetch guideline IDs
  const { data: allGuidelines, error: guidelinesError } = await supabase
    .from('Guideline')
    .select('projectId, guidelineId')
    .in('projectId', reportProjectIds)
  if (guidelinesError) throw guidelinesError
  
  const guidelinesMap = new Map()
  for (const g of (allGuidelines ?? [])) {
    if (g.projectId) {
      const list = guidelinesMap.get(g.projectId) || []
      list.push(g.guidelineId)
      guidelinesMap.set(g.projectId, list)
    }
  }
  
  // Fetch compliance summaries
  const complianceSummary = await fetchProjectComplianceSummary(reportProjectIds)
  
  const results = []
  for (const r of reports) {
    const p = filteredProjects.find(proj => proj.projectId === r.projectId)
    if (!p) continue
    
    const headAuditorName = userNamesMap.get(p.headAuditorId) || 'Unknown'
    const guidelineIds = guidelinesMap.get(p.projectId) ?? []
    const scorePercentage = complianceSummary[p.projectId] !== undefined ? complianceSummary[p.projectId] : null
    
    results.push({
      projectId: p.projectId,
      projectTitle: p.projectTitle,
      smPlatform: p.smPlatform,
      projectStatus: p.projectStatus,
      submissionStatus: p.submissionStatus,
      submissionRemarks: p.submissionRemarks,
      headAuditorId: p.headAuditorId,
      headAuditorName,
      timeCreated: r.timeGenerated,
      updatedAt: p.updatedAt,
      dueDate: p.dueDate,
      scorePercentage,
      guidelineIds,
    })
  }
  
  let filteredResults = results
  if (filters?.projectStatusFilter) {
    filteredResults = filteredResults.filter(r => r.projectStatus === filters.projectStatusFilter)
  }
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase()
    filteredResults = filteredResults.filter(r => 
      r.projectTitle.toLowerCase().includes(searchLower) ||
      r.smPlatform.toLowerCase().includes(searchLower)
    )
  }
  if (filters?.dateFrom) {
    const fromDate = new Date(filters.dateFrom)
    filteredResults = filteredResults.filter(r => new Date(r.timeCreated) >= fromDate)
  }
  if (filters?.dateTo) {
    const toDate = new Date(filters.dateTo)
    filteredResults = filteredResults.filter(r => new Date(r.timeCreated) <= toDate)
  }
  
  return filteredResults
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



// ΓöÇΓöÇΓöÇ Users ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ



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

    itemName?: string
    itemCode?: string
    helpText?: string
    verbatimClauseText?: string
    answerOptions?: string

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

    itemName: item.itemName || null,
    itemCode: item.itemCode || null,
    helpText: item.helpText || null,
    verbatimClauseText: item.verbatimClauseText || null,
    answerOptions: item.answerOptions || null,

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



export async function createUser(input: {

  userId: string

  userName: string

  userEmail: string

  role: UserRole

  userPassword?: string

}): Promise<void> {

  const { error } = await supabase.from('User').insert({

    userId: input.userId,

    userName: input.userName,

    userEmail: input.userEmail,

    role: input.role,

    userPassword: input.userPassword

  })

  if (error) throw error

}





export async function sendAssignmentEmail(projectId: string, userId: string) {
  try {
    const { data: project, error: pError } = await supabase
      .from('Audit_Project')
      .select('projectTitle, headAuditorId')
      .eq('projectId', projectId)
      .single()
    if (pError || !project) {
      console.error('Error fetching project for email notification:', pError)
      return
    }

    const { data: user, error: uError } = await supabase
      .from('User')
      .select('userName, userEmail, role')
      .eq('userId', userId)
      .single()
    if (uError || !user) {
      console.error('Error fetching user for email notification:', uError)
      return
    }

    if (user.role !== 'auditor' || userId === project.headAuditorId) {
      return
    }

    const { data: headAuditor } = await supabase
      .from('User')
      .select('userName')
      .eq('userId', project.headAuditorId)
      .single()

    const headAuditorName = (headAuditor as any)?.userName || 'Head Auditor'
    const projectTitle = (project as any).projectTitle

    const brevoApiKey = process.env.BREVO_API_KEY || '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'
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'den519000@gmail.com'

    // For testing/mocking, route dummy emails to den519000@gmail.com so they actually deliver!
    const toEmail = user.userEmail.includes('@example.com') ? 'den519000@gmail.com' : user.userEmail

    const emailData = {
      sender: {
        name: 'SafetyAudit',
        email: senderEmail
      },
      to: [
        {
          email: toEmail,
          name: user.userName
        }
      ],
      subject: `New Project Assignment: ${projectTitle}`,
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #1e3a8a; margin-top: 0; margin-bottom: 16px;">New Project Assignment</h2>
          <p>Hello <strong>${user.userName}</strong>,</p>
          ${toEmail !== user.userEmail ? `
          <p style="font-size: 13px; color: #475569; background-color: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 16px;">
            <strong>[Sandbox Notification Redirect]</strong> This email was originally intended for: <em>${user.userEmail}</em>
          </p>
          ` : ''}
          <p>You have been assigned to the audit project <strong>"${projectTitle}"</strong> by <strong>${headAuditorName}</strong>.</p>
          <p>Please log in to the SafetyAudit platform to begin your audit tasks.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">This is an automated notification from SafetyAudit. Please do not reply directly to this email.</p>
        </div>
      `
    }

    const reqData = JSON.stringify(emailData)

    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoApiKey,
        'accept': 'application/json',
        'Content-Length': Buffer.byteLength(reqData)
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Email] Notification sent successfully via Brevo to ${toEmail} (original recipient: ${user.userEmail}) for project ${projectTitle}`)
        } else {
          console.error(`[Email] Brevo API returned status ${res.statusCode}:`, body)
        }
      })
    })

    req.on('error', (e) => {
      console.error('[Email] Error sending email via Brevo:', e)
    })

    req.write(reqData)
    req.end()

  } catch (error) {
    console.error('[Email] Failed to send assignment email:', error)
  }
}
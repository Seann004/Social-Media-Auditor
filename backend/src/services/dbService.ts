import https from 'https'
import crypto from 'crypto'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

import { supabase } from '../config/supabase.js'

import type { AuditStatus, ChecklistItemStatus, Platform, Severity, SubmissionStatus, UserRole } from '../types/index.js'




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






export async function fetchUserProjects(userId: string): Promise<DbProject[]> {
  const { data: memberRows, error: memberError } = await supabase
    .from('Project_Member')
    .select('projectId')
    .eq('userId', userId)
  if (memberError) throw memberError
  
  const memberProjectIds = (memberRows ?? []).map(r => r.projectId)
  
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
  
  const { data: allMembers, error: membersError } = await supabase
    .from('Project_Member')
    .select('projectId, userId')
    .in('projectId', projectIds)
  if (membersError) throw membersError
  
  const { data: allGuidelines, error: guidelinesError } = await supabase
    .from('Guideline')
    .select('projectId, guidelineId')
    .in('projectId', projectIds)
  if (guidelinesError) throw guidelinesError
  
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


  const { data: project, error: pError } = await supabase

    .from('Audit_Project')

    .select('*')

    .eq('projectId', projectId)

    .single()

  if (pError) throw pError




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
  await assertProjectEditable(projectId)

  const allowed: Record<string, unknown> = {}
  if (updates.projectTitle !== undefined) allowed.projectTitle = updates.projectTitle
  if (updates.smPlatform !== undefined) allowed.smPlatform = updates.smPlatform
  if (updates.projectStatus !== undefined) allowed.projectStatus = updates.projectStatus
  if (updates.projectNotes !== undefined) allowed.projectNotes = updates.projectNotes
  if (updates.dueDate !== undefined) allowed.dueDate = updates.dueDate

  const { error } = await supabase

    .from('Audit_Project')

    .update({ ...allowed, updatedAt: new Date().toISOString() })

    .eq('projectId', projectId)

  if (error) throw error

}

export async function activateProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('Audit_Project')
    .update({ projectStatus: 'in_progress', updatedAt: new Date().toISOString() })
    .eq('projectId', projectId)
    .eq('projectStatus', 'draft')
  if (error) throw error
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

  const { data: checklists, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId,projectId')
    .in('projectId', projectIds)
  if (clError) throw clError

  const checklistToProject = new Map<string, string>()
  for (const c of (checklists ?? []) as { checklistId: string; projectId: string }[]) {
    checklistToProject.set(c.checklistId, c.projectId)
  }
  const checklistIds = Array.from(checklistToProject.keys())

  const activeItemToProject = new Map<string, string>()
  const totalByProject: Record<string, number> = {}
  if (checklistIds.length > 0) {
    const { data: activeItems, error: itemsError } = await supabase
      .from('Checklist_Item')
      .select('itemId,checklistId')
      .in('checklistId', checklistIds)
      .not('category', 'like', '__deactivated__%')
    if (itemsError) throw itemsError
    for (const item of (activeItems ?? []) as { itemId: string; checklistId: string }[]) {
      const pid = checklistToProject.get(item.checklistId)
      if (!pid) continue
      activeItemToProject.set(item.itemId, pid)
      totalByProject[pid] = (totalByProject[pid] ?? 0) + 1
    }
  }

  const { data, error } = await supabase
    .from('Audit_Result')
    .select('projectId,result,itemId')
    .in('projectId', projectIds)

  if (error) throw error

  const byProjectItem = new Map<string, Map<string, string[]>>()
  for (const row of (data ?? []) as { projectId: string; result: string; itemId: string }[]) {
    if (!activeItemToProject.has(row.itemId)) continue
    if (!byProjectItem.has(row.projectId)) byProjectItem.set(row.projectId, new Map())
    const itemMap = byProjectItem.get(row.projectId)!
    if (!itemMap.has(row.itemId)) itemMap.set(row.itemId, [])
    itemMap.get(row.itemId)!.push(row.result)
  }

  const { data: resolutionRows, error: resError } = await supabase
    .from('Checklist_Resolution')
    .select('projectId, itemId, resolvedStatus')
    .in('projectId', projectIds)
  if (resError) throw resError
  const resolutionsByProjectItem = new Map<string, string>()
  for (const r of (resolutionRows ?? []) as { projectId: string; itemId: string; resolvedStatus: string }[]) {
    resolutionsByProjectItem.set(`${r.projectId}__${r.itemId}`, r.resolvedStatus)
  }

  const countsByProject = new Map<string, EffectiveScoreCounts>()
  for (const [projectId, itemMap] of byProjectItem) {
    const effectiveStatuses = Array.from(itemMap, ([itemId, statuses]) =>
      reconcileEffectiveStatus(statuses, resolutionsByProjectItem.get(`${projectId}__${itemId}`))
    )
    countsByProject.set(projectId, bucketEffectiveStatuses(effectiveStatuses))
  }

  const result: Record<string, ProjectComplianceSummary> = {}
  for (const pid of projectIds) {
    const c = countsByProject.get(pid)
    const applicable = c ? c.answered - c.notApplicable : 0
    result[pid] = {
      percentage: c && applicable > 0 ? Math.round((c.weightedCompliant / applicable) * 1000) / 10 : 0,
      answered: c?.answered ?? 0,
      total: totalByProject[pid] ?? 0,
    }
  }
  return result
}



export async function deleteProject(projectId: string): Promise<void> {

  const { error } = await supabase.from('Audit_Project').delete().eq('projectId', projectId)

  if (error) throw error

}






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
  await assertProjectEditable(projectId)

  if (userIds.length > 0) {
    const { data: validUsers, error: userError } = await supabase
      .from('User')
      .select('userId')
      .in('userId', userIds)
    if (userError) throw userError
    const validIds = new Set((validUsers ?? []).map((u: any) => u.userId))
    const missing = userIds.filter((id) => !validIds.has(id))
    if (missing.length > 0) {
      throw new Error(`Cannot sync members: unknown user id(s): ${missing.join(', ')}`)
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from('Project_Member')
    .select('userId')
    .eq('projectId', projectId)
  if (existingError) throw existingError
  const existingIds = new Set((existing ?? []).map((m: any) => m.userId))
  const nextIds = new Set(userIds)

  const toRemove = [...existingIds].filter((uid) => !nextIds.has(uid))
  const toAdd = [...nextIds].filter((uid) => !existingIds.has(uid))

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('Project_Member')
      .delete()
      .eq('projectId', projectId)
      .in('userId', toRemove)
    if (error) throw error
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('Project_Member')
      .insert(toAdd.map((userId) => ({ projectId, userId })))
    if (error) throw error
  }
}







export class GuidelineHasAnswersError extends Error {
  constructor(message = 'This guideline cannot be removed because it already has recorded answers under it.') {
    super(message)
    this.name = 'GuidelineHasAnswersError'
  }
}

export async function syncProjectGuidelines(projectId: string, globalGuidelineIds: string[]): Promise<void> {
  await assertProjectEditable(projectId)

  const { data: existingClones, error: fetchError } = await supabase
    .from('Guideline')
    .select('guidelineId, originalGuidelineId')
    .eq('projectId', projectId)
  if (fetchError) throw fetchError

  const existingClonesMap = new Map<string, string>()
  const keptClonedIds: string[] = []

  for (const clone of (existingClones ?? [])) {
    const origId = (clone as any).originalGuidelineId
    const clonedId = clone.guidelineId
    
    if (origId) {
      if (globalGuidelineIds.includes(origId)) {
        existingClonesMap.set(origId, clonedId)
        keptClonedIds.push(clonedId)
      } else {
        const { count: answeredCount, error: countError } = await supabase
          .from('Audit_Result')
          .select('resultId', { count: 'exact', head: true })
          .eq('projectId', projectId)
          .eq('guidelineId', clonedId)
        if (countError) throw countError
        if ((answeredCount ?? 0) > 0) {
          throw new GuidelineHasAnswersError()
        }
        const { error: delError } = await supabase
          .from('Guideline')
          .delete()
          .eq('guidelineId', clonedId)
        if (delError) throw delError
      }
    }
  }

  for (const globalGuidelineId of globalGuidelineIds) {
    if (!existingClonesMap.has(globalGuidelineId)) {
      const { data: globalGuideline, error: gError } = await supabase
        .from('Guideline')
        .select('*')
        .eq('guidelineId', globalGuidelineId)
        .is('projectId', null)
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

  await initializeProjectChecklists(projectId)
}

export async function syncProjectScope(projectId: string, features: string[]): Promise<void> {
  await assertProjectEditable(projectId)

  const { data: existing, error: existingError } = await supabase
    .from('Project_Scope')
    .select('id, feature')
    .eq('projectId', projectId)
  if (existingError) throw existingError

  const existingFeatures = (existing ?? []) as { id: string; feature: string }[]
  const nextFeatures = new Set(features)

  const toRemoveIds = existingFeatures.filter((f) => !nextFeatures.has(f.feature)).map((f) => f.id)
  const existingFeatureSet = new Set(existingFeatures.map((f) => f.feature))
  const toAdd = features.filter((f) => !existingFeatureSet.has(f))

  if (toRemoveIds.length > 0) {
    const { error } = await supabase.from('Project_Scope').delete().in('id', toRemoveIds)
    if (error) throw error
  }
  if (toAdd.length > 0) {
    const { error } = await supabase.from('Project_Scope').insert(toAdd.map((feature) => ({ projectId, feature })))
    if (error) throw error
  }
}






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




  


  const { data: globalChecklist, error: clError } = await supabase

    .from('Checklist')

    .select('checklistId')

    .eq('guidelineId', guidelineId)

    .is('projectId', null)

    .single()

    

  if (clError) {

    if (clError.code === 'PGRST116') return

    throw clError

  }



  const checklistId = (globalChecklist as any).checklistId




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




  const { error: ciError } = await supabase.from('Checklist_Item').delete().eq('checklistId', checklistId)

  if (ciError) throw ciError




  const { error: cdError } = await supabase.from('Checklist').delete().eq('checklistId', checklistId)

  if (cdError) throw cdError

}




export async function fetchGuidelineItems(guidelineId: string): Promise<DbChecklistItem[]> {
  const { data: clData, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId')
    .is('projectId', null)
    .eq('guidelineId', guidelineId)
    .limit(1)
    .single()

  if (clError) {
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
      const { data: cloneInfo, error: cloneError } = await supabase
        .from('Guideline')
        .select('originalGuidelineId')
        .eq('guidelineId', guidelineId)
        .single()
      if (cloneError) throw cloneError

      const originalGuidelineId = (cloneInfo as any)?.originalGuidelineId
      if (originalGuidelineId) {
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
              guidelineId,
              checklistSource: 'generator',
              timeCreated: new Date().toISOString()
            })
          if (insClError) {
            if ((insClError as any).code === '23505') continue
            throw insClError
          }

          const { data: globalItems, error: itemsError } = await supabase
            .from('Checklist_Item')
            .select('itemId,itemDescription,category,severity,reference,itemName,itemCode,rowType,helpText,verbatimClauseText,answerOptions')
            .order('itemId', { ascending: true })
            .eq('checklistId', globalChecklistId)
          if (itemsError) throw itemsError

          if (globalItems && globalItems.length > 0) {
            const newItems = globalItems.map((item: any) => ({
              itemId: crypto.randomUUID(),
              originalItemId: item.itemId,
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
  await assertProjectEditable(projectId)

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


export class EditLockedError extends Error {
  constructor(message = 'This audit is locked because it is under review or already approved.') {
    super(message)
    this.name = 'EditLockedError'
  }
}

export async function assertProjectEditable(projectId: string): Promise<void> {
  const { data, error } = await supabase
    .from('Audit_Project')
    .select('submissionStatus')
    .eq('projectId', projectId)
    .single()
  if (error) throw error
  const status = (data as any)?.submissionStatus
  if (status === 'pending_review' || status === 'approved') {
    throw new EditLockedError()
  }
}

async function resolveProjectIdForItem(itemId: string): Promise<string | null> {
  const { data: item, error } = await supabase
    .from('Checklist_Item')
    .select('checklistId')
    .eq('itemId', itemId)
    .maybeSingle()
  if (error) throw error
  if (!item) return null
  const { data: checklist, error: clError } = await supabase
    .from('Checklist')
    .select('projectId')
    .eq('checklistId', (item as any).checklistId)
    .maybeSingle()
  if (clError) throw clError
  return (checklist as any)?.projectId ?? null
}

async function resolveItemGuidelineInProject(projectId: string, itemId: string): Promise<string> {
  const { data: item, error } = await supabase
    .from('Checklist_Item')
    .select('checklistId')
    .eq('itemId', itemId)
    .maybeSingle()
  if (error) throw error
  if (item) {
    const { data: checklist, error: clError } = await supabase
      .from('Checklist')
      .select('projectId, guidelineId')
      .eq('checklistId', (item as any).checklistId)
      .maybeSingle()
    if (clError) throw clError
    if (checklist && (checklist as any).projectId === projectId) return (checklist as any).guidelineId
  }
  throw new ResultNotFoundError('This checklist item does not belong to this project.')
}

export class ResultNotFoundError extends Error {
  constructor(message = 'Answer this checklist item before attaching findings or evidence to it.') {
    super(message)
    this.name = 'ResultNotFoundError'
  }
}

export async function saveAuditFindings(projectId: string, itemId: string, userId: string, findings: string): Promise<void> {
  await assertProjectEditable(projectId)
  const { data, error } = await supabase
    .from('Audit_Result')
    .update({ findings: findings || null })
    .eq('projectId', projectId)
    .eq('itemId', itemId)
    .eq('userId', userId)
    .select('resultId')
  if (error) throw error
  if (!data || data.length === 0) throw new ResultNotFoundError()
}

export async function saveEvidenceImages(projectId: string, itemId: string, userId: string, images: { url: string; name: string }[]): Promise<void> {
  await assertProjectEditable(projectId)
  const { data, error } = await supabase
    .from('Audit_Result')
    .update({ evidenceImages: images.length > 0 ? images : [] })
    .eq('projectId', projectId)
    .eq('itemId', itemId)
    .eq('userId', userId)
    .select('resultId')
  if (error) throw error
  if (!data || data.length === 0) throw new ResultNotFoundError()
}


export async function toggleProjectChecklistCategory(projectId: string, guidelineId: string, category: string, enabled: boolean): Promise<void> {
  await assertProjectEditable(projectId)
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
    const { error: updError } = await supabase
      .from('Checklist_Item')
      .update({ category: `__deactivated__${category}` })
      .eq('checklistId', checklistId)
      .eq('category', category)

    if (updError) throw updError
  } else {
    const { data: deactivatedItems, error: deacError } = await supabase
      .from('Checklist_Item')
      .select('itemId')
      .eq('checklistId', checklistId)
      .eq('category', `__deactivated__${category}`)
    if (deacError) throw deacError

    if (deactivatedItems && deactivatedItems.length > 0) {
      const { error: restoreError } = await supabase
        .from('Checklist_Item')
        .update({ category: category })
        .eq('checklistId', checklistId)
        .eq('category', `__deactivated__${category}`)
      if (restoreError) throw restoreError
    } else {
      const { count: activeCount, error: activeError } = await supabase
        .from('Checklist_Item')
        .select('itemId', { count: 'exact', head: true })
        .eq('checklistId', checklistId)
        .eq('category', category)
      if (activeError) throw activeError
      if ((activeCount ?? 0) > 0) return

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
          originalItemId: item.itemId,
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

  const projectId = await resolveProjectIdForItem(itemId)
  if (projectId) await assertProjectEditable(projectId)

  const allowed: Record<string, unknown> = {}
  if (updates.itemDescription !== undefined) allowed.itemDescription = updates.itemDescription
  if (updates.severity !== undefined) allowed.severity = updates.severity
  if (updates.category !== undefined) allowed.category = updates.category
  if (Object.keys(allowed).length === 0) return

  const { error } = await supabase.from('Checklist_Item').update(allowed).eq('itemId', itemId)

  if (error) throw error

}



export async function deleteChecklistItem(itemId: string): Promise<void> {

  const projectId = await resolveProjectIdForItem(itemId)
  if (projectId) await assertProjectEditable(projectId)


  const { error: arError } = await supabase.from('Audit_Result').delete().eq('itemId', itemId)

  if (arError) throw arError


  const { error } = await supabase.from('Checklist_Item').delete().eq('itemId', itemId)

  if (error) throw error

}






export async function fetchAuditResults(projectId: string): Promise<DbAuditResult[]> {

  const { data, error } = await supabase

    .from('Audit_Result')

    .select('resultId,projectId,itemId,userId,guidelineId,result,notes,findings,timeSubmitted')

    .eq('projectId', projectId)

  if (error) throw error

  return (data as DbAuditResult[]) ?? []

}

export interface ItemEvidence {
  itemId: string
  userId: string
  images: { url: string; name: string }[]
}

export async function fetchEvidenceForItems(projectId: string, itemIds: string[]): Promise<ItemEvidence[]> {
  if (itemIds.length === 0) return []
  const { data, error } = await supabase
    .from('Audit_Result')
    .select('itemId, userId, evidenceImages')
    .eq('projectId', projectId)
    .in('itemId', itemIds)
  if (error) throw error
  return ((data ?? []) as { itemId: string; userId: string; evidenceImages: { url: string; name: string }[] | null }[])
    .filter((r) => r.evidenceImages && r.evidenceImages.length > 0)
    .map((r) => ({ itemId: r.itemId, userId: r.userId, images: r.evidenceImages! }))
}



export async function upsertAuditResult(
  projectId: string,
  itemId: string,
  userId: string,
  guidelineId: string,
  result: ChecklistItemStatus,
  notes: string = ''
): Promise<void> {

  await assertProjectEditable(projectId)
  guidelineId = await resolveItemGuidelineInProject(projectId, itemId)

  const { data: existing, error: existingError } = await supabase
    .from('Audit_Result')
    .select('resultId')
    .eq('projectId', projectId)
    .eq('itemId', itemId)
    .eq('userId', userId)
    .maybeSingle()
  if (existingError) throw existingError

  if (existing) {
    const { error } = await supabase
      .from('Audit_Result')
      .update({ result, notes: notes || null, guidelineId, timeSubmitted: new Date().toISOString() })
      .eq('resultId', (existing as any).resultId)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('Audit_Result')
      .insert({ projectId, itemId, userId, guidelineId, result, notes: notes || null, timeSubmitted: new Date().toISOString() })
    if (error) throw error
  }
}

export function reconcileEffectiveStatus(statuses: string[], resolvedStatus?: string): string {
  if (resolvedStatus) return resolvedStatus
  const distinct = new Set(statuses)
  return distinct.size === 1 ? statuses[0] : 'needs_review'
}

interface EffectiveScoreCounts {
  answered: number
  compliant: number
  nonCompliant: number
  notApplicable: number
  weightedCompliant: number
}

function bucketEffectiveStatuses(effectiveStatuses: Iterable<string>): EffectiveScoreCounts {
  const counts: EffectiveScoreCounts = { answered: 0, compliant: 0, nonCompliant: 0, notApplicable: 0, weightedCompliant: 0 }
  for (const effective of effectiveStatuses) {
    if (effective === 'needs_review') continue
    counts.answered++
    if (effective === 'not_applicable') counts.notApplicable++
    else if (effective === 'compliant') { counts.compliant++; counts.weightedCompliant += 1 }
    else if (effective === 'partially') { counts.nonCompliant++; counts.weightedCompliant += 0.5 }
    else if (effective === 'non_compliant') counts.nonCompliant++
  }
  return counts
}

async function fetchResolutionMap(projectId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('Checklist_Resolution')
    .select('itemId, resolvedStatus')
    .eq('projectId', projectId)
  if (error) throw error
  const map = new Map<string, string>()
  for (const r of (data ?? []) as { itemId: string; resolvedStatus: string }[]) {
    map.set(r.itemId, r.resolvedStatus)
  }
  return map
}

export async function resolveDisagreement(
  projectId: string,
  itemId: string,
  resolvedBy: string,
  resolvedStatus: ChecklistItemStatus,
  notes: string = ''
): Promise<void> {
  if (resolvedStatus === 'needs_review' || resolvedStatus === 'not_started') {
    throw new Error('A resolution must be a definitive status.')
  }
  const { data: proj, error: projError } = await supabase
    .from('Audit_Project')
    .select('submissionStatus')
    .eq('projectId', projectId)
    .single()
  if (projError) throw projError
  if ((proj as any)?.submissionStatus === 'approved') {
    throw new EditLockedError('This audit has been approved and can no longer be changed.')
  }
  await resolveItemGuidelineInProject(projectId, itemId)

  const { data: existing, error: existingError } = await supabase
    .from('Checklist_Resolution')
    .select('resolutionId')
    .eq('projectId', projectId)
    .eq('itemId', itemId)
    .maybeSingle()
  if (existingError) throw existingError

  if (existing) {
    const { error } = await supabase
      .from('Checklist_Resolution')
      .update({ resolvedBy, resolvedStatus, notes: notes || null, resolvedAt: new Date().toISOString() })
      .eq('resolutionId', (existing as any).resolutionId)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('Checklist_Resolution')
      .insert({ projectId, itemId, resolvedBy, resolvedStatus, notes: notes || null })
    if (error) throw error
  }
}

export interface DbResolution {
  itemId: string
  resolvedBy: string
  resolvedStatus: ChecklistItemStatus
  notes: string | null
  resolvedAt: string
}

export async function fetchResolutions(projectId: string): Promise<DbResolution[]> {
  const { data, error } = await supabase
    .from('Checklist_Resolution')
    .select('itemId, resolvedBy, resolvedStatus, notes, resolvedAt')
    .eq('projectId', projectId)
  if (error) throw error
  return (data ?? []) as DbResolution[]
}


const RELIABILITY_ORDER: Record<string, number> = { non_compliant: 0, partially: 1, compliant: 2 }
const RELIABILITY_CATEGORIES = 3

export interface InterRaterReliability {
  kappa: number | null
  sharedItems: number
  raterPair: [string, string] | null
}

export async function computeInterRaterReliability(projectId: string): Promise<InterRaterReliability> {
  const { data, error } = await supabase
    .from('Audit_Result')
    .select('itemId, userId, result')
    .eq('projectId', projectId)
  if (error) throw error

  const rows = (data ?? []) as { itemId: string; userId: string; result: string }[]

  const byItem = new Map<string, { userId: string; result: string }[]>()
  for (const r of rows) {
    if (!byItem.has(r.itemId)) byItem.set(r.itemId, [])
    byItem.get(r.itemId)!.push({ userId: r.userId, result: r.result })
  }

  const pairCounts = new Map<string, number>()
  for (const raters of byItem.values()) {
    const substantive = raters.filter((r) => r.result in RELIABILITY_ORDER)
    for (let i = 0; i < substantive.length; i++) {
      for (let j = i + 1; j < substantive.length; j++) {
        const pairKey = [substantive[i].userId, substantive[j].userId].sort().join('|')
        pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1)
      }
    }
  }
  if (pairCounts.size === 0) return { kappa: null, sharedItems: 0, raterPair: null }

  const [bestPairKey] = [...pairCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const [userA, userB] = bestPairKey.split('|')

  const k = RELIABILITY_CATEGORIES
  const matrix: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  let n = 0
  for (const raters of byItem.values()) {
    const a = raters.find((r) => r.userId === userA && r.result in RELIABILITY_ORDER)
    const b = raters.find((r) => r.userId === userB && r.result in RELIABILITY_ORDER)
    if (!a || !b) continue
    matrix[RELIABILITY_ORDER[a.result]][RELIABILITY_ORDER[b.result]]++
    n++
  }
  if (n === 0) return { kappa: null, sharedItems: 0, raterPair: [userA, userB] }

  const rowTotal = matrix.map((row) => row.reduce((s, v) => s + v, 0))
  const colTotal = Array.from({ length: k }, (_, j) => matrix.reduce((s, row) => s + row[j], 0))

  let weightedObserved = 0
  let weightedExpected = 0
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = Math.pow((i - j) / (k - 1), 2)
      weightedObserved += w * matrix[i][j]
      weightedExpected += w * (rowTotal[i] * colTotal[j]) / n
    }
  }
  const kappa = weightedExpected > 0 ? 1 - weightedObserved / weightedExpected : 1

  return { kappa: Math.round(kappa * 1000) / 1000, sharedItems: n, raterPair: [userA, userB] }
}




export class AlreadySubmittedError extends Error {
  constructor(message = 'This audit has already been submitted for review.') {
    super(message)
    this.name = 'AlreadySubmittedError'
  }
}

export async function submitForReview(projectId: string): Promise<void> {

  const { data: proj, error: projError } = await supabase
    .from('Audit_Project')
    .select('headAuditorId, submissionStatus')
    .eq('projectId', projectId)
    .single()
  if (projError) throw projError

  const submissionStatus = (proj as any)?.submissionStatus
  if (submissionStatus !== 'not_submitted' && submissionStatus !== 'rejected') {
    throw new AlreadySubmittedError()
  }

  const summary = await fetchProjectComplianceSummary([projectId])
  const coverage = summary[projectId]
  if (!coverage || coverage.total === 0 || coverage.answered < coverage.total) {
    throw new IncompleteCoverageError()
  }

  const { error } = await supabase

    .from('Audit_Project')

    .update({

      submissionStatus: 'pending_review',

      projectStatus: 'under_review',

      updatedAt: new Date().toISOString(),

    })

    .eq('projectId', projectId)

  if (error) throw error

  const { error: reportError } = await supabase
    .from('Audit_Report')
    .upsert({ projectId, userId: (proj as any).headAuditorId }, { onConflict: 'projectId', ignoreDuplicates: true })
  if (reportError) throw reportError

}



export class IncompleteCoverageError extends Error {
  constructor(message = 'This audit cannot be approved until every checklist item across all attached guidelines has been answered.') {
    super(message)
    this.name = 'IncompleteCoverageError'
  }
}

export async function reviewSubmission(projectId: string, approved: boolean, remarks: string): Promise<void> {

  const { data: proj, error: projError } = await supabase
    .from('Audit_Project')
    .select('headAuditorId, submissionStatus')
    .eq('projectId', projectId)
    .single()
  if (projError) throw projError
  if ((proj as any)?.submissionStatus !== 'pending_review') {
    throw new AlreadySubmittedError('This audit is not awaiting review.')
  }

  if (approved) {
    const summary = await fetchProjectComplianceSummary([projectId])
    const coverage = summary[projectId]
    if (!coverage || coverage.total === 0 || coverage.answered < coverage.total) {
      throw new IncompleteCoverageError()
    }
  }

  const { data: updated, error } = await supabase

    .from('Audit_Project')

    .update({

      submissionStatus: approved ? 'approved' : 'rejected',

      projectStatus: approved ? 'completed' : 'in_progress',

      submissionRemarks: remarks || null,

      updatedAt: new Date().toISOString(),

    })

    .eq('projectId', projectId)

    .eq('submissionStatus', 'pending_review')

    .select('projectId')

  if (error) throw error
  if (!updated || updated.length === 0) {
    throw new AlreadySubmittedError('This audit is not awaiting review.')
  }

  if (proj) {
    const { error: reportError } = await supabase
      .from('Audit_Report')
      .upsert({ projectId, userId: (proj as any).headAuditorId }, { onConflict: 'projectId', ignoreDuplicates: true })
    if (reportError) throw reportError
  }

}






export async function fetchComplianceScores(projectId: string): Promise<DbComplianceScore[]> {
  const { data: projectGuidelines, error: pgError } = await supabase
    .from('Guideline')
    .select('guidelineId')
    .eq('projectId', projectId)
  if (pgError) throw pgError

  const guidelineIds = (projectGuidelines ?? []).map((row: any) => row.guidelineId)
  if (guidelineIds.length === 0) return []

  const { data: checklists, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId,guidelineId')
    .eq('projectId', projectId)
  if (clError) throw clError

  const { data: guidelines, error: gError } = await supabase
    .from('Guideline')
    .select('guidelineId,guidelineName,shortName')
    .in('guidelineId', guidelineIds)
  if (gError) throw gError

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

  const { data: auditResults, error: arError } = await supabase
    .from('Audit_Result')
    .select('itemId,result')
    .eq('projectId', projectId)
  if (arError) throw arError

  const byItem = new Map<string, string[]>()
  for (const r of (auditResults ?? []) as { itemId: string; result: string }[]) {
    if (!byItem.has(r.itemId)) byItem.set(r.itemId, [])
    byItem.get(r.itemId)!.push(r.result)
  }
  const resolutions = await fetchResolutionMap(projectId)

  const scores: DbComplianceScore[] = []
  for (const guidelineId of guidelineIds) {
    const g = guidelines?.find((x) => x.guidelineId === guidelineId)
    const cl = checklists?.find((x) => x.guidelineId === guidelineId)
    const clId = cl?.checklistId

    const clItems = items.filter((i) => i.checklistId === clId)
    const effectiveStatuses = clItems
      .map((item) => ({ itemId: item.itemId, statuses: byItem.get(item.itemId) }))
      .filter((x): x is { itemId: string; statuses: string[] } => !!x.statuses && x.statuses.length > 0)
      .map((x) => reconcileEffectiveStatus(x.statuses, resolutions.get(x.itemId)))
    const counts = bucketEffectiveStatuses(effectiveStatuses)
    const applicable = counts.answered - counts.notApplicable
    const scorePercentage = applicable > 0 ? Math.round((counts.weightedCompliant / applicable) * 1000) / 10 : 0

    scores.push({
      scoreId: crypto.randomUUID(),
      guidelineId,
      guidelineName: g?.guidelineName || 'Guideline',
      shortName: g?.shortName || 'Guideline',
      totalItems: clItems.length,
      answeredItems: counts.answered,
      compliantItems: counts.compliant,
      nonCompliantItems: counts.nonCompliant,
      notApplicableItems: counts.notApplicable,
      weightedCompliant: counts.weightedCompliant,
      scorePercentage,
      timeCalculated: new Date().toISOString()
    })
  }

  return scores
}






export async function fetchAuditReports(
  userId: string,
  filters?: {
    projectStatusFilter?: AuditStatus
    search?: string
    dateFrom?: string
    dateTo?: string
  }
): Promise<DbAuditReport[]> {
  const { data: memberRows, error: memberError } = await supabase
    .from('Project_Member')
    .select('projectId')
    .eq('userId', userId)
  if (memberError) throw memberError
  const memberProjectIds = (memberRows ?? []).map(r => r.projectId)
  
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
  
  const { data: reportsRaw, error: reportsError } = await supabase
    .from('Audit_Report')
    .select('reportId, projectId, userId, timeGenerated')
    .in('projectId', projectIds)
  if (reportsError) throw reportsError

  const allReports: any[] = [...(reportsRaw ?? [])]

  const reportedProjectIds = new Set(allReports.map(r => r.projectId))
  const submittedStatuses = ['pending_review', 'approved', 'rejected']
  const needsBackfill = projects.filter(
    p => submittedStatuses.includes(p.submissionStatus) && !reportedProjectIds.has(p.projectId)
  )
  if (needsBackfill.length > 0) {
    const { error: backfillError } = await supabase.from('Audit_Report').upsert(
      needsBackfill.map(p => ({ projectId: p.projectId, userId: p.headAuditorId })),
      { onConflict: 'projectId', ignoreDuplicates: true }
    )
    if (backfillError) console.error('Audit_Report backfill failed:', backfillError)
    const { data: refreshed } = await supabase
      .from('Audit_Report')
      .select('reportId, projectId, userId, timeGenerated')
      .in('projectId', needsBackfill.map(p => p.projectId))
    for (const r of refreshed ?? []) allReports.push(r)
  }

  if (allReports.length === 0) return []

  const reportProjectIds = Array.from(new Set(allReports.map(r => r.projectId)))
  const filteredProjects = projects.filter(p => reportProjectIds.includes(p.projectId))
  
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
  
  const complianceSummary = await fetchProjectComplianceSummary(reportProjectIds)
  
  const results = []
  for (const r of allReports) {
    const p = filteredProjects.find(proj => proj.projectId === r.projectId)
    if (!p) continue
    
    const headAuditorName = userNamesMap.get(p.headAuditorId) || 'Unknown'
    const guidelineIds = guidelinesMap.get(p.projectId) ?? []
    const scorePercentage = complianceSummary[p.projectId]?.percentage ?? null
    
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


    const { data: validUser } = await supabase.from('User').select('userId').eq('userId', userId).single()

    if (!validUser) {

      userId = ''

    }

  }



  if (!userId) {

    const { data: userData } = await supabase.from('User').select('userId').limit(1).single()

    if (userData) {

      userId = (userData as any).userId

    }

  }




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

  try {
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

    const CHUNK_SIZE = 50;

    for (let i = 0; i < dbItems.length; i += CHUNK_SIZE) {

      const chunk = dbItems.slice(i, i + CHUNK_SIZE);

      const { error: itemError } = await supabase

        .from('Checklist_Item')

        .insert(chunk);

      if (itemError) throw itemError;

    }
  } catch (err) {
    await supabase.from('Guideline').delete().eq('guidelineId', guideline.guidelineId)
    throw err
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

    userEmail: input.userEmail.trim().toLowerCase(),

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

    const brevoApiKey = process.env.BREVO_API_KEY
    const senderEmail = process.env.BREVO_SENDER_EMAIL
    if (!brevoApiKey || !senderEmail) {
      console.warn('[Email] BREVO_API_KEY or BREVO_SENDER_EMAIL not configured, skipping assignment email.')
      return
    }

    const safeUserName = escapeHtml(user.userName)
    const safeProjectTitle = escapeHtml(projectTitle)
    const safeHeadAuditorName = escapeHtml(headAuditorName)

    const emailData = {
      sender: {
        name: 'SafetyAudit',
        email: senderEmail
      },
      to: [
        {
          email: user.userEmail,
          name: user.userName
        }
      ],
      subject: `New Project Assignment: ${projectTitle}`,
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #1e3a8a; margin-top: 0; margin-bottom: 16px;">New Project Assignment</h2>
          <p>Hello <strong>${safeUserName}</strong>,</p>
          <p>You have been assigned to the audit project <strong>"${safeProjectTitle}"</strong> by <strong>${safeHeadAuditorName}</strong>.</p>
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
          console.log(`[Email] Assignment notification sent for project ${projectTitle}`)
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
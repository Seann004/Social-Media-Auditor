import type { Request, Response, NextFunction } from 'express'
import { supabase } from '../config/supabase.js'

type AccessResult = 'not_found' | 'allowed' | 'denied'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function checkProjectAccess(projectId: string, userId: string): Promise<AccessResult> {
  if (!UUID_RE.test(projectId)) return 'not_found'
  const { data: project, error } = await supabase
    .from('Audit_Project')
    .select('headAuditorId')
    .eq('projectId', projectId)
    .maybeSingle()
  if (error) throw error
  if (!project) return 'not_found'
  if ((project as any).headAuditorId === userId) return 'allowed'

  const { data: member, error: memberError } = await supabase
    .from('Project_Member')
    .select('userId')
    .eq('projectId', projectId)
    .eq('userId', userId)
    .maybeSingle()
  if (memberError) throw memberError
  return member ? 'allowed' : 'denied'
}

export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  return (await checkProjectAccess(projectId, userId)) === 'allowed'
}

async function checkProjectOwner(projectId: string, userId: string): Promise<AccessResult> {
  if (!UUID_RE.test(projectId)) return 'not_found'
  const { data: project, error } = await supabase
    .from('Audit_Project')
    .select('headAuditorId')
    .eq('projectId', projectId)
    .maybeSingle()
  if (error) throw error
  if (!project) return 'not_found'
  return (project as any).headAuditorId === userId ? 'allowed' : 'denied'
}

export async function filterAccessibleProjectIds(userId: string, projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return []
  const { data: owned, error: ownedError } = await supabase
    .from('Audit_Project')
    .select('projectId')
    .in('projectId', projectIds)
    .eq('headAuditorId', userId)
  if (ownedError) throw ownedError

  const { data: memberOf, error: memberError } = await supabase
    .from('Project_Member')
    .select('projectId')
    .in('projectId', projectIds)
    .eq('userId', userId)
  if (memberError) throw memberError

  const accessible = new Set<string>()
  for (const p of (owned ?? []) as { projectId: string }[]) accessible.add(p.projectId)
  for (const m of (memberOf ?? []) as { projectId: string }[]) accessible.add(m.projectId)
  return projectIds.filter((id) => accessible.has(id))
}

export function requireProjectAccess(paramName: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params[paramName]
      if (!projectId) return res.status(400).json({ error: 'Project id is required' })
      const result = await checkProjectAccess(projectId, req.user!.userId)
      if (result === 'not_found') {
        return res.status(404).json({ error: 'Project not found' })
      }
      if (result === 'denied') {
        return res.status(403).json({ error: 'You do not have access to this project.' })
      }
      next()
    } catch (error) {
      console.error('Error checking project access:', error)
      res.status(500).json({ error: 'Failed to verify project access' })
    }
  }
}

export function requireProjectOwner(paramName: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = req.params[paramName]
      if (!projectId) return res.status(400).json({ error: 'Project id is required' })
      const result = await checkProjectOwner(projectId, req.user!.userId)
      if (result === 'not_found') {
        return res.status(404).json({ error: 'Project not found' })
      }
      if (result === 'denied') {
        return res.status(403).json({ error: 'Only this project\'s head auditor can do that.' })
      }
      next()
    } catch (error) {
      console.error('Error checking project ownership:', error)
      res.status(500).json({ error: 'Failed to verify project access' })
    }
  }
}

export function requireChecklistItemProjectAccess(paramName: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const itemId = req.params[paramName]
      if (!itemId) return res.status(400).json({ error: 'Item id is required' })
      if (!UUID_RE.test(itemId)) return res.status(404).json({ error: 'Checklist item not found' })

      const { data: item, error } = await supabase
        .from('Checklist_Item')
        .select('checklistId')
        .eq('itemId', itemId)
        .maybeSingle()
      if (error) throw error
      if (!item) return res.status(404).json({ error: 'Checklist item not found' })

      const { data: checklist, error: clError } = await supabase
        .from('Checklist')
        .select('projectId')
        .eq('checklistId', (item as any).checklistId)
        .maybeSingle()
      if (clError) throw clError
      const projectId = (checklist as any)?.projectId
      if (!projectId) return res.status(404).json({ error: 'Checklist item not found' })

      const allowed = await isProjectMember(projectId, req.user!.userId)
      if (!allowed) {
        return res.status(403).json({ error: 'You do not have access to this project.' })
      }
      next()
    } catch (error) {
      console.error('Error checking project access:', error)
      res.status(500).json({ error: 'Failed to verify project access' })
    }
  }
}

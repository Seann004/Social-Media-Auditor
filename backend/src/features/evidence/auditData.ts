import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabaseAdmin.js'
import type { DbAuditResult, DbChecklistItem } from '../../services/dbService.js'
import type { ChecklistItemStatus, SubmissionStatus } from '../../types/index.js'
import { buildGroups, type GroupEdge } from '../../services/mappingGroups.js'
import type { AssessItem } from './assess.js'
import type { AnswerStatus } from './types.js'

export interface AnswerRow {
  itemId: string
  userId: string
  guidelineId: string
  result: ChecklistItemStatus
  notes: string | null
  findings: string | null
}

export interface AppliedAnswer {
  itemId: string
  status: AnswerStatus
  findings: string | null
  evidenceImages: EvidenceImage[]
}

export interface EvidenceImage {
  url: string
  name: string
}

export interface ApplyAnswerInput {
  projectId: string
  itemId: string
  userId: string
  guidelineId: string
  result: AnswerStatus
  /** Notes the auditor typed and had not saved: used instead of their stored notes. */
  notes?: string
  /**
   * Findings the auditor typed and had not saved (ignored when blank). On accept they come first in the
   * merge, in place of the auditor's own stored text. On override they go to the auditor's own row only.
   */
  typedFindings?: string
  /** Accept only: used when no auditor has written findings on the item. */
  findingsIfEmpty?: string
  /** Accept only: added after the deciding auditor's own photos, on their row only, unless a row of the item already has them. */
  addImages?: EvidenceImage[]
}

export type ProjectAccess = 'head_auditor' | 'auditor'

/** Everything the evidence feature reads from, or writes to, the audit tables. */
export interface AuditData {
  listChecklistItems(projectId: string): Promise<AssessItem[]>
  listAnswers(projectId: string): Promise<AnswerRow[]>
  getPlatform(projectId: string): Promise<string>
  /** Groups of this project's checklist items that an admin linked as the same requirement. Optional: without it every item is assessed. */
  listDuplicateGroups?(projectId: string): Promise<string[][]>
  getProjectAccess(projectId: string, userId: string, role: string): Promise<ProjectAccess | null>
  getSubmissionStatus(projectId: string): Promise<SubmissionStatus | null>
  applyAnswer(input: ApplyAnswerInput): Promise<AppliedAnswer>
}

export interface AuditDb {
  fetchProjectChecklistItems(projectId: string): Promise<DbChecklistItem[]>
  fetchAuditResults(projectId: string): Promise<DbAuditResult[]>
  upsertAuditResult(
    projectId: string,
    itemId: string,
    userId: string,
    guidelineId: string,
    result: ChecklistItemStatus,
    notes?: string,
  ): Promise<unknown>
}

export interface AuditDataOptions {
  /** For tests. Defaults to the existing database service, loaded on first use. */
  db?: () => Promise<AuditDb>
  /** For tests. Defaults to the service-role client. */
  client?: () => SupabaseClient | null
}

/**
 * The database service builds its client when it is first imported, and that fails without the
 * anon key. Loading it on first use keeps a server that does not use this feature from needing it.
 */
const loadDbService = (): Promise<AuditDb> => import('../../services/dbService.js')

function adminClient(opts: AuditDataOptions): SupabaseClient {
  const client = (opts.client ?? getSupabaseAdmin)()
  if (!client) throw new Error('The Supabase service key is not configured.')
  return client
}

interface ResultRow {
  resultId: string
  userId: string
  notes: string | null
  findings: string | null
  evidenceImages: EvidenceImage[] | null
}

/** The deciding auditor's row first, then the others in a fixed order. */
function orderRows(rows: ResultRow[], userId: string): ResultRow[] {
  return [...rows].sort((a, b) => {
    if ((a.userId === userId) !== (b.userId === userId)) return a.userId === userId ? -1 : 1
    return a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0
  })
}

/** Every distinct finding, kept in order and joined by a blank line, so nobody's text is lost. */
function mergeFindings(rows: ResultRow[], fallback: string | undefined): string | null {
  const distinct = [...new Set(rows.map((r) => r.findings?.trim() ?? '').filter((f) => f !== ''))]
  if (distinct.length > 0) return distinct.join('\n\n')
  return fallback?.trim() ? fallback : null
}

/**
 * The deciding auditor's photos after an accept: their own first, then the new ones that no row of the
 * item already has (by name). Photos are shown per auditor, so no photo is ever copied between rows.
 */
function ownImagesWith(rows: ResultRow[], own: ResultRow | undefined, added: EvidenceImage[]): EvidenceImage[] {
  const existingNames = new Set(rows.flatMap((r) => r.evidenceImages ?? []).map((m) => m.name))
  const fresh = added.filter((image, i) => !existingNames.has(image.name) && added.findIndex((a) => a.name === image.name) === i)
  return [...(own?.evidenceImages ?? []), ...fresh]
}

/** Postgres: invalid text representation, as for an id that is not a uuid. Such an id matches no project. */
const INVALID_TEXT_REPRESENTATION = '22P02'

function noAccessOrThrow(error: { message: string; code?: string }): null {
  if (error.code === INVALID_TEXT_REPRESENTATION) return null
  throw new Error(`Could not check project access: ${error.message}`)
}

export function createAuditData(opts: AuditDataOptions = {}): AuditData {
  const db = () => (opts.db ?? loadDbService)()

  async function projectRow(projectId: string, columns: string, what: string): Promise<Record<string, unknown>> {
    const { data, error } = await adminClient(opts).from('Audit_Project').select(columns).eq('projectId', projectId).maybeSingle()
    if (error) throw new Error(`Could not read the project ${what}: ${error.message}`)
    if (!data) throw new Error(`The project ${what} could not be read: the project was not found.`)
    return data as unknown as Record<string, unknown>
  }

  return {
    async listChecklistItems(projectId) {
      const items = await (await db()).fetchProjectChecklistItems(projectId)
      return items.map((i) => ({
        id: i.itemId,
        guidelineId: i.guidelineId,
        category: i.category,
        name: i.itemName,
        text: i.itemDescription,
        helpText: i.helpText,
      }))
    },

    async listDuplicateGroups(projectId) {
      const client = adminClient(opts)
      const { data: checklists, error: clError } = await client.from('Checklist').select('checklistId').eq('projectId', projectId)
      if (clError) throw new Error(`Could not read the project checklists: ${clError.message}`)
      const checklistIds = ((checklists ?? []) as { checklistId: string }[]).map((c) => c.checklistId)
      if (checklistIds.length === 0) return []
      const { data: items, error: itemError } = await client
        .from('Checklist_Item')
        .select('itemId, originalItemId')
        .in('checklistId', checklistIds)
        .not('category', 'like', '__deactivated__%')
        .not('originalItemId', 'is', null)
      if (itemError) throw new Error(`Could not read the project items: ${itemError.message}`)
      const projectItemOf = new Map(((items ?? []) as { itemId: string; originalItemId: string }[]).map((i) => [i.originalItemId.toLowerCase(), i.itemId]))
      if (projectItemOf.size < 2) return []
      const { data: links, error: linkError } = await client
        .from('Item_Mapping')
        .select('itemIdA, itemIdB, relation, status')
        .in('status', ['confirmed', 'rejected'])
      if (linkError) throw new Error(`Could not read the item links: ${linkError.message}`)
      const rows = (links ?? []) as (GroupEdge & { status: string })[]
      return buildGroups(rows.filter((r) => r.status === 'confirmed' && r.relation === 'equivalent'), rows.filter((r) => r.status === 'rejected'))
        .map((group) => group.flatMap((id) => projectItemOf.get(id) ?? []))
        .filter((group) => group.length >= 2)
    },

    async listAnswers(projectId) {
      const rows = await (await db()).fetchAuditResults(projectId)
      return rows.map((r) => ({
        itemId: r.itemId,
        userId: r.userId,
        guidelineId: r.guidelineId,
        result: r.result,
        notes: r.notes,
        findings: r.findings,
      }))
    },

    async getPlatform(projectId) {
      const row = await projectRow(projectId, 'smPlatform', 'platform')
      return String(row.smPlatform ?? '')
    },

    async getProjectAccess(projectId, userId, role) {
      const client = adminClient(opts)
      if (role === 'head_auditor') {
        const { data, error } = await client
          .from('Audit_Project')
          .select('projectId')
          .eq('projectId', projectId)
          .eq('headAuditorId', userId)
          .maybeSingle()
        if (error) return noAccessOrThrow(error)
        return data ? 'head_auditor' : null
      }
      if (role === 'auditor') {
        const { data, error } = await client
          .from('Project_Member')
          .select('userId')
          .eq('projectId', projectId)
          .eq('userId', userId)
          .maybeSingle()
        if (error) return noAccessOrThrow(error)
        return data ? 'auditor' : null
      }
      return null
    },

    async getSubmissionStatus(projectId) {
      const { data, error } = await adminClient(opts)
        .from('Audit_Project')
        .select('submissionStatus')
        .eq('projectId', projectId)
        .maybeSingle()
      if (error) throw new Error(`Could not read the submission status: ${error.message}`)
      return data ? ((data as { submissionStatus: SubmissionStatus }).submissionStatus ?? null) : null
    },

    async applyAnswer(input) {
      const { projectId, itemId, userId, guidelineId, result } = input
      const client = adminClient(opts)
      const accepting = input.findingsIfEmpty !== undefined || input.addImages !== undefined

      const readRows = async (columns: string, what: string): Promise<ResultRow[]> => {
        const read = await client.from('Audit_Result').select(columns).eq('projectId', projectId).eq('itemId', itemId)
        if (read.error) throw new Error(`Could not read the ${what} for the item: ${read.error.message}`)
        return (read.data ?? []) as unknown as ResultRow[]
      }

      // The deciding auditor's notes, so the upsert does not blank them.
      const before = await readRows('resultId,userId,notes', 'notes')
      const ownBefore = before.find((r) => r.userId === userId)
      await (await db()).upsertAuditResult(projectId, itemId, userId, guidelineId, result, input.notes ?? ownBefore?.notes ?? '')

      // Read after the upsert, so anything saved while it ran is merged rather than overwritten.
      const stored = orderRows(await readRows('resultId,userId,findings,evidenceImages', 'findings and photos'), userId)
      const typed = input.typedFindings?.trim() ? input.typedFindings : undefined
      // What the auditor typed stands in for their own stored text (the box they edited showed it).
      const rows = typed === undefined ? stored : stored.map((r) => (r.userId === userId ? { ...r, findings: typed } : r))
      const own = rows.find((r) => r.userId === userId)

      const fail = (e: { message: string } | null) => {
        if (e) throw new Error(`Could not save the answer for the item: ${e.message}`)
      }
      const itemRows = () => client.from('Audit_Result').update({ result }).eq('projectId', projectId).eq('itemId', itemId)

      if (!accepting && typed !== undefined) {
        fail((await itemRows()).error)
        const mine = await client.from('Audit_Result').update({ findings: typed }).eq('projectId', projectId).eq('itemId', itemId).eq('userId', userId)
        fail(mine.error)
        return { itemId, status: result, findings: typed, evidenceImages: own?.evidenceImages ?? [] }
      }

      const ownImages = own?.evidenceImages ?? []
      if (!accepting) {
        // An empty row of the auditor's own (new, or left empty by a failed earlier try) would otherwise
        // show empty findings next to a real finding on another row. Only findings are copied, never photos.
        const findings = mergeFindings(rows, undefined)
        const ownEmpty = !own?.findings?.trim() && ownImages.length === 0
        fail((await itemRows()).error)
        if (!ownEmpty || findings === null) return { itemId, status: result, findings: own?.findings ?? null, evidenceImages: ownImages }
        const mine = await client.from('Audit_Result').update({ findings }).eq('projectId', projectId).eq('itemId', itemId).eq('userId', userId)
        fail(mine.error)
        return { itemId, status: result, findings, evidenceImages: ownImages }
      }

      const findings = mergeFindings(rows, input.findingsIfEmpty)
      const evidenceImages = ownImagesWith(rows, own, input.addImages ?? [])
      const write = await client.from('Audit_Result').update({ result, findings }).eq('projectId', projectId).eq('itemId', itemId)
      fail(write.error)
      if (evidenceImages.length > ownImages.length) {
        const mine = await client.from('Audit_Result').update({ evidenceImages }).eq('projectId', projectId).eq('itemId', itemId).eq('userId', userId)
        fail(mine.error)
      }
      return { itemId, status: result, findings, evidenceImages }
    },
  }
}

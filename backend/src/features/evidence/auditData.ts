import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabaseAdmin.js'
import type { DbAuditResult, DbChecklistItem } from '../../services/dbService.js'
import type { ChecklistItemStatus, SubmissionStatus } from '../../types/index.js'
import type { AssessItem } from './assess.js'
import type { AnswerStatus } from './types.js'

export interface AnswerRow {
  itemId: string
  userId: string
  guidelineId: string
  result: ChecklistItemStatus
  notes: string | null
  findings: string | null
  evidenceImages: { url: string; name: string }[]
}

export interface AppliedAnswer {
  itemId: string
  status: AnswerStatus
  findings: string | null
  evidenceImages: { url: string; name: string }[]
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
  /** Accept only: used when no auditor has written findings on the item. */
  findingsIfEmpty?: string
  /** Accept only: added after the photos already on the item. */
  addImages?: EvidenceImage[]
}

export type ProjectAccess = 'head_auditor' | 'auditor'

/** Everything the evidence feature reads from, or writes to, the audit tables. */
export interface AuditData {
  listChecklistItems(projectId: string): Promise<AssessItem[]>
  listAnswers(projectId: string): Promise<AnswerRow[]>
  getPlatform(projectId: string): Promise<string>
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

/** Existing photos first (once each, by link), then new ones that are not already there (by name). */
function mergeImages(rows: ResultRow[], added: EvidenceImage[]): EvidenceImage[] {
  const merged: EvidenceImage[] = []
  for (const image of rows.flatMap((r) => r.evidenceImages ?? [])) {
    if (!merged.some((m) => m.url === image.url)) merged.push(image)
  }
  const existingNames = new Set(merged.map((m) => m.name))
  for (const image of added) {
    if (existingNames.has(image.name)) continue
    existingNames.add(image.name)
    merged.push(image)
  }
  return merged
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

    async listAnswers(projectId) {
      const rows = await (await db()).fetchAuditResults(projectId)
      return rows.map((r) => ({
        itemId: r.itemId,
        userId: r.userId,
        guidelineId: r.guidelineId,
        result: r.result,
        notes: r.notes,
        findings: r.findings,
        evidenceImages: r.evidenceImages ?? [],
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
        if (error) throw new Error(`Could not check project access: ${error.message}`)
        return data ? 'head_auditor' : null
      }
      if (role === 'auditor') {
        const { data, error } = await client
          .from('Project_Member')
          .select('userId')
          .eq('projectId', projectId)
          .eq('userId', userId)
          .maybeSingle()
        if (error) throw new Error(`Could not check project access: ${error.message}`)
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

      const read = await client
        .from('Audit_Result')
        .select('resultId,userId,notes,findings,evidenceImages')
        .eq('projectId', projectId)
        .eq('itemId', itemId)
      if (read.error) throw new Error(`Could not read the answers for the item: ${read.error.message}`)
      const rows = orderRows((read.data ?? []) as unknown as ResultRow[], userId)

      // Makes sure the deciding auditor has a row, and keeps the notes they already wrote.
      const own = rows.find((r) => r.userId === userId)
      await (await db()).upsertAuditResult(projectId, itemId, userId, guidelineId, result, own?.notes ?? '')

      const findings = accepting ? mergeFindings(rows, input.findingsIfEmpty) : null
      const evidenceImages = accepting ? mergeImages(rows, input.addImages ?? []) : null
      const patch = accepting ? { result, findings, evidenceImages } : { result }

      const write = await client.from('Audit_Result').update(patch).eq('projectId', projectId).eq('itemId', itemId)
      if (write.error) throw new Error(`Could not save the answer for the item: ${write.error.message}`)

      return {
        itemId,
        status: result,
        findings: accepting ? findings : (own?.findings ?? null),
        evidenceImages: accepting ? (evidenceImages ?? []) : (own?.evidenceImages ?? []),
      }
    },
  }
}

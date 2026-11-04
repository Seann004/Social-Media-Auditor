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

/** Task 11 settles what applying an answer needs. */
export interface ApplyAnswerInput {
  projectId: string
  itemId: string
  userId: string
  guidelineId: string
  status: AnswerStatus
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

    async applyAnswer() {
      throw new Error('applyAnswer is not implemented yet (Task 11).')
    },
  }
}

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PROMPT_VERSION } from './config.js'
import type {
  EvidencePermission,
  EvidenceRepository,
  EvidenceSource,
  NewDecision,
  NewPage,
  NewPassage,
  NewRun,
  NewSuggestion,
  RunPatch,
  ScreenshotStore,
} from './repository.js'
import type {
  CapturedPage,
  Decision,
  EvidenceRun,
  PageSummary,
  Passage,
  Suggestion,
  SuggestionQuote,
} from './types.js'

const BUCKET = 'evidence-screenshots'
const ACTIVE = ['queued', 'capturing', 'assessing']
const RESULT = ['completed', 'partial']
const LIST_PAGE_SIZE = 100
const REMOVE_CHUNK = 100

interface DbResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

/** Postgres: invalid text representation, as when an id that is not a uuid is compared with a uuid column. */
const INVALID_TEXT_REPRESENTATION = '22P02'

/** Like unwrap, for a read by id: an id Postgres cannot cast cannot match a row, so it is no row. */
function unwrapById<T>(op: string, res: DbResult<T>): T | null {
  if (res.error?.code === INVALID_TEXT_REPRESENTATION) return null
  return unwrap(op, res)
}

/** Throws with the operation name when Supabase reports an error. */
function unwrap<T>(op: string, res: DbResult<T>): T | null {
  if (res.error) throw new Error(`${op}: ${res.error.message}`)
  return res.data
}

function required<T>(op: string, res: DbResult<T>): NonNullable<T> {
  const data = unwrap(op, res)
  if (data === null || data === undefined) throw new Error(`${op}: no row returned`)
  return data as NonNullable<T>
}

// Rows use the same camelCase names as our types; only nullable columns need mapping.
type Row = Record<string, any>

function toRun(row: Row): EvidenceRun {
  return {
    ...(row as EvidenceRun),
    capturedInRunId: row.capturedInRunId ?? row.id,
    promptVersion: row.promptVersion ?? '',
    unassessedCategories: row.unassessedCategories ?? [],
  }
}

function toQuote(row: Row): SuggestionQuote {
  return {
    id: row.id,
    passageId: row.passageId ?? null,
    pageId: row.pageId ?? null,
    quoteText: row.quoteText,
    verified: row.verified,
    highlightScreenshotPath: row.highlightScreenshotPath ?? null,
  }
}

function toSuggestion(row: Row, quotes: Row[]): Suggestion {
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    itemId: row.itemId,
    suggestedResult: row.suggestedResult ?? null,
    reason: row.reason,
    confidence: row.confidence,
    flags: row.flags ?? [],
    passageIdsSent: row.passageIdsSent ?? [],
    quotes: quotes.map(toQuote),
  }
}

function toPassage(row: Row): Passage {
  return { id: row.id, pageId: row.pageId, position: row.position, kind: row.kind, text: row.text }
}

export function createSupabaseRepository(admin: SupabaseClient): EvidenceRepository {
  async function latestWhere(
    op: string,
    projectId: string,
    statuses?: string[],
  ): Promise<EvidenceRun | null> {
    let q = admin.from('Evidence_Run').select('*').eq('projectId', projectId)
    if (statuses) q = q.in('status', statuses)
    const row = unwrap(op, await q.order('createdAt', { ascending: false }).limit(1).maybeSingle())
    return row ? toRun(row) : null
  }

  async function quotesFor(op: string, suggestionIds: string[]): Promise<Row[]> {
    if (suggestionIds.length === 0) return []
    return (
      unwrap(op, await admin.from('AI_Suggestion_Quote').select('*').in('suggestionId', suggestionIds)) ?? []
    )
  }

  return {
    async saveSource(projectId, startUrls, userId) {
      const row = required(
        'saveSource',
        await admin
          .from('Evidence_Source')
          .insert({ projectId, startUrls, createdBy: userId })
          .select('*')
          .single(),
      )
      return row as EvidenceSource
    },
    async getSource(projectId) {
      const row = unwrap(
        'getSource',
        await admin
          .from('Evidence_Source')
          .select('*')
          .eq('projectId', projectId)
          .order('createdAt', { ascending: false })
          .limit(1)
          .maybeSingle(),
      )
      return (row as EvidenceSource | null) ?? null
    },

    async getPermission(projectId) {
      const row = unwrap(
        'getPermission',
        await admin
          .from('Evidence_Permission')
          .select('*')
          .eq('projectId', projectId)
          .order('recordedAt', { ascending: false })
          .limit(1)
          .maybeSingle(),
      )
      return (row as EvidencePermission | null) ?? null
    },
    async setPermission(projectId, granted, note, userId) {
      const row = required(
        'setPermission',
        await admin
          .from('Evidence_Permission')
          .insert({ projectId, granted, note, recordedBy: userId })
          .select('*')
          .single(),
      )
      return row as EvidencePermission
    },

    async createRun(input: NewRun) {
      const id = randomUUID()
      const row = required(
        'createRun',
        await admin
          .from('Evidence_Run')
          .insert({
            id,
            projectId: input.projectId,
            startedBy: input.startedBy,
            scope: input.scope,
            capturedInRunId: input.capturedInRunId ?? id,
            categoriesTotal: input.categoriesTotal ?? 0,
            pagesTotal: input.pagesTotal ?? 0,
            promptVersion: PROMPT_VERSION,
          })
          .select('*')
          .single(),
      )
      return toRun(row)
    },
    async updateRun(id, patch: RunPatch) {
      const row = required(
        'updateRun',
        await admin.from('Evidence_Run').update(patch).eq('id', id).select('*').single(),
      )
      return toRun(row)
    },
    async getRun(id) {
      const row = unwrapById('getRun', await admin.from('Evidence_Run').select('*').eq('id', id).maybeSingle())
      return row ? toRun(row) : null
    },
    latestRun: (projectId) => latestWhere('latestRun', projectId),
    latestResultRun: (projectId) => latestWhere('latestResultRun', projectId, RESULT),
    async countRunsSince(projectId, iso) {
      const res = await admin
        .from('Evidence_Run')
        .select('id', { count: 'exact', head: true })
        .eq('projectId', projectId)
        .gte('createdAt', iso)
      if (res.error) throw new Error(`countRunsSince: ${res.error.message}`)
      return res.count ?? 0
    },
    activeRun: (projectId) => latestWhere('activeRun', projectId, ACTIVE),
    async markInterruptedRuns() {
      const rows = unwrap(
        'markInterruptedRuns',
        await admin
          .from('Evidence_Run')
          .update({ status: 'failed', error: 'server restarted', finishedAt: new Date().toISOString() })
          .in('status', ACTIVE)
          .select('id'),
      )
      return rows?.length ?? 0
    },

    async addPage(runId, page: NewPage) {
      const row = required(
        'addPage',
        await admin.from('Evidence_Page').insert({ ...page, runId }).select('*').single(),
      )
      return row as CapturedPage
    },
    async listPages(capturedInRunId) {
      const rows = unwrap(
        'listPages',
        await admin
          .from('Evidence_Page')
          .select('*')
          .eq('runId', capturedInRunId)
          .order('capturedAt', { ascending: true }),
      )
      return (rows ?? []) as CapturedPage[]
    },
    async listPageSummaries(capturedInRunId) {
      const rows = unwrap(
        'listPageSummaries',
        await admin
          .from('Evidence_Page')
          .select('id, url, finalUrl, httpStatus, accessStatus, accessDetail, title, screenshotPath, capturedAt')
          .eq('runId', capturedInRunId)
          .order('capturedAt', { ascending: true }),
      )
      return (rows ?? []) as PageSummary[]
    },
    async getPage(id) {
      const row = unwrapById('getPage', await admin.from('Evidence_Page').select('*').eq('id', id).maybeSingle())
      return (row as CapturedPage | null) ?? null
    },

    async addPassages(pageId, passages: NewPassage[]) {
      if (passages.length === 0) return []
      const rows = required(
        'addPassages',
        await admin
          .from('Evidence_Passage')
          .insert(passages.map((p) => ({ pageId, position: p.position, kind: p.kind, text: p.text })))
          .select('id, pageId, position, kind, text'),
      )
      return rows.map(toPassage).sort((a, b) => a.position - b.position)
    },
    async searchPassages(capturedInRunId, query, limit) {
      const rows = unwrap(
        'searchPassages',
        await admin.rpc('search_evidence_passages', {
          p_run_id: capturedInRunId,
          p_query: query,
          p_limit: limit,
        }),
      )
      return ((rows ?? []) as Row[]).map(toPassage)
    },

    async addSuggestion(input: NewSuggestion) {
      const suggestionRow: Row = required(
        'addSuggestion',
        await admin
          .from('AI_Suggestion')
          .insert({
            runId: input.runId,
            projectId: input.projectId,
            itemId: input.itemId,
            suggestedResult: input.suggestedResult,
            reason: input.reason,
            confidence: input.confidence,
            flags: input.flags,
            passageIdsSent: input.passageIdsSent,
          })
          .select('*')
          .single(),
      )
      if (input.quotes.length === 0) return toSuggestion(suggestionRow, [])

      const quoteRes = await admin
        .from('AI_Suggestion_Quote')
        .insert(input.quotes.map((q) => ({ ...q, suggestionId: suggestionRow.id })))
        .select('*')
      if (quoteRes.error || !quoteRes.data) {
        const message = quoteRes.error?.message ?? 'no rows returned'
        // No transaction in the client: remove the half-written suggestion before failing.
        const cleanup = await admin.from('AI_Suggestion').delete().eq('id', suggestionRow.id)
        if (cleanup.error) {
          console.error(`addSuggestion: could not remove suggestion ${suggestionRow.id}: ${cleanup.error.message}`)
        }
        throw new Error(`addSuggestion quotes: ${message}`)
      }
      return toSuggestion(suggestionRow, quoteRes.data)
    },
    async listSuggestions(runId) {
      const rows: Row[] =
        unwrap(
          'listSuggestions',
          await admin.from('AI_Suggestion').select('*').eq('runId', runId).order('createdAt', { ascending: true }),
        ) ?? []
      const quotes = await quotesFor('listSuggestions quotes', rows.map((r: Row) => r.id))
      return rows.map((r: Row) => toSuggestion(r, quotes.filter((q) => q.suggestionId === r.id)))
    },
    async getSuggestion(id) {
      const row: Row | null = unwrapById('getSuggestion', await admin.from('AI_Suggestion').select('*').eq('id', id).maybeSingle())
      if (!row) return null
      return toSuggestion(row, await quotesFor('getSuggestion quotes', [row.id]))
    },
    async getSuggestedResults(ids) {
      if (ids.length === 0) return {}
      const rows: Row[] = unwrap('getSuggestedResults', await admin.from('AI_Suggestion').select('id, suggestedResult').in('id', ids)) ?? []
      return Object.fromEntries(rows.map((r) => [r.id, r.suggestedResult ?? null]))
    },
    async getQuote(id) {
      const row = unwrapById(
        'getQuote',
        await admin.from('AI_Suggestion_Quote').select('*').eq('id', id).maybeSingle(),
      )
      return row ? toQuote(row) : null
    },

    async addDecision(input: NewDecision) {
      const row = required(
        'addDecision',
        await admin.from('AI_Suggestion_Decision').insert(input).select('*').single(),
      )
      return row as Decision
    },
    async listDecisions(projectId) {
      const rows = unwrap(
        'listDecisions',
        await admin
          .from('AI_Suggestion_Decision')
          .select('*')
          .eq('projectId', projectId)
          .order('decidedAt', { ascending: true }),
      )
      return (rows ?? []) as Decision[]
    },
  }
}

export function createSupabaseScreenshotStore(admin: SupabaseClient): ScreenshotStore {
  /** Storage listing is not recursive: collect files, then descend into folders. */
  async function collectFiles(prefix: string): Promise<string[]> {
    const found: string[] = []
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { data, error } = await admin.storage
        .from(BUCKET)
        .list(prefix, { limit: LIST_PAGE_SIZE, offset })
      if (error) throw new Error(`removeProject list ${prefix}: ${error.message}`)
      const entries = data ?? []
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`
        // Folders have no id and no metadata.
        if (entry.id === null || entry.id === undefined) found.push(...(await collectFiles(path)))
        else found.push(path)
      }
      if (entries.length < LIST_PAGE_SIZE) return found
    }
  }

  return {
    async upload(path, jpeg) {
      const { error } = await admin.storage
        .from(BUCKET)
        .upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error(`upload ${path}: ${error.message}`)
    },
    async signedUrl(path, seconds) {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds)
      if (error || !data) throw new Error(`signedUrl ${path}: ${error?.message ?? 'no url returned'}`)
      return data.signedUrl
    },
    async removeProject(projectId) {
      const paths = await collectFiles(projectId)
      for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
        const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + REMOVE_CHUNK))
        if (error) throw new Error(`removeProject remove: ${error.message}`)
      }
    },
  }
}

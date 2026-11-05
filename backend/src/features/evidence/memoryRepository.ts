import { randomUUID } from 'node:crypto'
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
  Passage,
  RunStatus,
  Suggestion,
  SuggestionQuote,
  SuggestionSummary,
} from './types.js'

const ACTIVE: readonly RunStatus[] = ['queued', 'capturing', 'assessing']
const RESULT: readonly RunStatus[] = ['completed', 'partial']

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with', 'do', 'does',
])

function terms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(words.filter((w) => !STOP_WORDS.has(w)))
}

const copy = <T>(v: T): T => structuredClone(v)
const last = <T>(rows: T[]): T | null => (rows.length ? rows[rows.length - 1] : null)

/** In-memory repository and screenshot store for tests. Every result is a copy. */
export function createMemoryRepository(): EvidenceRepository & ScreenshotStore {
  const sources: EvidenceSource[] = []
  const permissions: EvidencePermission[] = []
  const runs: EvidenceRun[] = []
  const pages: CapturedPage[] = []
  const passages: Passage[] = []
  const suggestions: Suggestion[] = []
  const decisions: Decision[] = []
  const files = new Map<string, Buffer>()

  const findRun = (id: string) => runs.find((r) => r.id === id)

  return {
    async saveSource(projectId, startUrls, userId) {
      const row: EvidenceSource = {
        id: randomUUID(),
        projectId,
        startUrls: [...startUrls],
        createdBy: userId,
        createdAt: new Date().toISOString(),
      }
      sources.push(row)
      return copy(row)
    },
    async getSource(projectId) {
      const row = last(sources.filter((s) => s.projectId === projectId))
      return row ? copy(row) : null
    },

    async getPermission(projectId) {
      const row = last(permissions.filter((p) => p.projectId === projectId))
      return row ? copy(row) : null
    },
    async setPermission(projectId, granted, note, userId) {
      const row: EvidencePermission = {
        id: randomUUID(),
        projectId,
        granted,
        note,
        recordedBy: userId,
        recordedAt: new Date().toISOString(),
      }
      permissions.push(row)
      return copy(row)
    },

    async createRun(input: NewRun) {
      const id = randomUUID()
      const run: EvidenceRun = {
        id,
        projectId: input.projectId,
        startedBy: input.startedBy,
        status: 'queued',
        capturedInRunId: input.capturedInRunId ?? id,
        scope: input.scope,
        unassessedCategories: [],
        categoriesTotal: input.categoriesTotal ?? 0,
        categoriesDone: 0,
        pagesTotal: input.pagesTotal ?? 0,
        pagesDone: 0,
        tokensUsed: 0,
        model: null,
        promptVersion: PROMPT_VERSION,
        error: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      }
      runs.push(run)
      return copy(run)
    },
    async updateRun(id, patch: RunPatch) {
      const index = runs.findIndex((r) => r.id === id)
      if (index < 0) throw new Error(`updateRun: run ${id} not found`)
      runs[index] = { ...runs[index], ...copy(patch) }
      return copy(runs[index])
    },
    async getRun(id) {
      const run = findRun(id)
      return run ? copy(run) : null
    },
    async latestRun(projectId) {
      const run = last(runs.filter((r) => r.projectId === projectId))
      return run ? copy(run) : null
    },
    async latestResultRun(projectId) {
      const run = last(runs.filter((r) => r.projectId === projectId && RESULT.includes(r.status)))
      return run ? copy(run) : null
    },
    async countRunsSince(projectId, iso) {
      return runs.filter((r) => r.projectId === projectId && r.createdAt >= iso).length
    },
    async activeRun(projectId) {
      const run = last(runs.filter((r) => r.projectId === projectId && ACTIVE.includes(r.status)))
      return run ? copy(run) : null
    },
    async markInterruptedRuns() {
      let count = 0
      const now = new Date().toISOString()
      runs.forEach((r, i) => {
        if (!ACTIVE.includes(r.status)) return
        runs[i] = { ...r, status: 'failed', error: 'server restarted', finishedAt: now }
        count += 1
      })
      return count
    },

    async addPage(runId, page: NewPage) {
      const row: CapturedPage = {
        ...copy(page),
        id: randomUUID(),
        runId,
        capturedAt: new Date().toISOString(),
      }
      pages.push(row)
      return copy(row)
    },
    async listPages(capturedInRunId) {
      return copy(pages.filter((p) => p.runId === capturedInRunId))
    },
    async listPageSummaries(capturedInRunId) {
      return pages
        .filter((p) => p.runId === capturedInRunId)
        .map((p) => copy({
          id: p.id,
          url: p.url,
          finalUrl: p.finalUrl,
          httpStatus: p.httpStatus,
          accessStatus: p.accessStatus,
          accessDetail: p.accessDetail,
          title: p.title,
          screenshotPath: p.screenshotPath,
          capturedAt: p.capturedAt,
        }))
    },
    async getPage(id) {
      const page = pages.find((p) => p.id === id)
      return page ? copy(page) : null
    },

    async addPassages(pageId, input: NewPassage[]) {
      const rows: Passage[] = input.map((p) => ({ id: randomUUID(), pageId, ...copy(p) }))
      passages.push(...rows)
      return copy(rows)
    },
    async searchPassages(capturedInRunId, query, limit) {
      const wanted = terms(query)
      if (wanted.size === 0 || limit <= 0) return []
      const pageIds = new Set(pages.filter((p) => p.runId === capturedInRunId).map((p) => p.id))
      const scored = passages
        .filter((p) => pageIds.has(p.pageId))
        .map((p) => {
          const have = terms(p.text)
          let score = 0
          for (const w of wanted) if (have.has(w)) score += 1
          return { p, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.p.position - b.p.position)
      return copy(scored.slice(0, limit).map((x) => x.p))
    },

    async addSuggestion(input: NewSuggestion) {
      if (suggestions.some((s) => s.runId === input.runId && s.itemId === input.itemId)) {
        throw new Error('addSuggestion: run already has a suggestion for this item')
      }
      const quotes: SuggestionQuote[] = input.quotes.map((q) => ({ id: randomUUID(), ...copy(q) }))
      const row: Suggestion = {
        id: randomUUID(),
        runId: input.runId,
        projectId: input.projectId,
        itemId: input.itemId,
        suggestedResult: input.suggestedResult,
        reason: input.reason,
        confidence: input.confidence,
        flags: copy(input.flags),
        passageIdsSent: [...input.passageIdsSent],
        originSuggestionId: input.originSuggestionId ?? null,
        quotes,
      }
      suggestions.push(row)
      return copy(row)
    },
    async listSuggestions(runId) {
      return copy(suggestions.filter((s) => s.runId === runId))
    },
    async getSuggestion(id) {
      const row = suggestions.find((s) => s.id === id)
      return row ? copy(row) : null
    },
    async getSuggestionSummaries(ids) {
      const out: Record<string, SuggestionSummary> = {}
      for (const s of suggestions) {
        if (ids.includes(s.id)) out[s.id] = { suggestedResult: s.suggestedResult, originSuggestionId: s.originSuggestionId }
      }
      return out
    },
    async getQuote(id) {
      for (const s of suggestions) {
        const quote = s.quotes.find((q) => q.id === id)
        if (quote) return copy(quote)
      }
      return null
    },

    async addDecision(input: NewDecision) {
      const row: Decision = { ...copy(input), id: randomUUID(), decidedAt: new Date().toISOString() }
      decisions.push(row)
      return copy(row)
    },
    async listDecisions(projectId) {
      return copy(decisions.filter((d) => d.projectId === projectId))
    },

    async upload(path, jpeg) {
      files.set(path, Buffer.from(jpeg))
    },
    async signedUrl(path, seconds) {
      if (!files.has(path)) throw new Error(`signedUrl: no object at ${path}`)
      return `memory://evidence-screenshots/${path}?expires=${seconds}`
    },
    async removeProject(projectId) {
      for (const path of [...files.keys()]) {
        if (path.startsWith(`${projectId}/`)) files.delete(path)
      }
    },
  }
}

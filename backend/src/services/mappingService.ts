import { supabase } from '../config/supabase.js'
import { reconcileEffectiveStatus, assertProjectEditable } from './dbService.js'
import type { ChecklistItemStatus } from '../types/index.js'

export type AskModel = (systemPrompt: string, userPrompt: string) => Promise<any>
export type MappingRelation = 'equivalent' | 'partial'
export type MappingStatus = 'suggested' | 'confirmed' | 'rejected'

export interface GlobalItem {
  itemId: string
  guidelineId: string
  guidelineName: string
  shortName: string | null
  category: string
  itemDescription: string
  itemName: string | null
  itemCode: string | null
  reference: string | null
  verbatimClauseText: string | null
}

export interface MappingRow {
  mappingId: string
  itemIdA: string
  itemIdB: string
  relation: MappingRelation
  confidence: number | null
  rationale: string | null
  status: MappingStatus
  createdAt: string
  reviewedBy: string | null
  reviewedAt: string | null
}

type EvidenceImage = { url: string; name: string }

const PAGE_SIZE = 1000
const IN_CHUNK = 100
const CANDIDATES_PER_ITEM = 5
const MIN_SIMILARITY = 0.12
const ITEMS_PER_PROMPT = 8

const DEFAULT_MAPPING_MODEL = 'openai/gpt-oss-120b'

/** Link matching has its own model setting. The default is one Groq serves today; Llama models are no longer offered to every account. */
export function resolveMappingModel(env: Record<string, string | undefined>): string {
  return env.MAPPING_GROQ_MODEL?.trim() || DEFAULT_MAPPING_MODEL
}

export class MappingNotFoundError extends Error {
  constructor(message = 'Mapping not found.') {
    super(message)
  }
}

export class SuggestionNotFoundError extends Error {
  constructor() {
    super('That suggestion is no longer available.')
  }
}

export class MappingFailedError extends Error {}

export async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

function chunk<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function fetchAllIn<T>(ids: string[], page: (ids: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (const part of chunk(ids)) {
    rows.push(...await fetchAllRows<T>((from, to) => page(part, from, to)))
  }
  return rows
}

export async function fetchGlobalItems(): Promise<GlobalItem[]> {
  const { data: checklists, error } = await supabase
    .from('Checklist')
    .select('checklistId, guidelineId, Guideline(guidelineName, shortName)')
    .is('projectId', null)
  if (error) throw error

  const byChecklist = new Map<string, { guidelineId: string; guidelineName: string; shortName: string | null }>()
  for (const c of (checklists ?? []) as any[]) {
    const g = c.Guideline
    byChecklist.set(c.checklistId, { guidelineId: c.guidelineId, guidelineName: g?.guidelineName ?? '', shortName: g?.shortName ?? null })
  }

  const items = await fetchAllIn<any>(Array.from(byChecklist.keys()), (ids, from, to) => supabase
    .from('Checklist_Item')
    .select('itemId, checklistId, category, itemDescription, itemName, itemCode, reference, verbatimClauseText')
    .in('checklistId', ids)
    .order('itemId')
    .range(from, to))

  return items.map((i) => {
    const g = byChecklist.get(i.checklistId)!
    return {
      itemId: i.itemId,
      guidelineId: g.guidelineId,
      guidelineName: g.guidelineName,
      shortName: g.shortName,
      category: i.category,
      itemDescription: i.itemDescription ?? '',
      itemName: i.itemName,
      itemCode: i.itemCode,
      reference: i.reference,
      verbatimClauseText: i.verbatimClauseText,
    }
  })
}

export async function fetchMappingRows(): Promise<MappingRow[]> {
  return fetchAllRows<MappingRow>((from, to) => supabase
    .from('Item_Mapping')
    .select('*')
    .order('mappingId')
    .range(from, to))
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'that', 'with', 'this', 'from', 'have', 'has', 'not', 'any', 'all', 'can', 'its',
  'must', 'shall', 'should', 'may', 'will', 'such', 'their', 'they', 'them', 'there', 'where', 'which', 'when',
  'into', 'been', 'being', 'does', 'other', 'than', 'also', 'more', 'each', 'whether', 'platform', 'service',
  'services', 'provider', 'providers', 'user', 'users', 'ensure', 'verify', 'check', 'appropriate', 'including',
])

function stem(word: string): string {
  if (word.length <= 4) return word
  let w = word.replace(/sses$/, 'ss').replace(/ies$/, 'y').replace(/([^s])s$/, '$1')
  if (w.length > 5) w = w.replace(/(ing|ed)$/, '')
  return w
}

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? []
  const out = new Set<string>()
  for (const w of words) {
    if (!STOP_WORDS.has(w)) out.add(stem(w))
  }
  return out
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.sqrt(a.size * b.size)
}

function itemText(item: GlobalItem): string {
  return [item.itemName, item.itemDescription, (item.verbatimClauseText ?? '').slice(0, 300)].filter(Boolean).join(' ')
}

/** The prompt's S1/C2 labels and its "source" and "candidate" words mean nothing to a reader, so say what they stand for. */
function plainReason(reason: string): string {
  const plain = reason
    .replace(/\bS\d+\b/g, 'this item')
    .replace(/\bC\d+\b/g, 'the other item')
    .replace(/\b(?:the )?source item\b/gi, 'this item')
    .replace(/\b(?:the )?candidate(?: item)?\b/gi, 'the other item')
    .trim()
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

function orderPair(x: string, y: string): [string, string] {
  const a = x.toLowerCase()
  const b = y.toLowerCase()
  return a < b ? [a, b] : [b, a]
}

const MATCH_PROMPT = `You compare requirements from different online child safety guidelines (e.g. Malaysia ONSA 2025, UK Children's Code).
Each source item comes with a few candidate items from other guidelines. Decide which candidates check the same obligation.

- "equivalent": an auditor checking one platform would give the same answer to both items.
- "partial": they overlap, but one is broader, narrower or adds extra conditions.
- Leave a candidate out if it only shares a topic. Most source items have zero or one real match.
- Only use "equivalent" when you are confident; when unsure, use "partial".
- "confidence" is a number from 0 to 1 for how sure you are that the pair really is a match. Use 0.9 or more only when the wording and scope are essentially the same, 0.5 to 0.8 when they clearly overlap but differ in scope, and below 0.5 for a weak or doubtful link. Do not give every pair the same number.
- In "reason", never mention the S1 or C2 style labels; say "this item" and "the other item" instead.

Return JSON only:
{"matches":[{"source":"S1","candidate":"C2","relation":"equivalent","confidence":0.85,"reason":"one short sentence"}]}`

/** Compares every item of one guideline with the items of all the other guidelines. New pairs are saved as "suggested" for an admin to review. */
export async function generateMappingsForGuideline(guidelineId: string, ask: AskModel) {
  const all = await fetchGlobalItems()
  const own = all.filter((i) => i.guidelineId === guidelineId)
  const others = all.filter((i) => i.guidelineId !== guidelineId)
  if (own.length === 0) throw new MappingNotFoundError('Guideline not found or it has no checklist items.')
  if (others.length === 0) return { checked: own.length, suggested: 0, failedBatches: 0 }

  const existing = new Set((await fetchMappingRows()).map((m) => `${m.itemIdA}|${m.itemIdB}`))
  const otherTokens = others.map((o) => tokenize(itemText(o)))

  const work = own
    .map((item) => {
      const t = tokenize(itemText(item))
      const candidates = others
        .map((o, idx) => ({ o, score: similarity(t, otherTokens[idx]) }))
        .filter(({ o, score }) => score >= MIN_SIMILARITY && !existing.has(orderPair(item.itemId, o.itemId).join('|')))
        .sort((a, b) => b.score - a.score)
        .slice(0, CANDIDATES_PER_ITEM)
        .map(({ o }) => o)
      return { item, candidates }
    })
    .filter((w) => w.candidates.length > 0)

  let suggested = 0
  let failedBatches = 0
  let lastError: unknown = null
  const totalBatches = Math.ceil(work.length / ITEMS_PER_PROMPT)

  for (let i = 0; i < work.length; i += ITEMS_PER_PROMPT) {
    const batch = work.slice(i, i + ITEMS_PER_PROMPT)
    const refs = new Map<string, string>()
    let candidateNo = 0

    const payload = batch.map((w, idx) => {
      const sourceRef = `S${idx + 1}`
      refs.set(sourceRef, w.item.itemId)
      return {
        source: sourceRef,
        text: w.item.itemDescription,
        clause: (w.item.verbatimClauseText ?? '').slice(0, 300),
        candidates: w.candidates.map((c) => {
          const ref = `C${++candidateNo}`
          refs.set(ref, c.itemId)
          return { candidate: ref, guideline: c.shortName || c.guidelineName, text: c.itemDescription }
        }),
      }
    })

    try {
      const parsed = await ask(MATCH_PROMPT, JSON.stringify(payload, null, 2))
      const rows = []
      const seen = new Set<string>()
      for (const m of Array.isArray(parsed?.matches) ? parsed.matches : []) {
        const source = refs.get(m?.source)
        const candidate = refs.get(m?.candidate)
        if (!source || !candidate) continue
        const allowed = batch.find((w) => w.item.itemId === source)?.candidates.some((c) => c.itemId === candidate)
        if (!allowed) continue

        const [itemIdA, itemIdB] = orderPair(source, candidate)
        const key = `${itemIdA}|${itemIdB}`
        if (seen.has(key) || existing.has(key)) continue
        seen.add(key)

        const confidence = Number(m.confidence)
        rows.push({
          itemIdA,
          itemIdB,
          relation: m.relation === 'equivalent' ? 'equivalent' : 'partial',
          confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
          rationale: typeof m.reason === 'string' ? plainReason(m.reason).slice(0, 500) : null,
          status: 'suggested',
        })
      }

      if (rows.length > 0) {
        const { data, error } = await supabase
          .from('Item_Mapping')
          .upsert(rows, { onConflict: 'itemIdA,itemIdB', ignoreDuplicates: true })
          .select('mappingId')
        if (error) throw error
        rows.forEach((r) => existing.add(`${r.itemIdA}|${r.itemIdB}`))
        suggested += data?.length ?? 0
      }
    } catch (error) {
      failedBatches++
      lastError = error
      console.error(`Mapping batch ${i / ITEMS_PER_PROMPT + 1} failed for guideline ${guidelineId}:`, error)
    }
  }

  if (totalBatches > 0 && failedBatches === totalBatches) {
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new MappingFailedError(`AI matching failed for every batch. ${reason.slice(0, 300)}`)
  }
  return { checked: own.length, suggested, failedBatches }
}

interface ProjectItem {
  itemId: string
  originalItemId: string
}

/** This project's own checklist items that point back to a library item. Switched-off categories and items the project added itself are left out. */
async function fetchProjectLibraryItems(projectId: string): Promise<ProjectItem[]> {
  const { data: checklists, error } = await supabase.from('Checklist').select('checklistId').eq('projectId', projectId)
  if (error) throw error
  const checklistIds = ((checklists ?? []) as { checklistId: string }[]).map((c) => c.checklistId)
  if (checklistIds.length === 0) return []
  return fetchAllIn<ProjectItem>(checklistIds, (ids, from, to) => supabase
    .from('Checklist_Item')
    .select('itemId, originalItemId')
    .in('checklistId', ids)
    .not('category', 'like', '__deactivated__%')
    .not('originalItemId', 'is', null)
    .order('itemId')
    .range(from, to))
}

/** The admin's decision on one pair. Only confirmed pairs are shown to auditors. */
export async function reviewMapping(mappingId: string, status: MappingStatus, relation: MappingRelation | undefined, userId: string) {
  const values: Record<string, unknown> = { status, reviewedBy: userId, reviewedAt: new Date().toISOString() }
  if (relation) values.relation = relation
  const { data, error } = await supabase
    .from('Item_Mapping')
    .update(values)
    .eq('mappingId', mappingId)
    .select('mappingId, status, relation')
  if (error) throw error
  if (!data || data.length === 0) throw new MappingNotFoundError()
  return data[0]
}

export function describeItem(item: GlobalItem | undefined) {
  if (!item) return null
  return {
    itemId: item.itemId,
    guidelineId: item.guidelineId,
    guidelineName: item.shortName || item.guidelineName,
    category: item.category,
    itemCode: item.itemCode,
    text: item.itemDescription,
    reference: item.reference,
    clause: item.verbatimClauseText,
  }
}

/** The pairs an admin approved that are both in this project, with the project's own item ids. */
export async function fetchProjectSimilarItems(projectId: string) {
  const projectItems = await fetchProjectLibraryItems(projectId)
  const projectItemByLibraryItem = new Map(projectItems.map((i) => [i.originalItemId.toLowerCase(), i.itemId]))
  if (projectItemByLibraryItem.size === 0) return []

  const [rows, items] = await Promise.all([fetchMappingRows(), fetchGlobalItems()])
  const byId = new Map(items.map((i) => [i.itemId.toLowerCase(), i]))

  return rows
    .filter((m) => m.status === 'confirmed')
    .filter((m) => projectItemByLibraryItem.has(m.itemIdA.toLowerCase()) && projectItemByLibraryItem.has(m.itemIdB.toLowerCase()))
    .map((m) => ({
      mappingId: m.mappingId,
      relation: m.relation,
      confidence: m.confidence,
      rationale: m.rationale,
      status: m.status,
      createdAt: m.createdAt,
      projectItemIdA: projectItemByLibraryItem.get(m.itemIdA.toLowerCase())!,
      projectItemIdB: projectItemByLibraryItem.get(m.itemIdB.toLowerCase())!,
      itemA: describeItem(byId.get(m.itemIdA.toLowerCase())),
      itemB: describeItem(byId.get(m.itemIdB.toLowerCase())),
    }))
    .filter((m) => m.itemA && m.itemB)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export interface AnswerSuggestion {
  itemId: string
  guidelineId: string
  suggestedStatus: ChecklistItemStatus
  relation: MappingRelation
  sourceProjectId: string
  sourceProjectTitle: string
  sourceGuideline: string
  sourceItemId: string
  sourceItemCode: string | null
  sourceItemText: string | null
  findings: string | null
  evidenceCount: number
  answeredAt: string
  otherSources: number
}

async function fetchSourceProjects(userId: string, platform: string, excludeProjectId: string): Promise<Map<string, string>> {
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.from('Audit_Project').select('projectId, projectTitle')
      .eq('headAuditorId', userId).eq('smPlatform', platform).eq('submissionStatus', 'approved'),
    supabase.from('Project_Member').select('projectId').eq('userId', userId),
  ])
  if (ownedError) throw ownedError
  if (memberError) throw memberError

  const titles = new Map<string, string>()
  for (const p of (owned ?? []) as any[]) titles.set(p.projectId, p.projectTitle)

  const memberIds = ((memberships ?? []) as any[]).map((m) => m.projectId as string).filter((pid) => !titles.has(pid))
  const memberProjects = await fetchAllIn<any>(memberIds, (ids, from, to) => supabase
    .from('Audit_Project')
    .select('projectId, projectTitle')
    .in('projectId', ids)
    .eq('smPlatform', platform)
    .eq('submissionStatus', 'approved')
    .order('projectId')
    .range(from, to))
  for (const p of memberProjects) titles.set(p.projectId, p.projectTitle)

  titles.delete(excludeProjectId)
  return titles
}

export async function fetchProjectSuggestions(projectId: string, userId: string): Promise<AnswerSuggestion[]> {
  const { data: project, error: projectError } = await supabase
    .from('Audit_Project')
    .select('smPlatform, submissionStatus, projectTitle')
    .eq('projectId', projectId)
    .single()
  if (projectError) throw projectError
  const status = (project as any).submissionStatus
  if (status === 'pending_review' || status === 'approved') return []

  const { data: checklists, error: clError } = await supabase
    .from('Checklist')
    .select('checklistId, guidelineId')
    .eq('projectId', projectId)
  if (clError) throw clError
  const guidelineByChecklist = new Map(((checklists ?? []) as any[]).map((c) => [c.checklistId as string, c.guidelineId as string]))
  if (guidelineByChecklist.size === 0) return []

  const items = await fetchAllIn<{ itemId: string; checklistId: string; originalItemId: string }>(Array.from(guidelineByChecklist.keys()), (ids, from, to) => supabase
    .from('Checklist_Item')
    .select('itemId, checklistId, originalItemId')
    .in('checklistId', ids)
    .not('category', 'like', '__deactivated__%')
    .not('originalItemId', 'is', null)
    .order('itemId')
    .range(from, to))
  if (items.length === 0) return []

  const [answeredRows, dismissedRows, mappings] = await Promise.all([
    fetchAllRows<{ itemId: string }>((from, to) => supabase
      .from('Audit_Result').select('itemId')
      .eq('projectId', projectId).eq('userId', userId)
      .order('resultId').range(from, to)),
    fetchAllRows<{ itemId: string; sourceItemId: string | null }>((from, to) => supabase
      .from('Suggestion_Decision').select('itemId, sourceItemId')
      .eq('projectId', projectId).eq('userId', userId).eq('decision', 'dismissed')
      .order('decisionId').range(from, to)),
    fetchMappingRows(),
  ])
  const answered = new Set(answeredRows.map((r) => r.itemId))
  const dismissed = new Set(dismissedRows.map((r) => `${r.itemId}|${r.sourceItemId}`))

  const links = new Map<string, { otherId: string; relation: MappingRelation }[]>()
  for (const m of mappings) {
    if (m.status !== 'confirmed') continue
    const relation = m.relation
    const a = m.itemIdA.toLowerCase()
    const b = m.itemIdB.toLowerCase()
    if (!links.has(a)) links.set(a, [])
    if (!links.has(b)) links.set(b, [])
    links.get(a)!.push({ otherId: b, relation })
    links.get(b)!.push({ otherId: a, relation })
  }

  const targets = items.filter((i) => !answered.has(i.itemId) && links.has(i.originalItemId.toLowerCase()))
  if (targets.length === 0) return []

  const titles = await fetchSourceProjects(userId, (project as any).smPlatform, projectId)
  // The project's own other guidelines are a source too, so overlapping items are answered once.
  titles.set(projectId, (project as any).projectTitle ?? '')
  const sourceProjectIds = Array.from(titles.keys())
  if (sourceProjectIds.length === 0) return []

  const sourceChecklists = await fetchAllIn<any>(sourceProjectIds, (ids, from, to) => supabase
    .from('Checklist')
    .select('checklistId, projectId, Guideline(guidelineName, shortName)')
    .in('projectId', ids)
    .order('checklistId')
    .range(from, to))
  const checklistInfo = new Map<string, { projectId: string; guideline: string }>()
  for (const c of sourceChecklists) {
    const g = c.Guideline
    checklistInfo.set(c.checklistId, { projectId: c.projectId, guideline: g?.shortName || g?.guidelineName || '' })
  }
  if (checklistInfo.size === 0) return []

  const [sourceItems, results, resolutions] = await Promise.all([
    fetchAllIn<{ itemId: string; checklistId: string; itemCode: string | null; reference: string | null; originalItemId: string; itemDescription: string | null }>(Array.from(checklistInfo.keys()), (ids, from, to) => supabase
      .from('Checklist_Item')
      .select('itemId, checklistId, itemCode, reference, originalItemId, itemDescription')
      .in('checklistId', ids)
      .not('category', 'like', '__deactivated__%')
      .not('originalItemId', 'is', null)
      .order('itemId')
      .range(from, to)),
    fetchAllIn<{ itemId: string; userId: string; result: string; findings: string | null; evidenceCount: number | null; timeSubmitted: string }>(sourceProjectIds, (ids, from, to) => supabase
      .from('Audit_Result')
      .select('itemId, userId, result, findings, evidenceCount, timeSubmitted')
      .in('projectId', ids)
      .order('resultId')
      .range(from, to)),
    fetchAllIn<{ projectId: string; itemId: string; resolvedStatus: string }>(sourceProjectIds, (ids, from, to) => supabase
      .from('Checklist_Resolution')
      .select('projectId, itemId, resolvedStatus')
      .in('projectId', ids)
      .order('resolutionId')
      .range(from, to)),
  ])

  const resultsByItem = new Map<string, typeof results>()
  for (const r of results) {
    if (!resultsByItem.has(r.itemId)) resultsByItem.set(r.itemId, [])
    resultsByItem.get(r.itemId)!.push(r)
  }
  const resolutionByItem = new Map(resolutions.map((r) => [`${r.projectId}|${r.itemId}`, r.resolvedStatus]))

  type SourceAnswer = Omit<AnswerSuggestion, 'itemId' | 'guidelineId' | 'relation' | 'otherSources'>
  const answersByOriginal = new Map<string, SourceAnswer[]>()
  for (const si of sourceItems) {
    const info = checklistInfo.get(si.checklistId)
    if (!info) continue
    // Inside the current project only the auditor's own answers count; other projects are already approved.
    const rows = (resultsByItem.get(si.itemId) ?? []).filter((r) => info.projectId !== projectId || r.userId === userId)
    if (rows.length === 0) continue

    const effective = reconcileEffectiveStatus(rows.map((r) => r.result), resolutionByItem.get(`${info.projectId}|${si.itemId}`))
    if (effective === 'needs_review' || effective === 'not_started') continue
    const agreeing = rows.filter((r) => r.result === effective)

    const original = si.originalItemId.toLowerCase()
    if (!answersByOriginal.has(original)) answersByOriginal.set(original, [])
    answersByOriginal.get(original)!.push({
      suggestedStatus: effective as ChecklistItemStatus,
      sourceProjectId: info.projectId,
      sourceProjectTitle: titles.get(info.projectId) ?? '',
      sourceGuideline: info.guideline,
      sourceItemId: si.itemId,
      sourceItemCode: si.itemCode || si.reference,
      sourceItemText: si.itemDescription ?? null,
      findings: agreeing.map((r) => r.findings).find((f) => f && f.trim()) ?? null,
      evidenceCount: agreeing.reduce((sum, r) => sum + (r.evidenceCount ?? 0), 0),
      answeredAt: rows.reduce((latest, r) => (r.timeSubmitted > latest ? r.timeSubmitted : latest), rows[0].timeSubmitted),
    })
  }

  const suggestions: AnswerSuggestion[] = []
  for (const target of targets) {
    const options = links.get(target.originalItemId.toLowerCase())!
      .flatMap((link) => (answersByOriginal.get(link.otherId) ?? []).map((a) => ({ ...a, relation: link.relation })))
      .filter((a) => !dismissed.has(`${target.itemId}|${a.sourceItemId}`))
    if (options.length === 0) continue

    options.sort((a, b) => {
      if (a.relation !== b.relation) return a.relation === 'equivalent' ? -1 : 1
      return b.answeredAt.localeCompare(a.answeredAt)
    })
    suggestions.push({
      itemId: target.itemId,
      guidelineId: guidelineByChecklist.get(target.checklistId)!,
      ...options[0],
      otherSources: options.length - 1,
    })
  }
  return suggestions
}

async function fetchSourceEvidence(suggestions: AnswerSuggestion[]): Promise<Map<string, EvidenceImage[]>> {
  const out = new Map<string, EvidenceImage[]>()
  const withEvidence = suggestions.filter((s) => s.evidenceCount > 0)
  const byProject = new Map<string, AnswerSuggestion[]>()
  for (const s of withEvidence) {
    if (!byProject.has(s.sourceProjectId)) byProject.set(s.sourceProjectId, [])
    byProject.get(s.sourceProjectId)!.push(s)
  }

  for (const [sourceProjectId, list] of byProject) {
    const statusByItem = new Map(list.map((s) => [s.sourceItemId, s.suggestedStatus]))
    const rows = await fetchAllIn<{ itemId: string; result: string; evidenceImages: EvidenceImage[] | null }>(Array.from(statusByItem.keys()), (ids, from, to) => supabase
      .from('Audit_Result')
      .select('itemId, result, evidenceImages')
      .eq('projectId', sourceProjectId)
      .in('itemId', ids)
      .gt('evidenceCount', 0)
      .order('resultId')
      .range(from, to))

    for (const r of rows) {
      if (r.result !== statusByItem.get(r.itemId)) continue
      const key = `${sourceProjectId}|${r.itemId}`
      const images = out.get(key) ?? []
      for (const img of r.evidenceImages ?? []) {
        if (!images.some((existing) => existing.url === img.url)) images.push(img)
      }
      out.set(key, images)
    }
  }
  return out
}

export interface AcceptedAnswer {
  itemId: string
  result: ChecklistItemStatus
  notes: string | null
  findings: string | null
  timeSubmitted: string
}

export async function acceptSuggestions(projectId: string, userId: string, itemIds: string[]): Promise<AcceptedAnswer[]> {
  await assertProjectEditable(projectId)
  const wanted = new Set(itemIds)
  const picked = (await fetchProjectSuggestions(projectId, userId))
    .filter((s) => wanted.has(s.itemId) && s.relation === 'equivalent')
  if (picked.length === 0) return []

  const evidence = await fetchSourceEvidence(picked)
  const now = new Date().toISOString()
  const rows = picked.map((s) => ({
    projectId,
    itemId: s.itemId,
    userId,
    guidelineId: s.guidelineId,
    result: s.suggestedStatus,
    notes: `Reused from "${s.sourceProjectTitle}" (${s.sourceGuideline}${s.sourceItemCode ? ` ${s.sourceItemCode}` : ''})`,
    findings: s.findings,
    evidenceImages: evidence.get(`${s.sourceProjectId}|${s.sourceItemId}`) ?? [],
    timeSubmitted: now,
  }))

  const { data, error } = await supabase
    .from('Audit_Result')
    .upsert(rows, { onConflict: 'projectId,itemId,userId', ignoreDuplicates: true })
    .select('itemId, result, notes, findings, timeSubmitted')
  if (error) throw error
  const inserted = (data ?? []) as AcceptedAnswer[]

  if (inserted.length > 0) {
    const bySource = new Map(picked.map((s) => [s.itemId, s]))
    const { error: decisionError } = await supabase
      .from('Suggestion_Decision')
      .insert(inserted.map((r) => ({
        projectId,
        userId,
        itemId: r.itemId,
        sourceProjectId: bySource.get(r.itemId)!.sourceProjectId,
        sourceItemId: bySource.get(r.itemId)!.sourceItemId,
        decision: 'accepted',
      })))
    if (decisionError) throw decisionError
  }
  return inserted
}

export async function dismissSuggestion(projectId: string, userId: string, itemId: string, sourceItemId: string): Promise<void> {
  await assertProjectEditable(projectId)
  const suggestion = (await fetchProjectSuggestions(projectId, userId))
    .find((s) => s.itemId === itemId && s.sourceItemId === sourceItemId)
  if (!suggestion) throw new SuggestionNotFoundError()

  const { error } = await supabase
    .from('Suggestion_Decision')
    .insert({ projectId, userId, itemId, sourceProjectId: suggestion.sourceProjectId, sourceItemId, decision: 'dismissed' })
  if (error) throw error
}

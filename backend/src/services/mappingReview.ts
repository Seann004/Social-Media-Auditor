import { supabase } from '../config/supabase.js'
import {
  describeItem,
  fetchAllIn,
  fetchAllRows,
  fetchGlobalItems,
  fetchMappingRows,
  MappingNotFoundError,
  type GlobalItem,
  type MappingRelation,
  type MappingRow,
  type MappingStatus,
} from './mappingService.js'
import { cachedRanking, invalidateMappingCache } from './mappingCache.js'
import { groupIndex, buildGroups, derivedPairs } from './mappingGroups.js'
import { buildCalibration, levelOf, MIN_DECISIONS_TO_SHOW, type Calibration, type ConfidenceLevel } from './calibration.js'

/**
 * The admin's review list. It is built for a long queue: pairs are ranked (confidence level first, then how much
 * they matter to real projects, then score), filtered and paged on the server, and only the pairs of the page
 * are described in full. Bulk decisions work on a list of ids or on everything a filter matches.
 */

export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 50
/** The most pairs one bulk decision may change. */
export const MAX_BULK_PAIRS = 5000

const IN_CHUNK = 100

export class BulkCountChangedError extends Error {
  constructor(readonly actual: number) {
    super(`The list changed: ${actual} pair${actual === 1 ? '' : 's'} match now. Reload the list and try again.`)
  }
}

export interface MappingFilter {
  status?: MappingStatus
  guidelineId?: string
  relation?: MappingRelation
  /** Only pairs whose two items are both used by at least one project. */
  inUse?: boolean
  level?: ConfidenceLevel
}

export interface MappingUsage {
  /** Projects that use the first item, the second item, and both. */
  projectsA: number
  projectsB: number
  together: number
}

interface RankedPair {
  row: MappingRow
  itemA: GlobalItem
  itemB: GlobalItem
  usage: MappingUsage
  score: number | null
  learnedConfidence: number | null
  learnedFrom: number
  level: ConfidenceLevel
  /** What approving this pair as the same requirement does to groups; null for pairs that are not same-requirement suggestions. */
  groupImpact: GroupImpact | null
}

export interface GroupImpact {
  /** Items that would become the same requirement as these two, through the group of either one. */
  joins: GlobalItem[]
  /** Two items of one guideline would end up in the group, which is often a sign the link is too wide. */
  sameGuideline: boolean
  /** Both items are already in one group, so the pair adds nothing new. */
  alreadyTogether: boolean
}

/** For each library item, the projects that use a copy of it. Items a project switched off do not count. */
export async function fetchLibraryItemUsage(): Promise<Map<string, Set<string>>> {
  const checklists = await fetchAllRows<{ checklistId: string; projectId: string }>((from, to) => supabase
    .from('Checklist')
    .select('checklistId, projectId')
    .not('projectId', 'is', null)
    .order('checklistId')
    .range(from, to))
  const projectOf = new Map(checklists.map((c) => [c.checklistId, c.projectId]))
  if (projectOf.size === 0) return new Map()

  const items = await fetchAllIn<{ checklistId: string; originalItemId: string }>(Array.from(projectOf.keys()), (ids, from, to) => supabase
    .from('Checklist_Item')
    .select('itemId, checklistId, originalItemId')
    .in('checklistId', ids)
    .not('category', 'like', '__deactivated__%')
    .not('originalItemId', 'is', null)
    .order('itemId')
    .range(from, to))

  const usage = new Map<string, Set<string>>()
  for (const item of items) {
    const projectId = projectOf.get(item.checklistId)
    if (!projectId) continue
    const key = item.originalItemId.toLowerCase()
    usage.set(key, new Set(usage.get(key) ?? []).add(projectId))
  }
  return usage
}

/**
 * A decision counts as an example of how right the AI was only when the admin made it on that pair alone. Bulk
 * decisions are left out, because approving a whole list at once says little about each pair. The relation is the
 * one the AI gave, not the one the admin may have changed it to.
 */
function isExample(row: MappingRow): boolean {
  return (row.status === 'confirmed' || row.status === 'rejected') && row.reviewMethod !== 'bulk'
}

function aiRelationOf(row: MappingRow): MappingRelation {
  return row.aiRelation ?? row.relation
}

function calibrationOf(rows: readonly MappingRow[]): Calibration {
  return buildCalibration(rows
    .filter(isExample)
    .map((r) => ({ relation: aiRelationOf(r), confidence: r.confidence, status: r.status as 'confirmed' | 'rejected' })))
}

function usageOf(row: MappingRow, usage: Map<string, Set<string>>): MappingUsage {
  const a = usage.get(row.itemIdA.toLowerCase()) ?? new Set<string>()
  const b = usage.get(row.itemIdB.toLowerCase()) ?? new Set<string>()
  let together = 0
  for (const projectId of a) if (b.has(projectId)) together++
  return { projectsA: a.size, projectsB: b.size, together }
}

function isInUse(u: MappingUsage): boolean {
  return u.projectsA > 0 && u.projectsB > 0
}

function rankAll(): Promise<{ ranked: RankedPair[]; calibration: Calibration }> {
  return cachedRanking(rankFresh)
}

async function rankFresh(): Promise<{ ranked: RankedPair[]; calibration: Calibration }> {
  const [rows, items, usage] = await Promise.all([fetchMappingRows(), fetchGlobalItems(), fetchLibraryItemUsage()])
  const byId = new Map(items.map((i) => [i.itemId.toLowerCase(), i]))
  const calibration = calibrationOf(rows)
  const groups = groupIndex(rows.filter((r) => r.status === 'confirmed'))

  const ranked: RankedPair[] = []
  for (const row of rows) {
    const itemA = byId.get(row.itemIdA.toLowerCase())
    const itemB = byId.get(row.itemIdB.toLowerCase())
    if (!itemA || !itemB) continue
    const learned = calibration.learn(aiRelationOf(row), row.confidence, isExample(row) ? (row.status as 'confirmed' | 'rejected') : undefined)
    ranked.push({
      row,
      itemA,
      itemB,
      usage: usageOf(row, usage),
      score: learned.score,
      learnedConfidence: learned.score,
      learnedFrom: learned.from,
      level: levelOf(learned.score),
      groupImpact: row.status === 'suggested' && row.relation === 'equivalent' ? impactOf(row, groups, byId) : null,
    })
  }
  return { ranked, calibration }
}

function impactOf(row: MappingRow, groups: Map<string, string[]>, byId: Map<string, GlobalItem>): GroupImpact | null {
  const a = row.itemIdA.toLowerCase()
  const b = row.itemIdB.toLowerCase()
  const groupA = groups.get(a) ?? []
  const groupB = groups.get(b) ?? []
  const members = new Set([a, b, ...groupA, ...groupB])
  const joins = Array.from(members).filter((id) => id !== a && id !== b).map((id) => byId.get(id)).filter((i): i is GlobalItem => !!i)
  const alreadyTogether = groupA.includes(b)
  if (joins.length === 0 && !alreadyTogether) return null
  const perGuideline = new Map<string, number>()
  for (const id of members) {
    const guidelineId = byId.get(id)?.guidelineId
    if (guidelineId) perGuideline.set(guidelineId, (perGuideline.get(guidelineId) ?? 0) + 1)
  }
  return { joins, sameGuideline: Array.from(perGuideline.values()).some((n) => n > 1), alreadyTogether }
}

const LEVEL_ORDER: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 }

/** Confidence level first, then pairs that matter to more projects, then the higher score, then the newer pair. */
function compareRanked(a: RankedPair, b: RankedPair): number {
  return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    || b.usage.together - a.usage.together
    || Math.min(b.usage.projectsA, b.usage.projectsB) - Math.min(a.usage.projectsA, a.usage.projectsB)
    || (b.score ?? -1) - (a.score ?? -1)
    || b.row.createdAt.localeCompare(a.row.createdAt)
}

function matchesFilter(pair: RankedPair, filter: MappingFilter, ignore: { status?: boolean; level?: boolean } = {}): boolean {
  if (!ignore.status && filter.status && pair.row.status !== filter.status) return false
  if (!ignore.level && filter.level && pair.level !== filter.level) return false
  if (filter.relation && pair.row.relation !== filter.relation) return false
  if (filter.guidelineId && pair.itemA.guidelineId !== filter.guidelineId && pair.itemB.guidelineId !== filter.guidelineId) return false
  if (filter.inUse && !isInUse(pair.usage)) return false
  return true
}

function describePair(pair: RankedPair) {
  const { row } = pair
  return {
    mappingId: row.mappingId,
    relation: row.relation,
    confidence: row.confidence,
    learnedConfidence: pair.learnedConfidence,
    learnedFrom: pair.learnedFrom,
    score: pair.score,
    level: pair.level,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    usage: pair.usage,
    groupImpact: pair.groupImpact
      ? { joins: pair.groupImpact.joins.map((i) => describeItem(i)!), sameGuideline: pair.groupImpact.sameGuideline, alreadyTogether: pair.groupImpact.alreadyTogether }
      : null,
    itemA: describeItem(pair.itemA)!,
    itemB: describeItem(pair.itemB)!,
  }
}

function countBy<T>(list: readonly T[], keys: readonly string[], keyOf: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))
  for (const item of list) out[keyOf(item)] = (out[keyOf(item)] ?? 0) + 1
  return out
}

export interface MappingPage {
  items: ReturnType<typeof describePair>[]
  /** How many pairs match the filter, across all pages. */
  total: number
  /** Pairs per status under the other filters. */
  counts: Record<MappingStatus, number>
  /** Pairs per status with no filter at all. */
  totals: Record<MappingStatus, number>
  /** Pairs per confidence level, for the chosen status and filters. */
  levels: Record<ConfidenceLevel, number>
  /** Guidelines that appear in at least one pair. */
  linkedGuidelineIds: string[]
}

const STATUSES: MappingStatus[] = ['suggested', 'confirmed', 'rejected']
const LEVELS: ConfidenceLevel[] = ['high', 'medium', 'low']

export async function listMappings(filter: MappingFilter, offset = 0, limit = DEFAULT_PAGE_SIZE): Promise<MappingPage> {
  const { ranked } = await rankAll()
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)))
  const start = Math.max(0, Math.floor(offset))

  const underOtherFilters = ranked.filter((p) => matchesFilter(p, filter, { status: true, level: true }))
  const acrossLevels = ranked.filter((p) => matchesFilter(p, { ...filter, level: undefined })).sort(compareRanked)
  // With a level, the page and the total are that one section's; the counts per level stay those of the whole list.
  const matching = filter.level ? acrossLevels.filter((p) => p.level === filter.level) : acrossLevels

  return {
    items: matching.slice(start, start + pageSize).map(describePair),
    total: matching.length,
    counts: countBy(underOtherFilters, STATUSES, (p) => p.row.status) as Record<MappingStatus, number>,
    totals: countBy(ranked, STATUSES, (p) => p.row.status) as Record<MappingStatus, number>,
    levels: countBy(acrossLevels, LEVELS, (p) => p.level) as Record<ConfidenceLevel, number>,
    linkedGuidelineIds: Array.from(new Set(ranked.flatMap((p) => [p.itemA.guidelineId, p.itemB.guidelineId]))),
  }
}

/** The ids a filter matches (the level included), in review order. */
export async function selectMappingIds(filter: MappingFilter): Promise<string[]> {
  const { ranked } = await rankAll()
  return ranked.filter((p) => matchesFilter(p, filter)).sort(compareRanked).map((p) => p.row.mappingId)
}

export interface ReviewResult {
  updated: number
}

export class PartialDecisionError extends Error {
  constructor(readonly updated: number, readonly requested: number) {
    super(`Only ${updated} of ${requested} pairs were saved before an error. Reload the list to see which.`)
  }
}

async function applyDecision(ids: string[], status: MappingStatus, relation: MappingRelation | undefined, userId: string): Promise<number> {
  const values: Record<string, unknown> = { status, reviewedBy: userId, reviewedAt: new Date().toISOString(), reviewMethod: 'bulk' }
  if (relation) values.relation = relation
  let updated = 0
  try {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from('Item_Mapping')
        .update(values)
        .in('mappingId', ids.slice(i, i + IN_CHUNK))
        .select('mappingId')
      if (error) throw error
      updated += data?.length ?? 0
    }
  } catch (error) {
    console.error('Bulk decision stopped part-way:', error)
    if (updated > 0) throw new PartialDecisionError(updated, ids.length)
    throw error
  } finally {
    invalidateMappingCache()
  }
  return updated
}

/** Decides a list of pairs at once. Ids that no longer exist are skipped and not counted. */
export async function reviewMappingsByIds(ids: string[], status: MappingStatus, relation: MappingRelation | undefined, userId: string): Promise<ReviewResult> {
  if (ids.length > MAX_BULK_PAIRS) throw new RangeError(`At most ${MAX_BULK_PAIRS} pairs can be decided at once.`)
  return { updated: await applyDecision(Array.from(new Set(ids)), status, relation, userId) }
}

/**
 * Decides everything a filter matches. `expectedCount` is what the admin saw on screen: when the list has changed
 * since, nothing is changed, so a bulk decision never covers pairs the admin did not see.
 */
export async function reviewMappingsByFilter(
  filter: MappingFilter,
  expectedCount: number,
  status: MappingStatus,
  relation: MappingRelation | undefined,
  userId: string,
): Promise<ReviewResult> {
  const ids = await selectMappingIds(filter)
  if (ids.length !== expectedCount) throw new BulkCountChangedError(ids.length)
  if (ids.length === 0) return { updated: 0 }
  return reviewMappingsByIds(ids, status, relation, userId)
}

export interface LearningSummary {
  decided: number
  approved: number
  rejected: number
  /** A group's learned score appears next to the AI's once it holds this many decisions. */
  minDecisionsToShow: number
  bands: ReturnType<typeof buildCalibration>['bands']
}

/** How well the AI's confidence has matched the admin's decisions so far. */
export async function getLearning(): Promise<LearningSummary> {
  const calibration = calibrationOf(await fetchMappingRows())
  return {
    decided: calibration.decided,
    approved: calibration.approved,
    rejected: calibration.rejected,
    minDecisionsToShow: MIN_DECISIONS_TO_SHOW,
    bands: calibration.bands,
  }
}

export { MappingNotFoundError }

export interface MappingGroup {
  /** The first item id of the group, which names it. */
  groupId: string
  items: NonNullable<ReturnType<typeof describeItem>>[]
  /** How many pairs an admin approved directly inside the group. */
  directPairs: number
  /** How every two items of the group are linked: approved by an admin, or implied through the other links. */
  links: GroupLink[]
  /** Two items of one guideline are in the group, which is often a sign a link is too wide. */
  sameGuideline: boolean
}

export interface GroupLink {
  /** Lower-case item ids of the two items. */
  itemIdA: string
  itemIdB: string
  /** False when an admin approved this pair; true when it only follows from the other links. */
  implied: boolean
}

/** Every group of items an admin approved as the same requirement, the largest first. */
export async function listGroups(): Promise<MappingGroup[]> {
  const [rows, items] = await Promise.all([fetchMappingRows(), fetchGlobalItems()])
  const confirmed = rows.filter((r) => r.status === 'confirmed' && r.relation === 'equivalent')
  const byId = new Map(items.map((i) => [i.itemId.toLowerCase(), i]))
  const direct = new Map<string, number>()
  const memberOf = new Map<string, string>()
  const groups = buildGroups(confirmed)
  for (const g of groups) for (const id of g) memberOf.set(id, g[0])
  const linksOf = new Map<string, GroupLink[]>()
  const addLink = (key: string | undefined, link: GroupLink) => {
    if (key) linksOf.set(key, [...(linksOf.get(key) ?? []), link])
  }
  for (const r of confirmed) {
    const key = memberOf.get(r.itemIdA.toLowerCase())
    if (key) direct.set(key, (direct.get(key) ?? 0) + 1)
    addLink(key, { itemIdA: r.itemIdA.toLowerCase(), itemIdB: r.itemIdB.toLowerCase(), implied: false })
  }
  for (const d of derivedPairs(confirmed)) addLink(memberOf.get(d.itemIdA), { itemIdA: d.itemIdA, itemIdB: d.itemIdB, implied: true })

  return groups.map((g) => {
    const members = g.map((id) => byId.get(id)).filter((i): i is GlobalItem => !!i)
    const perGuideline = new Map<string, number>()
    for (const m of members) perGuideline.set(m.guidelineId, (perGuideline.get(m.guidelineId) ?? 0) + 1)
    return {
      groupId: g[0],
      items: members
        .sort((x, y) => x.guidelineName.localeCompare(y.guidelineName) || (x.itemCode ?? '').localeCompare(y.itemCode ?? ''))
        .map((i) => describeItem(i)!),
      directPairs: direct.get(g[0]) ?? 0,
      links: linksOf.get(g[0]) ?? [],
      sameGuideline: Array.from(perGuideline.values()).some((n) => n > 1),
    }
  })
}

export interface PendingGroupLink {
  /** Lower-case item ids of the two items. */
  itemIdA: string
  itemIdB: string
  /** Approved by an admin, still waiting for a decision, or only following from the other links. */
  state: 'approved' | 'waiting' | 'implied'
  /** The pair to decide, for a waiting link. */
  mappingId?: string
  confidence?: number | null
}

export interface PendingGroup {
  groupId: string
  items: NonNullable<ReturnType<typeof describeItem>>[]
  links: PendingGroupLink[]
  /** The waiting links, which approving or rejecting the whole group decides. */
  waitingIds: string[]
  /** Two items of one guideline are in the group, which is often a sign a link is too wide. */
  sameGuideline: boolean
}

/**
 * Groups of three or more items that would form once the waiting same-requirement pairs are approved, together with
 * the pairs already approved. Only groups with at least one waiting link are listed, the ones with most links first.
 */
export async function listPendingGroups(): Promise<PendingGroup[]> {
  const [rows, items] = await Promise.all([fetchMappingRows(), fetchGlobalItems()])
  const edges = rows.filter((r) => r.relation === 'equivalent' && (r.status === 'confirmed' || r.status === 'suggested'))
  const byId = new Map(items.map((i) => [i.itemId.toLowerCase(), i]))

  const memberOf = new Map<string, string>()
  const groups = buildGroups(edges).filter((g) => g.length >= 3)
  for (const g of groups) for (const id of g) memberOf.set(id, g[0])

  const linksOf = new Map<string, PendingGroupLink[]>()
  const add = (key: string | undefined, link: PendingGroupLink) => { if (key) linksOf.set(key, [...(linksOf.get(key) ?? []), link]) }
  for (const r of edges) {
    const a = r.itemIdA.toLowerCase()
    const b = r.itemIdB.toLowerCase()
    add(memberOf.get(a), r.status === 'confirmed'
      ? { itemIdA: a, itemIdB: b, state: 'approved' }
      : { itemIdA: a, itemIdB: b, state: 'waiting', mappingId: r.mappingId, confidence: r.confidence })
  }
  for (const d of derivedPairs(edges)) add(memberOf.get(d.itemIdA), { itemIdA: d.itemIdA, itemIdB: d.itemIdB, state: 'implied' })

  return groups
    .map((g) => {
      const links = linksOf.get(g[0]) ?? []
      const members = g.map((id) => byId.get(id)).filter((i): i is GlobalItem => !!i)
      const perGuideline = new Map<string, number>()
      for (const m of members) perGuideline.set(m.guidelineId, (perGuideline.get(m.guidelineId) ?? 0) + 1)
      return {
        groupId: g[0],
        items: members
          .sort((x, y) => x.guidelineName.localeCompare(y.guidelineName) || (x.itemCode ?? '').localeCompare(y.itemCode ?? ''))
          .map((i) => describeItem(i)!),
        links,
        waitingIds: links.filter((l) => l.state === 'waiting').map((l) => l.mappingId!),
        sameGuideline: Array.from(perGuideline.values()).some((n) => n > 1),
      }
    })
    .filter((g) => g.waitingIds.length > 0)
}

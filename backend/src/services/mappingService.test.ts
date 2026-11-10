import { describe, it, expect, beforeEach, vi } from 'vitest'

type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
let nextId = 0

const ID_COLUMN: Record<string, string> = {
  Item_Mapping: 'mappingId',
  Suggestion_Decision: 'decisionId',
  Audit_Result: 'resultId',
}

// A small in-memory stand-in for the Supabase query builder: just the calls mappingService makes.
class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private op: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  private filters: ((r: Row) => boolean)[] = []
  private payload: any
  private opts: Row = {}
  private window: [number, number] | null = null
  private wantsOne = false

  constructor(private readonly table: string) {}

  select() { return this }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this }
  upsert(rows: Row[], opts: Row = {}) { this.op = 'upsert'; this.payload = rows; this.opts = opts; return this }
  update(values: Row) { this.op = 'update'; this.payload = values; return this }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this }
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this }
  gt(col: string, val: number) { this.filters.push((r) => r[col] > val); return this }
  not(col: string, op: string, val: unknown) {
    if (op === 'is') this.filters.push((r) => (r[col] ?? null) !== val)
    else if (op === 'like') {
      const prefix = String(val).replace(/%$/, '')
      this.filters.push((r) => !String(r[col] ?? '').startsWith(prefix))
    }
    return this
  }
  order() { return this }
  range(from: number, to: number) { this.window = [from, to]; return this }
  single() { this.wantsOne = true; return this }

  private matching() {
    const rows = (tables[this.table] ??= [])
    return rows.filter((r) => this.filters.every((f) => f(r)))
  }

  private withDefaults(row: Row): Row {
    const out = { ...row }
    const idCol = ID_COLUMN[this.table]
    if (idCol && !out[idCol]) out[idCol] = `gen-${++nextId}`
    if (this.table === 'Item_Mapping' && !out.createdAt) out.createdAt = new Date(2026, 0, nextId + 1).toISOString()
    if (this.table === 'Audit_Result') out.evidenceCount = Array.isArray(out.evidenceImages) ? out.evidenceImages.length : 0
    return out
  }

  private run(): { data: any; error: any } {
    const rows = (tables[this.table] ??= [])
    if (this.op === 'insert') {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => this.withDefaults(r))
      rows.push(...list)
      return { data: list, error: null }
    }
    if (this.op === 'upsert') {
      const keys = String(this.opts.onConflict).split(',')
      const inserted: Row[] = []
      for (const r of this.payload as Row[]) {
        const dup = rows.some((e) => keys.every((k) => e[k] === r[k]))
        if (dup && this.opts.ignoreDuplicates) continue
        const row = this.withDefaults(r)
        rows.push(row)
        inserted.push(row)
      }
      return { data: inserted, error: null }
    }
    if (this.op === 'update') {
      const hit = this.matching()
      hit.forEach((r) => Object.assign(r, this.payload))
      return { data: hit, error: null }
    }
    let hit = this.matching()
    if (this.window) hit = hit.slice(this.window[0], this.window[1] + 1)
    if (this.wantsOne) {
      return hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: { message: 'no single row' } }
    }
    return { data: hit, error: null }
  }

  then<A, B>(ok?: ((v: { data: any; error: any }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

vi.mock('../config/supabase.js', () => ({
  supabase: { from: (table: string) => new FakeQuery(table) },
}))

const mapping = await import('./mappingService.js')
const { EditLockedError } = await import('./dbService.js')

const USER = 'user-1'

function seed(extra: Partial<Record<string, Row[]>> = {}) {
  for (const k of Object.keys(tables)) delete tables[k]
  nextId = 0
  Object.assign(tables, {
    // Master guidelines: ONSA (G1) and UK Children's Code (G2)
    Checklist: [
      { checklistId: 'gc1', guidelineId: 'G1', projectId: null, Guideline: { guidelineName: 'ONSA Code', shortName: 'ONSA' } },
      { checklistId: 'gc2', guidelineId: 'G2', projectId: null, Guideline: { guidelineName: 'UK Childrens Code', shortName: 'UKCC' } },
      // project copies
      { checklistId: 'pc1', guidelineId: 'G1', projectId: 'P1', Guideline: { guidelineName: 'ONSA Code', shortName: 'ONSA' } },
      { checklistId: 'pc2', guidelineId: 'G2', projectId: 'P2', Guideline: { guidelineName: 'UK Childrens Code', shortName: 'UKCC' } },
    ],
    Checklist_Item: [
      { itemId: 'g1a', checklistId: 'gc1', category: 'Age', itemDescription: 'Age verification restricts minors from accessing adult content', itemName: null, itemCode: 'O-1', reference: null, verbatimClauseText: null },
      { itemId: 'g2a', checklistId: 'gc2', category: 'Age', itemDescription: 'Age assurance restricts children from accessing adult content', itemName: null, itemCode: 'U-1', reference: null, verbatimClauseText: null },
      { itemId: 'g2b', checklistId: 'gc2', category: 'Privacy', itemDescription: 'Geolocation sharing is switched off by default', itemName: null, itemCode: 'U-2', reference: null, verbatimClauseText: null },
      // P1 (already audited) and P2 (being audited) copies, pointing back at the master items
      { itemId: 'p1a', checklistId: 'pc1', category: 'Age', itemCode: 'O-1', reference: null, originalItemId: 'g1a' },
      { itemId: 'p2a', checklistId: 'pc2', category: 'Age', itemCode: 'U-1', reference: null, originalItemId: 'g2a' },
      { itemId: 'p2b', checklistId: 'pc2', category: 'Privacy', itemCode: 'U-2', reference: null, originalItemId: 'g2b' },
    ],
    Audit_Project: [
      { projectId: 'P1', projectTitle: 'TikTok 2025', headAuditorId: USER, smPlatform: 'tiktok', submissionStatus: 'approved' },
      { projectId: 'P2', projectTitle: 'TikTok 2026', headAuditorId: USER, smPlatform: 'tiktok', submissionStatus: 'draft' },
    ],
    Project_Member: [],
    Item_Mapping: [
      { mappingId: 'm1', itemIdA: 'g1a', itemIdB: 'g2a', relation: 'equivalent', confidence: 0.9, rationale: 'same', status: 'confirmed', createdAt: '2026-01-01T00:00:00Z' },
    ],
    Audit_Result: [
      {
        resultId: 'r1', projectId: 'P1', itemId: 'p1a', userId: USER, result: 'compliant', findings: 'Age gate seen at sign-up',
        evidenceImages: [{ url: 'https://x/e1.png', name: 'e1.png' }], evidenceCount: 1, timeSubmitted: '2026-03-01T00:00:00Z',
      },
    ],
    Checklist_Resolution: [],
    Suggestion_Decision: [],
    ...extra,
  })
}

beforeEach(() => {
  seed()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Answers every source item with the first candidate whose text mentions "age assurance".
function askMatchingAge(relation = 'equivalent', confidence: unknown = 0.9) {
  return vi.fn(async (_system: string, user: string) => {
    const payload = JSON.parse(user) as { source: string; candidates: { candidate: string; text: string }[] }[]
    const matches = payload.flatMap((p) => p.candidates
      .filter((c) => /age assurance/i.test(c.text))
      .map((c) => ({ source: p.source, candidate: c.candidate, relation, confidence, reason: 'same duty' })))
    return { matches }
  })
}

describe('generateMappingsForGuideline', () => {
  beforeEach(() => { tables.Item_Mapping = [] })

  it('stores an AI match as a suggested, ordered pair', async () => {
    const result = await mapping.generateMappingsForGuideline('G1', askMatchingAge())
    expect(result).toEqual({ checked: 1, suggested: 1, failedBatches: 0 })
    expect(tables.Item_Mapping).toHaveLength(1)
    expect(tables.Item_Mapping[0]).toMatchObject({ itemIdA: 'g1a', itemIdB: 'g2a', relation: 'equivalent', status: 'suggested', confidence: 0.9 })
  })

  it('only offers the model candidates that share vocabulary with the item', async () => {
    const ask = askMatchingAge()
    await mapping.generateMappingsForGuideline('G1', ask)
    const sent = JSON.parse(ask.mock.calls[0][1]) as { candidates: { text: string }[] }[]
    const texts = sent.flatMap((p) => p.candidates.map((c) => c.text))
    expect(texts).toContain('Age assurance restricts children from accessing adult content')
    expect(texts).not.toContain('Geolocation sharing is switched off by default')
  })

  it('does not ask again about a pair that is already linked', async () => {
    await mapping.generateMappingsForGuideline('G1', askMatchingAge())
    const ask = askMatchingAge()
    const second = await mapping.generateMappingsForGuideline('G1', ask)
    expect(ask).not.toHaveBeenCalled()
    expect(second.suggested).toBe(0)
    expect(tables.Item_Mapping).toHaveLength(1)
  })

  it('keeps a rejected link rejected instead of suggesting it again', async () => {
    tables.Item_Mapping = [{ mappingId: 'm9', itemIdA: 'g1a', itemIdB: 'g2a', relation: 'partial', status: 'rejected', createdAt: '2026-01-01T00:00:00Z' }]
    const ask = askMatchingAge()
    await mapping.generateMappingsForGuideline('G1', ask)
    expect(ask).not.toHaveBeenCalled()
    expect(tables.Item_Mapping[0].status).toBe('rejected')
  })

  it('ignores invented references and candidates that were never offered', async () => {
    const ask = vi.fn(async () => ({ matches: [
      { source: 'S9', candidate: 'C1', relation: 'equivalent', confidence: 1 },
      { source: 'S1', candidate: 'C99', relation: 'equivalent', confidence: 1 },
      { source: 'S1', candidate: 'S1', relation: 'equivalent', confidence: 1 },
      null,
    ] }))
    const result = await mapping.generateMappingsForGuideline('G1', ask)
    expect(result.suggested).toBe(0)
    expect(tables.Item_Mapping).toHaveLength(0)
  })

  it('treats an unknown relation as partial and clamps confidence into 0..1', async () => {
    await mapping.generateMappingsForGuideline('G1', askMatchingAge('identical', 7))
    expect(tables.Item_Mapping[0]).toMatchObject({ relation: 'partial', confidence: 1 })
  })

  it('stores a missing confidence as null', async () => {
    await mapping.generateMappingsForGuideline('G1', askMatchingAge('equivalent', 'high'))
    expect(tables.Item_Mapping[0].confidence).toBeNull()
  })

  it('throws MappingFailedError when every batch fails', async () => {
    const ask = vi.fn(async () => { throw new Error('Groq down') })
    await expect(mapping.generateMappingsForGuideline('G1', ask)).rejects.toThrow(mapping.MappingFailedError)
  })

  it('treats a reply with no matches list as no matches', async () => {
    const result = await mapping.generateMappingsForGuideline('G1', async () => ({}))
    expect(result).toEqual({ checked: 1, suggested: 0, failedBatches: 0 })
  })

  it('throws MappingNotFoundError for an unknown guideline', async () => {
    await expect(mapping.generateMappingsForGuideline('nope', askMatchingAge())).rejects.toThrow(mapping.MappingNotFoundError)
  })

  it('returns zero suggestions when there is no other guideline to compare with', async () => {
    tables.Checklist = tables.Checklist.filter((c) => c.guidelineId !== 'G2')
    const ask = askMatchingAge()
    expect(await mapping.generateMappingsForGuideline('G1', ask)).toEqual({ checked: 1, suggested: 0, failedBatches: 0 })
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('reviewMapping', () => {
  it('records the reviewer and can change the relation', async () => {
    await mapping.reviewMapping('m1', 'confirmed', 'partial', 'admin-1')
    expect(tables.Item_Mapping[0]).toMatchObject({ status: 'confirmed', relation: 'partial', reviewedBy: 'admin-1' })
  })

  it('throws MappingNotFoundError for an unknown mapping', async () => {
    await expect(mapping.reviewMapping('zzz', 'rejected', undefined, 'admin-1')).rejects.toThrow(mapping.MappingNotFoundError)
  })
})

describe('fetchProjectSuggestions', () => {
  it('suggests the answer from an approved earlier project through a confirmed link', async () => {
    const out = await mapping.fetchProjectSuggestions('P2', USER)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      itemId: 'p2a', suggestedStatus: 'compliant', relation: 'equivalent', sourceProjectId: 'P1',
      sourceProjectTitle: 'TikTok 2025', sourceItemId: 'p1a', findings: 'Age gate seen at sign-up', evidenceCount: 1, otherSources: 0,
    })
  })

  it('suggests nothing for items with no link', async () => {
    const ids = (await mapping.fetchProjectSuggestions('P2', USER)).map((s) => s.itemId)
    expect(ids).not.toContain('p2b')
  })

  it('ignores links that are still awaiting review or were rejected', async () => {
    for (const status of ['suggested', 'rejected']) {
      tables.Item_Mapping[0].status = status
      expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
    }
  })

  it('suggests nothing once the project is submitted for review', async () => {
    tables.Audit_Project[1].submissionStatus = 'pending_review'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('does not overwrite an item the auditor has already answered', async () => {
    tables.Audit_Result.push({ resultId: 'r2', projectId: 'P2', itemId: 'p2a', userId: USER, result: 'non_compliant', evidenceCount: 0, timeSubmitted: '2026-04-01T00:00:00Z' })
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('only draws from approved projects on the same platform', async () => {
    tables.Audit_Project[0].submissionStatus = 'draft'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
    tables.Audit_Project[0].submissionStatus = 'approved'
    tables.Audit_Project[0].smPlatform = 'instagram'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('does not draw from projects the auditor has no part in', async () => {
    tables.Audit_Project[0].headAuditorId = 'someone-else'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
    tables.Project_Member.push({ projectId: 'P1', userId: USER })
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toHaveLength(1)
  })

  it('skips a source answer whose auditors disagreed and nobody resolved', async () => {
    tables.Audit_Result.push({ resultId: 'r3', projectId: 'P1', itemId: 'p1a', userId: 'user-2', result: 'non_compliant', evidenceCount: 0, timeSubmitted: '2026-03-02T00:00:00Z' })
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('uses the resolved status when auditors disagreed and it was resolved', async () => {
    tables.Audit_Result.push({ resultId: 'r3', projectId: 'P1', itemId: 'p1a', userId: 'user-2', result: 'non_compliant', evidenceCount: 0, timeSubmitted: '2026-03-02T00:00:00Z' })
    tables.Checklist_Resolution.push({ resolutionId: 'x', projectId: 'P1', itemId: 'p1a', resolvedStatus: 'partially' })
    const out = await mapping.fetchProjectSuggestions('P2', USER)
    expect(out[0].suggestedStatus).toBe('partially')
  })

  it('leaves out deactivated items', async () => {
    tables.Checklist_Item.find((i) => i.itemId === 'p2a')!.category = '__deactivated__Age'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('does not bring back a suggestion the auditor dismissed', async () => {
    tables.Suggestion_Decision.push({ decisionId: 'd', projectId: 'P2', userId: USER, itemId: 'p2a', sourceItemId: 'p1a', decision: 'dismissed' })
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('prefers an equivalent source over a partial one and counts the rest', async () => {
    tables.Checklist.push({ checklistId: 'pc3', guidelineId: 'G1', projectId: 'P3', Guideline: { guidelineName: 'ONSA Code', shortName: 'ONSA' } })
    tables.Checklist_Item.push({ itemId: 'p3a', checklistId: 'pc3', category: 'Age', itemCode: 'O-1', reference: null, originalItemId: 'g1b' })
    tables.Checklist_Item.push({ itemId: 'g1b', checklistId: 'gc1', category: 'Age', itemDescription: 'Age limits are stated', itemName: null, itemCode: 'O-9', reference: null, verbatimClauseText: null })
    tables.Audit_Project.push({ projectId: 'P3', projectTitle: 'TikTok 2024', headAuditorId: USER, smPlatform: 'tiktok', submissionStatus: 'approved' })
    tables.Item_Mapping.push({ mappingId: 'm2', itemIdA: 'g1b', itemIdB: 'g2a', relation: 'partial', status: 'confirmed', createdAt: '2026-01-02T00:00:00Z' })
    tables.Audit_Result.push({ resultId: 'r4', projectId: 'P3', itemId: 'p3a', userId: USER, result: 'non_compliant', evidenceCount: 0, timeSubmitted: '2026-05-01T00:00:00Z' })

    const out = await mapping.fetchProjectSuggestions('P2', USER)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ relation: 'equivalent', sourceProjectId: 'P1', suggestedStatus: 'compliant', otherSources: 1 })
  })
})

describe('acceptSuggestions', () => {
  it('copies status, findings and evidence from the source and records the decision', async () => {
    const accepted = await mapping.acceptSuggestions('P2', USER, ['p2a'])
    expect(accepted.map((a) => a.itemId)).toEqual(['p2a'])

    const saved = tables.Audit_Result.find((r) => r.projectId === 'P2' && r.itemId === 'p2a')!
    expect(saved).toMatchObject({ userId: USER, guidelineId: 'G2', result: 'compliant', findings: 'Age gate seen at sign-up' })
    expect(saved.evidenceImages).toEqual([{ url: 'https://x/e1.png', name: 'e1.png' }])
    expect(saved.notes).toBe('Reused from "TikTok 2025" (ONSA O-1)')
    expect(tables.Suggestion_Decision).toEqual([
      expect.objectContaining({ projectId: 'P2', itemId: 'p2a', sourceItemId: 'p1a', sourceProjectId: 'P1', decision: 'accepted' }),
    ])
  })

  it('never accepts a partial link in bulk', async () => {
    tables.Item_Mapping[0].relation = 'partial'
    expect(await mapping.acceptSuggestions('P2', USER, ['p2a'])).toEqual([])
    expect(tables.Audit_Result.filter((r) => r.projectId === 'P2')).toHaveLength(0)
  })

  it('ignores item ids that have no suggestion', async () => {
    expect(await mapping.acceptSuggestions('P2', USER, ['p2b', 'unknown'])).toEqual([])
  })

  it('does not overwrite an answer saved after the suggestions were shown', async () => {
    tables.Audit_Result.push({ resultId: 'r5', projectId: 'P2', itemId: 'p2a', userId: USER, result: 'non_compliant', evidenceCount: 0, timeSubmitted: '2026-04-01T00:00:00Z' })
    expect(await mapping.acceptSuggestions('P2', USER, ['p2a'])).toEqual([])
    expect(tables.Audit_Result.find((r) => r.resultId === 'r5')!.result).toBe('non_compliant')
    expect(tables.Suggestion_Decision).toHaveLength(0)
  })

  it('refuses once the project is locked for review', async () => {
    tables.Audit_Project[1].submissionStatus = 'pending_review'
    await expect(mapping.acceptSuggestions('P2', USER, ['p2a'])).rejects.toThrow(EditLockedError)
  })
})

describe('dismissSuggestion', () => {
  it('records the dismissal and the suggestion no longer appears', async () => {
    await mapping.dismissSuggestion('P2', USER, 'p2a', 'p1a')
    expect(tables.Suggestion_Decision[0]).toMatchObject({ itemId: 'p2a', sourceItemId: 'p1a', decision: 'dismissed' })
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('throws SuggestionNotFoundError for a suggestion that does not exist', async () => {
    await expect(mapping.dismissSuggestion('P2', USER, 'p2b', 'p1a')).rejects.toThrow(mapping.SuggestionNotFoundError)
  })
})

// ---------------------------------------------------------------------------
// Links limited to the guidelines a project actually uses
// ---------------------------------------------------------------------------

const G3_TEXT = 'Age assurance for teenagers is proportionate to the risk'

function addThirdGuideline() {
  tables.Checklist.push({ checklistId: 'gc3', guidelineId: 'G3', projectId: null, Guideline: { guidelineName: 'EDPB Audit', shortName: 'EDPB' } })
  tables.Checklist_Item.push({ itemId: 'g3a', checklistId: 'gc3', category: 'Age', itemDescription: G3_TEXT, itemName: null, itemCode: 'E-1', reference: null, verbatimClauseText: null })
}

function attachGuidelines(projectId: string, masterIds: string[]) {
  tables.Guideline = [
    ...(tables.Guideline ?? []).filter((g) => g.projectId !== projectId),
    ...masterIds.map((originalGuidelineId) => ({ guidelineId: `clone-${projectId}-${originalGuidelineId}`, projectId, originalGuidelineId })),
  ]
}

function candidateTexts(ask: ReturnType<typeof askMatchingAge>): string[] {
  return ask.mock.calls.flatMap(([, user]) => (JSON.parse(user) as { candidates: { text: string }[] }[]).flatMap((p) => p.candidates.map((c) => c.text)))
}

describe('generateMappingsForGuideline with a scope', () => {
  beforeEach(() => { tables.Item_Mapping = [] })

  it('compares only against the guidelines it is told to', async () => {
    addThirdGuideline()
    const ask = askMatchingAge()
    await mapping.generateMappingsForGuideline('G1', ask, ['G2'])
    const texts = candidateTexts(ask)
    expect(texts).toContain('Age assurance restricts children from accessing adult content')
    expect(texts).not.toContain(G3_TEXT)
    expect(tables.Item_Mapping.map((m) => `${m.itemIdA}|${m.itemIdB}`)).toEqual(['g1a|g2a'])
  })

  it('returns zero suggestions when the scope holds no other guideline', async () => {
    const ask = askMatchingAge()
    expect(await mapping.generateMappingsForGuideline('G1', ask, [])).toEqual({ checked: 1, suggested: 0, failedBatches: 0 })
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('generateMappingsForProject', () => {
  beforeEach(() => { tables.Item_Mapping = [] })

  it('links the items of the guidelines assigned to the project, and nothing else', async () => {
    addThirdGuideline()
    attachGuidelines('P2', ['G1', 'G2'])
    const ask = askMatchingAge()
    const result = await mapping.generateMappingsForProject('P2', ask)
    expect(result.suggested).toBe(1)
    expect(candidateTexts(ask)).not.toContain(G3_TEXT)
    expect(tables.Item_Mapping.map((m) => `${m.itemIdA}|${m.itemIdB}`)).toEqual(['g1a|g2a'])
  })

  it('does not call the AI when the project has a single guideline', async () => {
    attachGuidelines('P2', ['G2'])
    const ask = askMatchingAge()
    expect(await mapping.generateMappingsForProject('P2', ask)).toEqual({ checked: 0, suggested: 0, failedBatches: 0 })
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not ask again about pairs that were already linked', async () => {
    attachGuidelines('P2', ['G1', 'G2'])
    await mapping.generateMappingsForProject('P2', askMatchingAge())
    const ask = askMatchingAge()
    const second = await mapping.generateMappingsForProject('P2', ask)
    expect(ask).not.toHaveBeenCalled()
    expect(second.suggested).toBe(0)
  })

  it('throws MappingFailedError when the AI fails for every guideline', async () => {
    attachGuidelines('P2', ['G1', 'G2'])
    const ask = vi.fn(async () => { throw new Error('Groq down') })
    await expect(mapping.generateMappingsForProject('P2', ask)).rejects.toThrow(mapping.MappingFailedError)
  })
})

describe('fetchProjectMappings', () => {
  it('returns links between the project guidelines', async () => {
    attachGuidelines('P2', ['G1', 'G2'])
    const out = await mapping.fetchProjectMappings('P2')
    expect(out.map((m) => m.mappingId)).toEqual(['m1'])
  })

  it('leaves out links that involve a guideline the project does not use', async () => {
    addThirdGuideline()
    attachGuidelines('P2', ['G2', 'G3'])
    expect(await mapping.fetchProjectMappings('P2')).toEqual([])
  })
})

describe('reviewProjectMapping', () => {
  it('lets a project confirm a link between its own guidelines', async () => {
    attachGuidelines('P2', ['G1', 'G2'])
    tables.Item_Mapping[0].status = 'suggested'
    await mapping.reviewProjectMapping('P2', 'm1', 'confirmed', 'equivalent', 'head-1')
    expect(tables.Item_Mapping[0]).toMatchObject({ status: 'confirmed', relation: 'equivalent', reviewedBy: 'head-1' })
  })

  it('refuses a link that belongs to guidelines outside the project', async () => {
    addThirdGuideline()
    attachGuidelines('P2', ['G2', 'G3'])
    tables.Item_Mapping[0].status = 'suggested'
    await expect(mapping.reviewProjectMapping('P2', 'm1', 'confirmed', undefined, 'head-1')).rejects.toThrow(mapping.MappingNotFoundError)
    expect(tables.Item_Mapping[0].status).toBe('suggested')
  })
})

describe('fetchProjectSuggestions inside the same project', () => {
  // The project itself holds both guidelines; no earlier approved project exists.
  beforeEach(() => {
    tables.Audit_Project[0].submissionStatus = 'draft'
    tables.Checklist.push({ checklistId: 'pc2b', guidelineId: 'G1', projectId: 'P2', Guideline: { guidelineName: 'ONSA Code', shortName: 'ONSA' } })
    tables.Checklist_Item.push({ itemId: 'p2c', checklistId: 'pc2b', category: 'Age', itemCode: 'O-1', reference: null, originalItemId: 'g1a' })
    tables.Audit_Result.push({ resultId: 'r7', projectId: 'P2', itemId: 'p2c', userId: USER, result: 'non_compliant', findings: 'No age gate', evidenceCount: 0, timeSubmitted: '2026-05-02T00:00:00Z' })
  })

  it('suggests the answer given to the linked item of another guideline in the same project', async () => {
    const out = await mapping.fetchProjectSuggestions('P2', USER)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ itemId: 'p2a', suggestedStatus: 'non_compliant', relation: 'equivalent', sourceProjectId: 'P2', sourceItemId: 'p2c', findings: 'No age gate' })
  })

  it('only uses answers the same auditor gave', async () => {
    tables.Audit_Result.find((r) => r.resultId === 'r7')!.userId = 'user-2'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
  })

  it('can be accepted like any other suggestion', async () => {
    const accepted = await mapping.acceptSuggestions('P2', USER, ['p2a'])
    expect(accepted.map((a) => a.itemId)).toEqual(['p2a'])
    expect(tables.Audit_Result.find((r) => r.projectId === 'P2' && r.itemId === 'p2a')).toMatchObject({ result: 'non_compliant', findings: 'No age gate' })
  })
})

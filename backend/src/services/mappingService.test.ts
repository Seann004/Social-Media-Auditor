import { describe, it, expect, beforeEach, vi } from 'vitest'

import { tables, resetTables, supabase as fakeSupabase } from '../test/fakeSupabase.js'

vi.mock('../config/supabase.js', async () => {
  const fake = await import('../test/fakeSupabase.js')
  return { supabase: fake.supabase }
})

type Row = Record<string, any>
void fakeSupabase

const mapping = await import('./mappingService.js')
const { EditLockedError } = await import('./dbService.js')

const USER = 'user-1'

function seed(extra: Partial<Record<string, Row[]>> = {}) {
  resetTables({
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
      { itemId: 'p1a', checklistId: 'pc1', category: 'Age', itemCode: 'O-1', reference: null, originalItemId: 'g1a', itemDescription: 'Age verification restricts minors' },
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

  it('turns the prompt\'s internal labels in the AI\'s reason into plain words', async () => {
    const ask = vi.fn(async (_system: string, user: string) => {
      const payload = JSON.parse(user) as { source: string; candidates: { candidate: string; text: string }[] }[]
      const c = payload[0].candidates.find((x) => /age assurance/i.test(x.text))!
      return { matches: [{ source: payload[0].source, candidate: c.candidate, relation: 'equivalent', confidence: 0.8, reason: `${c.candidate} focuses on risk while ${payload[0].source} asks about certainty.` }] }
    })
    await mapping.generateMappingsForGuideline('G1', ask)
    const reason = tables.Item_Mapping[0].rationale as string
    expect(reason).toBe('The other item focuses on risk while this item asks about certainty.')
    expect(reason).not.toMatch(/\b[SC]\d+\b/)
  })

  it("also turns 'the source item' and 'the candidate' into plain words, and starts the sentence with a capital", async () => {
    const ask = vi.fn(async (_system: string, user: string) => {
      const payload = JSON.parse(user) as { source: string; candidates: { candidate: string; text: string }[] }[]
      const c = payload[0].candidates.find((x) => /age assurance/i.test(x.text))!
      return { matches: [{ source: payload[0].source, candidate: c.candidate, relation: 'partial', confidence: 0.6, reason: 'the source item asks for visibility while the candidate only asks for policies.' }] }
    })
    await mapping.generateMappingsForGuideline('G1', ask)
    expect(tables.Item_Mapping[0].rationale).toBe('This item asks for visibility while the other item only asks for policies.')
  })

  it('tells the model not to use the labels in its reason', async () => {
    const ask = askMatchingAge()
    await mapping.generateMappingsForGuideline('G1', ask)
    expect(ask.mock.calls[0][0]).toMatch(/do not mention the S1|never mention .*S1/i)
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

describe('resolveMappingModel', () => {
  it('uses a model Groq currently serves by default', () => {
    expect(mapping.resolveMappingModel({})).toBe('openai/gpt-oss-120b')
  })

  it('does not follow GROQ_MODEL, which the other prompts use', () => {
    expect(mapping.resolveMappingModel({ GROQ_MODEL: 'llama-3.1-8b-instant' })).toBe('openai/gpt-oss-120b')
  })

  it('uses MAPPING_GROQ_MODEL when it is set, ignoring blanks around it', () => {
    expect(mapping.resolveMappingModel({ MAPPING_GROQ_MODEL: '  openai/gpt-oss-120b ' })).toBe('openai/gpt-oss-120b')
    expect(mapping.resolveMappingModel({ MAPPING_GROQ_MODEL: '   ' })).toBe('openai/gpt-oss-120b')
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

  it('offers answers only through links the admin approved', async () => {
    tables.Item_Mapping[0].status = 'suggested'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
    tables.Item_Mapping[0].status = 'rejected'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toEqual([])
    tables.Item_Mapping[0].status = 'confirmed'
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toHaveLength(1)
  })

  it("shows what the earlier item said, so the auditor can check the match", async () => {
    const [s] = await mapping.fetchProjectSuggestions('P2', USER)
    expect(s.sourceItemText).toBe('Age verification restricts minors')
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

function candidateTexts(ask: ReturnType<typeof askMatchingAge>): string[] {
  return ask.mock.calls.flatMap(([, user]) => (JSON.parse(user) as { candidates: { text: string }[] }[]).flatMap((p) => p.candidates.map((c) => c.text)))
}

function giveProjectBothGuidelines() {
  // P2 holds copies of items from G1 (p2c) and G2 (p2a, p2b), all pointing back to the library
  tables.Checklist.push({ checklistId: 'pc2b', guidelineId: 'G1', projectId: 'P2', Guideline: { guidelineName: 'ONSA Code', shortName: 'ONSA' } })
  tables.Checklist_Item.push({ itemId: 'p2c', checklistId: 'pc2b', category: 'Age', itemCode: 'O-1', reference: null, originalItemId: 'g1a', itemDescription: 'Age verification restricts minors' })
}

describe('generateMappingsForGuideline against every other guideline', () => {
  beforeEach(() => { tables.Item_Mapping = [] })

  it('offers the model items from all the other guidelines, whether or not a project uses them', async () => {
    addThirdGuideline()
    const ask = askMatchingAge()
    await mapping.generateMappingsForGuideline('G1', ask)
    const texts = candidateTexts(ask)
    expect(texts).toContain('Age assurance restricts children from accessing adult content')
    expect(texts).toContain(G3_TEXT)
  })

  it('compares all of the new guideline\'s own items', async () => {
    tables.Checklist_Item.push({ itemId: 'g1z', checklistId: 'gc1', category: 'Age', itemDescription: 'Age assurance restricts children from adult content online', itemName: null, itemCode: 'O-9', reference: null, verbatimClauseText: null })
    const result = await mapping.generateMappingsForGuideline('G1', askMatchingAge())
    expect(result.checked).toBe(2)
  })

  it('saves every new pair as suggested, with its confidence, for an admin to review', async () => {
    addThirdGuideline()
    await mapping.generateMappingsForGuideline('G1', askMatchingAge('partial', 0.4))
    expect(tables.Item_Mapping.length).toBeGreaterThan(0)
    for (const row of tables.Item_Mapping) expect(row).toMatchObject({ status: 'suggested', confidence: 0.4, relation: 'partial' })
  })

  it('asks the model to spread its confidence scores', () => {
    const ask = askMatchingAge()
    return mapping.generateMappingsForGuideline('G1', ask).then(() => {
      expect(ask.mock.calls[0][0]).toMatch(/confidence/i)
      expect(ask.mock.calls[0][0]).toMatch(/0\.9/)
    })
  })
})

describe('reviewMapping (admin decision)', () => {
  it('stores the status, the reviewer and the time', async () => {
    await mapping.reviewMapping('m1', 'rejected', undefined, 'admin-1')
    expect(tables.Item_Mapping[0]).toMatchObject({ status: 'rejected', reviewedBy: 'admin-1', relation: 'equivalent' })
    expect(tables.Item_Mapping[0].reviewedAt).toBeTruthy()
  })

  it('can change the relation at the same time', async () => {
    await mapping.reviewMapping('m1', 'confirmed', 'partial', 'admin-1')
    expect(tables.Item_Mapping[0]).toMatchObject({ status: 'confirmed', relation: 'partial' })
  })

  it('throws MappingNotFoundError for an unknown pair', async () => {
    await expect(mapping.reviewMapping('nope', 'confirmed', undefined, 'admin-1')).rejects.toThrow(mapping.MappingNotFoundError)
  })

  it('keeps a rejected pair rejected when the guideline is checked again', async () => {
    tables.Item_Mapping[0].status = 'rejected'
    await mapping.generateMappingsForGuideline('G1', askMatchingAge())
    expect(tables.Item_Mapping).toHaveLength(1)
    expect(tables.Item_Mapping[0].status).toBe('rejected')
  })
})

describe('fetchProjectSimilarItems', () => {
  beforeEach(() => { giveProjectBothGuidelines() })

  it("lists the approved pairs whose two items are both in the project, with the project's own item ids", async () => {
    const [pair] = await mapping.fetchProjectSimilarItems('P2')
    expect(pair).toMatchObject({ mappingId: 'm1', relation: 'equivalent', projectItemIdA: 'p2c', projectItemIdB: 'p2a' })
    expect(pair.itemA!.text).toBe('Age verification restricts minors from accessing adult content')
    expect(pair.itemB!.guidelineName).toBe('UKCC')
  })

  it('leaves out a pair when one item is not in the project', async () => {
    addThirdGuideline()
    tables.Item_Mapping = [{ mappingId: 'm9', itemIdA: 'g2a', itemIdB: 'g3a', relation: 'partial', status: 'confirmed', createdAt: '2026-01-02T00:00:00Z' }]
    expect(await mapping.fetchProjectSimilarItems('P2')).toEqual([])
  })

  it('leaves out a pair when the project switched an item off', async () => {
    tables.Checklist_Item.find((i) => i.itemId === 'p2a')!.category = '__deactivated__Age'
    expect(await mapping.fetchProjectSimilarItems('P2')).toEqual([])
  })

  it('leaves out pairs the admin has not approved, and rejected ones', async () => {
    tables.Item_Mapping[0].status = 'suggested'
    expect(await mapping.fetchProjectSimilarItems('P2')).toEqual([])
    tables.Item_Mapping[0].status = 'rejected'
    expect(await mapping.fetchProjectSimilarItems('P2')).toEqual([])
  })

  it("does not show another project's pairs", async () => {
    expect(await mapping.fetchProjectSimilarItems('P1')).toEqual([])
  })
})

describe('fetchProjectSuggestions inside the same project', () => {
  // The project itself holds both guidelines; no earlier approved project exists.
  beforeEach(() => {
    tables.Audit_Project[0].submissionStatus = 'draft'
    giveProjectBothGuidelines()
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

describe('fillInSameRequirement', () => {
  beforeEach(() => {
    tables.Audit_Project[0].submissionStatus = 'draft'
    giveProjectBothGuidelines()
    tables.Audit_Result.push({ resultId: 'r7', projectId: 'P2', itemId: 'p2c', userId: USER, result: 'compliant', findings: 'Age gate found', evidenceCount: 0, timeSubmitted: '2026-05-02T00:00:00Z' })
  })

  it('gives the linked same-requirement item the answer just saved', async () => {
    const filled = await mapping.fillInSameRequirement('P2', USER, 'p2c')
    expect(filled.map((a) => a.itemId)).toEqual(['p2a'])
    expect(tables.Audit_Result.find((r) => r.projectId === 'P2' && r.itemId === 'p2a')).toMatchObject({ result: 'compliant', findings: 'Age gate found' })
  })

  it('does not touch an item that already has an answer', async () => {
    tables.Audit_Result.push({ resultId: 'r8', projectId: 'P2', itemId: 'p2a', userId: USER, result: 'non_compliant', findings: 'mine', evidenceCount: 0, timeSubmitted: '2026-05-03T00:00:00Z' })
    expect(await mapping.fillInSameRequirement('P2', USER, 'p2c')).toEqual([])
    expect(tables.Audit_Result.find((r) => r.itemId === 'p2a')).toMatchObject({ result: 'non_compliant', findings: 'mine' })
  })

  it('leaves partly-overlapping pairs as suggestions', async () => {
    tables.Item_Mapping.forEach((m) => { m.relation = 'partial' })
    expect(await mapping.fillInSameRequirement('P2', USER, 'p2c')).toEqual([])
    expect(tables.Audit_Result.some((r) => r.itemId === 'p2a')).toBe(false)
    expect(await mapping.fetchProjectSuggestions('P2', USER)).toHaveLength(1)
  })

  it('never fails the save: a locked audit just fills nothing in', async () => {
    tables.Audit_Project.find((p) => p.projectId === 'P2')!.submissionStatus = 'pending_review'
    expect(await mapping.fillInSameRequirement('P2', USER, 'p2c')).toEqual([])
  })
})

describe('fillInAllSameRequirement (catch-up)', () => {
  beforeEach(() => {
    tables.Audit_Project[0].submissionStatus = 'draft'
    giveProjectBothGuidelines()
    tables.Audit_Result.push({ resultId: 'r7', projectId: 'P2', itemId: 'p2c', userId: USER, result: 'non_compliant', findings: 'No age gate', evidenceCount: 0, timeSubmitted: '2026-05-02T00:00:00Z' })
  })

  it('fills in items whose linked item was answered earlier', async () => {
    const filled = await mapping.fillInAllSameRequirement('P2', USER)
    expect(filled.map((a) => a.itemId)).toEqual(['p2a'])
    expect(tables.Audit_Result.find((r) => r.projectId === 'P2' && r.itemId === 'p2a')).toMatchObject({ result: 'non_compliant' })
  })

  it('does nothing the second time', async () => {
    await mapping.fillInAllSameRequirement('P2', USER)
    expect(await mapping.fillInAllSameRequirement('P2', USER)).toEqual([])
  })

  it('leaves out a suggestion the auditor dismissed', async () => {
    await mapping.dismissSuggestion('P2', USER, 'p2a', 'p2c')
    expect(await mapping.fillInAllSameRequirement('P2', USER)).toEqual([])
  })
})

describe('same-requirement items follow a changed answer', () => {
  beforeEach(async () => {
    tables.Audit_Project[0].submissionStatus = 'draft'
    giveProjectBothGuidelines()
    tables.Audit_Result.push({ resultId: 'r7', projectId: 'P2', itemId: 'p2c', userId: USER, result: 'compliant', findings: null, evidenceCount: 0, timeSubmitted: '2026-05-02T00:00:00Z' })
    await mapping.fillInSameRequirement('P2', USER, 'p2c', 'compliant', null) // p2a is filled in: compliant
  })

  const changeSource = (to: string) => { tables.Audit_Result.find((r) => r.resultId === 'r7')!.result = to }
  const target = () => tables.Audit_Result.find((r) => r.projectId === 'P2' && r.itemId === 'p2a')!

  it('changes a linked item that still matched the earlier answer', async () => {
    changeSource('non_compliant')
    const changed = await mapping.fillInSameRequirement('P2', USER, 'p2c', 'non_compliant', 'compliant')
    expect(changed.map((a) => [a.itemId, a.result])).toEqual([['p2a', 'non_compliant']])
    expect(target().result).toBe('non_compliant')
  })

  it('changes a filled-in item that has not been touched since, even if the earlier answer is unknown', async () => {
    const decision = tables.Suggestion_Decision.find((d) => d.itemId === 'p2a')!
    decision.decidedAt = new Date(Date.parse(target().timeSubmitted) + 1000).toISOString()
    changeSource('partially')
    await mapping.fillInSameRequirement('P2', USER, 'p2c', 'partially', 'partially')
    expect(target().result).toBe('partially')
  })

  it('leaves an answer the auditor changed on purpose', async () => {
    target().result = 'not_applicable'
    target().timeSubmitted = '2099-01-01T00:00:00Z'
    tables.Suggestion_Decision.find((d) => d.itemId === 'p2a')!.decidedAt = '2026-05-03T00:00:00Z'
    changeSource('non_compliant')
    expect(await mapping.fillInSameRequirement('P2', USER, 'p2c', 'non_compliant', 'compliant')).toEqual([])
    expect(target().result).toBe('not_applicable')
  })

  it('does nothing when the answer is the same', async () => {
    expect(await mapping.fillInSameRequirement('P2', USER, 'p2c', 'compliant', 'compliant')).toEqual([])
  })
})

describe('items that are the same requirement as several others (a group)', () => {
  const USER_ID = USER
  beforeEach(() => {
    tables.Audit_Project.find((p) => p.projectId === 'P2')!.submissionStatus = 'draft'
    giveProjectBothGuidelines()
    // A third guideline whose item is linked to g2a only; g1a, g2a and g3a are one group through g2a.
    tables.Checklist.push({ checklistId: 'gc3', guidelineId: 'G3', projectId: null, Guideline: { guidelineName: 'EDPB', shortName: 'EDPB' } })
    tables.Checklist.push({ checklistId: 'pc2c', guidelineId: 'G3', projectId: 'P2', Guideline: { guidelineName: 'EDPB', shortName: 'EDPB' } })
    tables.Checklist_Item.push({ itemId: 'g3a', checklistId: 'gc3', category: 'Age', itemDescription: 'Age checks', itemName: null, itemCode: 'E-1', reference: null, verbatimClauseText: null })
    tables.Checklist_Item.push({ itemId: 'p2d', checklistId: 'pc2c', category: 'Age', itemCode: 'E-1', reference: null, originalItemId: 'g3a', itemDescription: 'Age checks' })
    tables.Item_Mapping.push({ mappingId: 'm2', itemIdA: 'g2a', itemIdB: 'g3a', relation: 'equivalent', confidence: 0.9, rationale: 'same', status: 'confirmed', createdAt: '2026-01-02T00:00:00Z' })
    tables.Audit_Result.push({ resultId: 'r9', projectId: 'P2', itemId: 'p2c', userId: USER_ID, result: 'compliant', findings: 'ok', evidenceCount: 0, timeSubmitted: '2026-05-02T00:00:00Z' })
  })

  const answerOf = (itemId: string) => tables.Audit_Result.find((r) => r.projectId === 'P2' && r.itemId === itemId)

  it('lists every pair of the group, also the one no admin linked directly, marked as derived', async () => {
    const pairs = await mapping.fetchProjectSimilarItems('P2')
    const ends = pairs.map((p) => [p.projectItemIdA, p.projectItemIdB].sort().join('+') + (p.derived ? ' derived' : ''))
    expect(ends.sort()).toEqual(['p2a+p2c', 'p2a+p2d', 'p2c+p2d derived'])
  })

  it('fills in every item of the group from one answer', async () => {
    const filled = await mapping.fillInSameRequirement('P2', USER_ID, 'p2c', 'compliant', null)
    expect(filled.map((a) => a.itemId).sort()).toEqual(['p2a', 'p2d'])
    expect(answerOf('p2d')).toMatchObject({ result: 'compliant' })
  })

  it('follows through the group when the answer changes', async () => {
    await mapping.fillInSameRequirement('P2', USER_ID, 'p2c', 'compliant', null)
    answerOf('p2c')!.result = 'non_compliant'
    await mapping.fillInSameRequirement('P2', USER_ID, 'p2c', 'non_compliant', 'compliant')
    expect(answerOf('p2a')!.result).toBe('non_compliant')
    expect(answerOf('p2d')!.result).toBe('non_compliant')
  })

  it('leaves an empty item for the auditor when the group already disagrees', async () => {
    tables.Audit_Result.push({ resultId: 'r10', projectId: 'P2', itemId: 'p2d', userId: USER_ID, result: 'non_compliant', findings: null, evidenceCount: 0, timeSubmitted: '2026-05-01T00:00:00Z' })
    const filled = await mapping.fillInSameRequirement('P2', USER_ID, 'p2c', 'compliant', null)
    expect(filled).toEqual([])
    expect(answerOf('p2a')).toBeUndefined()
  })

  it('does not group items through a partly-overlapping link', async () => {
    tables.Item_Mapping.find((m) => m.mappingId === 'm2')!.relation = 'partial'
    const filled = await mapping.fillInSameRequirement('P2', USER_ID, 'p2c', 'compliant', null)
    expect(filled.map((a) => a.itemId)).toEqual(['p2a'])
  })
})

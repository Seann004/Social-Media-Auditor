import { expect, test, type Page, type Route } from '@playwright/test'
import { AUDITOR, answeredCount } from './stubApi'
import { ADMIN, CORE_ITEMS, GUIDELINE, SEEDED_PROJECT, installCoreStub, seedCoreSession } from './coreStub'

// Browser checks for linked items (report TC-30, TC-32 and TC-58): the Admin's review of the pairs the AI found, and
// the Auditor's offer of an answer from a linked item. The backend is stubbed: coreStub for the app around them, and
// the routes below for the mapping and suggestion endpoints. Shapes follow src/lib/db.ts and
// backend/src/routes/mappingRoutes.ts.

const API_ORIGIN = 'http://127.0.0.1:5198'
/** Where the dev server runs for this run; coreStub lets only port 5199 through. */
const OWN_APP_ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 5199}`
type Json = Record<string, unknown>
type Status = 'suggested' | 'confirmed' | 'rejected'
type Relation = 'equivalent' | 'partial'

/** A second framework, so a pair can link items of two guidelines. */
const UKCC = {
  ...GUIDELINE,
  guidelineId: 'g-ukcc',
  guidelineName: "UK Children's Code",
  shortName: 'UKCC',
  description: 'Age appropriate design code.',
  categories: ['Messaging'],
} as const
const UKCC_ITEMS = [
  { key: 'uk1', text: 'Children cannot receive messages from adults they do not know.' },
  { key: 'uk2', text: 'Profiles of children are hidden from search by default.' },
] as const

const guidelineItem = (g: { guidelineId: string; shortName: string; categories: readonly string[] }, key: string, text: string, i: number) => ({
  itemId: key,
  guidelineId: g.guidelineId,
  category: g.categories[0],
  itemDescription: text,
  severity: 'major',
  reference: `${g.shortName} ${i + 1}`,
  itemName: null,
  itemCode: null,
  rowType: null,
  helpText: null,
  verbatimClauseText: null,
  answerOptions: null,
})

const mapped = (g: { guidelineId: string; shortName: string; categories: readonly string[] }, key: string, text: string, i: number) => ({
  itemId: key,
  guidelineId: g.guidelineId,
  guidelineName: g.shortName,
  category: g.categories[0],
  itemCode: null,
  text,
  reference: `${g.shortName} ${i + 1}`,
  clause: null,
})

/** The one pair the Admin has already approved: OSC a2 and UKCC uk1 are the same requirement. */
const PAIR_ID = '3f1c2a7e-8b4d-4e6f-9a01-2b3c4d5e6f70'
const PAIR_A = mapped(GUIDELINE, CORE_ITEMS[1].key, CORE_ITEMS[1].text, 1)
const PAIR_B = mapped(UKCC, UKCC_ITEMS[0].key, UKCC_ITEMS[0].text, 0)

interface Pair {
  mappingId: string
  relation: Relation
  confidence: number
  status: Status
  itemA: typeof PAIR_A
  itemB: typeof PAIR_B
}

interface MappingStub {
  /** Bodies of PATCH /mappings/:id, with the id. */
  reviews: { mappingId: string; body: Json }[]
  /** Guideline ids sent to Find links. */
  generates: string[]
  /** Bulk decisions, which none of these cases should send. */
  bulk: Json[]
  pair(id: string): Pair | undefined
}

/** Lets the app's own files load when E2E_PORT moves the dev server. Everything else goes to the stubs as before. */
async function letAppLoad(page: Page) {
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === OWN_APP_ORIGIN ? route.continue() : route.fallback())
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const levelOf = (confidence: number) => (confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low')

const pairOut = (p: Pair) => ({
  mappingId: p.mappingId,
  relation: p.relation,
  confidence: p.confidence,
  learnedConfidence: p.confidence,
  learnedFrom: 0,
  score: p.confidence,
  level: levelOf(p.confidence),
  rationale: 'Both stop strangers from messaging children.',
  status: p.status,
  createdAt: '2026-11-01T09:00:00.000Z',
  reviewedAt: p.status === 'suggested' ? null : '2026-11-02T09:00:00.000Z',
  usage: { projectsA: 1, projectsB: 0, together: 0 },
  groupImpact: null,
  itemA: p.itemA,
  itemB: p.itemB,
})

/** The Admin's mapping endpoints, on top of coreStub. State lives here, so a decision changes the next list. */
async function installMappingStub(page: Page, pairs: Pair[]): Promise<MappingStub> {
  let state = pairs.map((p) => ({ ...p }))
  const stub: MappingStub = { reviews: [], generates: [], bulk: [], pair: (id) => state.find((p) => p.mappingId === id) }

  const list = (route: Route, url: URL) => {
    const q = url.searchParams
    const status = q.get('status') as Status
    const guidelineId = q.get('guidelineId')
    const relation = q.get('relation')
    const level = q.get('level')
    const offset = Number(q.get('offset') ?? 0)
    const limit = Number(q.get('limit') ?? 10)
    const byFilters = state.filter((p) =>
      (!guidelineId || p.itemA.guidelineId === guidelineId || p.itemB.guidelineId === guidelineId)
      && (!relation || p.relation === relation))
    const ofStatus = byFilters.filter((p) => p.status === status)
    const shown = ofStatus.filter((p) => !level || levelOf(p.confidence) === level)
    const count = (rows: Pair[], s: Status) => rows.filter((p) => p.status === s).length
    const levels = { high: 0, medium: 0, low: 0 }
    for (const p of ofStatus) levels[levelOf(p.confidence)] += 1
    return json(route, {
      items: shown.slice(offset, offset + limit).map(pairOut),
      total: shown.length,
      counts: { suggested: count(byFilters, 'suggested'), confirmed: count(byFilters, 'confirmed'), rejected: count(byFilters, 'rejected') },
      totals: { suggested: count(state, 'suggested'), confirmed: count(state, 'confirmed'), rejected: count(state, 'rejected') },
      levels,
      linkedGuidelineIds: [...new Set(state.flatMap((p) => [p.itemA.guidelineId, p.itemB.guidelineId]))],
    })
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== API_ORIGIN) return route.fallback()
    const method = request.method()
    const path = url.pathname.replace(/^\/api/, '')

    if (method === 'GET' && path === '/guidelines') {
      return json(route, [{ ...GUIDELINE, itemCount: CORE_ITEMS.length }, { ...UKCC, itemCount: UKCC_ITEMS.length }])
    }
    if (method === 'GET' && path === `/guidelines/${UKCC.guidelineId}/items`) {
      return json(route, UKCC_ITEMS.map((it, i) => guidelineItem(UKCC, it.key, it.text, i)))
    }
    if (method === 'GET' && path === '/mappings') return list(route, url)
    if (method === 'GET' && path === '/mappings/learning') {
      return json(route, { decided: 1, approved: 1, rejected: 0, minDecisionsToShow: 5, bands: [] })
    }
    if (method === 'POST' && path === '/mappings/bulk') {
      stub.bulk.push(request.postDataJSON() as Json)
      return json(route, { error: 'Not expected in these cases.' }, 500)
    }
    const review = /^\/mappings\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && review) {
      const body = request.postDataJSON() as { status: Status; relation?: Relation }
      stub.reviews.push({ mappingId: review[1], body })
      const target = state.find((p) => p.mappingId === review[1])
      if (!target) return json(route, { error: 'That link was not found.' }, 404)
      state = state.map((p) => (p === target ? { ...p, status: body.status, relation: body.relation ?? p.relation } : p))
      return json(route, { mappingId: target.mappingId, status: body.status, relation: body.relation ?? target.relation })
    }
    const generate = /^\/guidelines\/([^/]+)\/mappings\/generate$/.exec(path)
    if (method === 'POST' && generate) {
      stub.generates.push(generate[1])
      // Every item of the framework was compared again, and each pair it could make was already saved or checked.
      const checked = generate[1] === GUIDELINE.guidelineId ? CORE_ITEMS.length : UKCC_ITEMS.length
      return json(route, { checked, suggested: 0, failedBatches: 0 })
    }
    return route.fallback()
  })
  return stub
}

const approvedPair = (): Pair => ({ mappingId: PAIR_ID, relation: 'equivalent', confidence: 0.92, status: 'confirmed', itemA: PAIR_A, itemB: PAIR_B })

async function openLinkedItems(page: Page) {
  await page.goto('/guidelines')
  await page.getByRole('button', { name: 'Linked items', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Find links' })).toBeVisible()
}

const tab = (page: Page, label: 'Awaiting review' | 'Approved' | 'Rejected') =>
  page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) })

/** The pair's two rows in the review table: the items, then the decision strip under them. */
const pairRows = (page: Page) => page.locator('tbody tr').filter({ hasText: PAIR_A.text })
/** The decision buttons of the one pair shown. */
const decisionOf = (page: Page) => page.getByRole('group', { name: 'Your decision' })

test.describe('Linked items', () => {
  // The first page of a fresh dev server compiles the whole app, which can take over a minute on a busy machine.
  test.describe.configure({ timeout: 180_000 })

  test('TC-30 (FR-020): Find links on a framework already checked finds no new pairs', async ({ page }) => {
    const core = await installCoreStub(page, { project: 'none' })
    await letAppLoad(page)
    const stub = await installMappingStub(page, [approvedPair()])
    await seedCoreSession(page, ADMIN)

    await openLinkedItems(page)
    // Already checked: both frameworks have saved links, so the "not checked yet" note is not shown.
    await expect(page.getByRole('note')).toHaveCount(0)
    await expect(tab(page, 'Awaiting review')).toHaveText(/Awaiting review\s*0/)

    await page.getByLabel('Framework', { exact: true }).selectOption({ label: GUIDELINE.shortName })
    await page.getByRole('button', { name: 'Find links' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'No new links' })).toHaveText('No new links found across 4 items.')
    expect(stub.generates).toEqual([GUIDELINE.guidelineId])
    // Nothing new is waiting for review, and nothing was decided.
    await expect(tab(page, 'Awaiting review')).toHaveText(/Awaiting review\s*0/)
    await expect(page.getByText('Nothing here yet.')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(stub.reviews).toEqual([])
    expect(stub.bulk).toEqual([])
    expect(core.violations).toEqual([])
  })

  test('TC-32 (FR-021): an approved pair marked Not related moves to the Rejected tab', async ({ page }) => {
    const core = await installCoreStub(page, { project: 'none' })
    await letAppLoad(page)
    const stub = await installMappingStub(page, [approvedPair()])
    await seedCoreSession(page, ADMIN)

    await openLinkedItems(page)
    await tab(page, 'Approved').click()
    await expect(tab(page, 'Approved')).toHaveAttribute('aria-pressed', 'true')
    await expect(pairRows(page)).toContainText(PAIR_B.text)

    await decisionOf(page).getByRole('button', { name: 'Not related' }).click()

    await expect.poll(() => stub.reviews).toEqual([{ mappingId: PAIR_ID, body: { status: 'rejected' } }])
    expect(stub.pair(PAIR_ID)?.status).toBe('rejected')
    // The Approved tab no longer lists it.
    await expect(tab(page, 'Approved')).toHaveText(/Approved\s*0/)
    await expect(page.getByText('Nothing here yet.')).toBeVisible()

    await tab(page, 'Rejected').click()
    await expect(tab(page, 'Rejected')).toHaveText(/Rejected\s*1/)
    await expect(pairRows(page)).toContainText(PAIR_B.text)
    // Listed as rejected: it can be approved again, but not rejected again.
    await expect(decisionOf(page).getByRole('button', { name: 'Same requirement' })).toBeVisible()
    await expect(decisionOf(page).getByRole('button', { name: 'Not related' })).toHaveCount(0)
    expect(stub.bulk).toEqual([])
    expect(core.violations).toEqual([])
  })

  test("TC-58 (FR-037): dismissing a linked item's answer sends the dismissal and answers nothing", async ({ page }) => {
    const core = await installCoreStub(page, { project: 'in_progress' })
    await letAppLoad(page)
    const target = `${SEEDED_PROJECT.id}-${CORE_ITEMS[1].key}`
    // The source: an item of another framework in the same project, which the Auditor answered and an Admin linked.
    const offer = {
      itemId: target,
      guidelineId: `${SEEDED_PROJECT.id}-${GUIDELINE.guidelineId}`,
      suggestedStatus: 'non_compliant',
      // Only a partly-overlapping link is left to offer here: a same-requirement one in the same project is filled in
      // by itself when the page opens.
      relation: 'partial',
      sourceProjectId: SEEDED_PROJECT.id,
      sourceProjectTitle: SEEDED_PROJECT.title,
      sourceGuideline: UKCC.shortName,
      sourceItemId: `${SEEDED_PROJECT.id}-${UKCC_ITEMS[0].key}`,
      sourceItemCode: 'UKCC 1',
      sourceItemText: UKCC_ITEMS[0].text,
      findings: 'Any adult can message a teen.',
      evidenceCount: 0,
      answeredAt: '2026-11-03T10:00:00.000Z',
      otherSources: 0,
    }
    const dismissals: Json[] = []
    const accepts: Json[] = []
    const answerPosts: Json[] = []
    let dismissed = false
    const base = `/api/projects/${SEEDED_PROJECT.id}`
    await page.route('**/api/**', (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const key = `${request.method()} ${url.pathname}`
      if (url.origin !== API_ORIGIN) return route.fallback()
      if (key === `GET ${base}/suggestions`) return json(route, dismissed ? [] : [offer])
      if (key === `POST ${base}/suggestions/dismiss`) {
        dismissals.push(request.postDataJSON() as Json)
        dismissed = true
        return json(route, { success: true })
      }
      if (key === `POST ${base}/suggestions/accept`) {
        accepts.push(request.postDataJSON() as Json)
        return json(route, { accepted: [] })
      }
      // Counted, then answered by coreStub as usual.
      if (key === `POST ${base}/results`) answerPosts.push(request.postDataJSON() as Json)
      return route.fallback()
    })
    await seedCoreSession(page, AUDITOR)
    await page.goto(`/projects/${SEEDED_PROJECT.id}`)

    const card = page.locator('div.rounded-lg', { hasText: 'Related requirement answered' })
    await expect(card).toBeVisible()
    await expect(card).toContainText(`in "${SEEDED_PROJECT.title}"`)
    await expect(card).toContainText(`Earlier item: ${UKCC_ITEMS[0].text}`)
    await expect(page.getByRole('button', { name: '1 from earlier audits' })).toBeVisible()
    await expect(answeredCount(page)).toHaveText(`0/${CORE_ITEMS.length}`)

    await card.getByRole('button', { name: 'Dismiss' }).click()

    await expect.poll(() => dismissals).toEqual([{ itemId: target, sourceItemId: offer.sourceItemId }])
    await expect(page.getByText('Related requirement answered')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /from earlier audits/ })).toHaveCount(0)
    // Nothing answered: no answer was sent or reused, and the item is still open.
    await expect(answeredCount(page)).toHaveText(`0/${CORE_ITEMS.length}`)
    expect(answerPosts).toEqual([])
    expect(accepts).toEqual([])
    expect(core.answers(SEEDED_PROJECT.id)).toEqual([])
    await expect(page.getByText("Couldn't dismiss that suggestion.")).toHaveCount(0)
    expect(core.violations).toEqual([])
  })
})

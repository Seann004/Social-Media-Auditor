import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { AUDITOR, HEAD, type TestUser } from './stubApi'
import {
  ADMIN,
  CORE_ITEMS,
  GUIDELINE,
  SECOND_AUDITOR,
  SEEDED_PROJECT,
  installCoreStub,
  seedCoreSession,
  type CoreStub,
} from './coreStub'

// Browser checks for managing an existing project (report TC-08, TC-14, TC-17, TC-19, TC-20).
// The backend is stubbed (coreStub plus the overlay below), so these check what the page shows and what it sends.

const API_ORIGIN = 'http://127.0.0.1:5198'
const PROJECT = SEEDED_PROJECT.id
const PEOPLE: TestUser[] = [HEAD, AUDITOR, SECOND_AUDITOR, ADMIN]

/** A second guideline in the library, so there is one to add. */
const SECOND_GUIDELINE = {
  guidelineId: 'g-aadc',
  guidelineName: 'Age Appropriate Design Code',
  shortName: 'AADC',
  version: '1.1',
  description: 'Design standards for services likely to be used by children.',
  source: 'e2e',
  lastUpdated: '2026-02-01',
  categories: ['Design'],
  isDeleted: false,
} as const
const LIBRARY = [GUIDELINE, SECOND_GUIDELINE]

interface Sent {
  method: string
  path: string
  body: unknown
}

interface Overlay {
  /** Every project-management write the page sent, in order, with its parsed body. */
  sent: Sent[]
  bodiesTo(method: string, path: string): unknown[]
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const itemsOf = (g: (typeof LIBRARY)[number]) =>
  (g.guidelineId === GUIDELINE.guidelineId ? CORE_ITEMS.map((it) => ({ key: it.key, text: it.text })) : [{ key: 'd1', text: 'High privacy settings are on by default.' }])
    .map((it, i) => ({
      itemId: it.key,
      guidelineId: g.guidelineId,
      category: g.categories[0],
      itemDescription: it.text,
      severity: 'major',
      reference: `${g.shortName} ${i + 1}`,
      itemName: null,
      itemCode: null,
      rowType: null,
      helpText: null,
      verbatimClauseText: null,
      answerOptions: null,
    }))

/**
 * Fills the gaps in the core stub for this page, and is registered after it so it wins:
 * - the library holds two guidelines, not one;
 * - the project details name each guideline the project uses (the core stub labels every one as the first)
 *   and can start with saved scope features;
 * - the single-member routes the Manage Auditors panel calls (add one, remove one), which the core stub lacks.
 *   They change the core stub's own member list, so the project list and details read the change back.
 */
async function installManageOverlay(page: Page, stub: CoreStub, seed: { scope?: string[] } = {}): Promise<Overlay> {
  // The core stub lets only port 5199 through; when E2E_PORT moves the dev server, the app's own files must still load.
  // Only the page's own origin is passed on; every API request still meets a stub.
  const appOrigin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:5199').origin
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === appOrigin ? route.continue() : route.fallback())

  const overlay: Overlay = {
    sent: [],
    bodiesTo: (method, path) => overlay.sent.filter((s) => s.method === method && s.path === path).map((s) => s.body),
  }
  // Records the bodies as they leave the page, whichever stub answers them.
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== API_ORIGIN || request.method() === 'GET') return
    const path = url.pathname.replace(/^\/api/, '')
    if (!path.startsWith(`/projects/${PROJECT}/`)) return
    const raw = request.postData()
    overlay.sent.push({ method: request.method(), path, body: raw ? JSON.parse(raw) : null })
  })

  const ownerToken = `Bearer e2e-token-${HEAD.userId}`
  const setMembers = (ids: string[]) => {
    const current = stub.project(PROJECT)
    // The core stub keeps no setter for members outside its full sync route, so its record is updated in place.
    if (current) current.memberIds = ids
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname.replace(/^\/api/, '')
    const authorised = request.headers()['authorization'] === ownerToken

    if (method === 'GET' && path === '/guidelines') {
      return json(route, LIBRARY.map((g) => ({ ...g, itemCount: itemsOf(g).length })))
    }
    if (method === 'GET' && path === `/guidelines/${SECOND_GUIDELINE.guidelineId}/items`) {
      return json(route, itemsOf(SECOND_GUIDELINE))
    }
    if (method === 'GET' && path === `/projects/${PROJECT}`) {
      const p = stub.project(PROJECT)
      if (!p) return route.fallback()
      return json(route, {
        project: { ...p, scope: undefined, guidelineIds: p.guidelineIds.map((gid) => `${PROJECT}-${gid}`) },
        members: p.memberIds.flatMap((uid) => PEOPLE.filter((u) => u.userId === uid))
          .map(({ userId, userName, role }) => ({ userId, userName, role })),
        guidelines: p.guidelineIds.flatMap((gid) => LIBRARY.filter((g) => g.guidelineId === gid)).map((g) => ({
          ...g,
          guidelineId: `${PROJECT}-${g.guidelineId}`,
          originalGuidelineId: g.guidelineId,
          itemCount: itemsOf(g).length,
        })),
        scope: p.scope ?? seed.scope ?? [],
      })
    }
    if (method === 'POST' && path === `/projects/${PROJECT}/members/add`) {
      if (!authorised) return json(route, { error: 'Only the head auditor of this project can do this.' }, 403)
      const { userId } = request.postDataJSON() as { userId?: unknown }
      if (typeof userId !== 'string' || !userId) return json(route, { error: 'userId is required.' }, 400)
      const members = stub.project(PROJECT)?.memberIds ?? []
      setMembers(members.includes(userId) ? members : [...members, userId])
      return json(route, { success: true })
    }
    const removal = new RegExp(`^/projects/${PROJECT}/members/([^/]+)$`).exec(path)
    if (method === 'DELETE' && removal) {
      if (!authorised) return json(route, { error: 'Only the head auditor of this project can do this.' }, 403)
      setMembers((stub.project(PROJECT)?.memberIds ?? []).filter((id) => id !== removal[1]))
      return json(route, { success: true })
    }
    return route.fallback()
  })
  return overlay
}

async function openProject(page: Page): Promise<void> {
  await page.goto('/projects')
  await page.getByRole('main').getByRole('link', { name: new RegExp(SEEDED_PROJECT.title) }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}$`))
  await expect(page.getByRole('button', { name: 'Manage Auditors' })).toBeVisible()
}

const tab = (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true })
/** The Manage Auditors panel, and the team rows inside it. */
const teamPanel = (page: Page): Locator =>
  page.locator('div.bg-slate-50.border-b').filter({ has: page.getByLabel('Search auditors to add') })
const teamRows = (page: Page): Locator => teamPanel(page).locator('div.space-y-2 > div')
const teamRow = (page: Page, name: string): Locator => teamRows(page).filter({ hasText: name })
const scopeChip = (page: Page, feature: string): Locator => page.getByRole('button', { name: `Remove ${feature} from scope` })
/** The "Guidelines in Use" list: each row has a remove button named after the guideline. */
const inUse = (page: Page, name: string): Locator => page.getByRole('button', { name: `Remove ${name}`, exact: true })

async function addGuideline(page: Page): Promise<void> {
  await tab(page, 'Guidelines').click()
  await expect(page.getByRole('heading', { name: 'Guidelines in Use' })).toBeVisible()
  await expect(inUse(page, GUIDELINE.guidelineName)).toBeVisible()
  await expect(inUse(page, SECOND_GUIDELINE.guidelineName)).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage Guidelines' }).click()
  await page.locator('label').filter({ hasText: SECOND_GUIDELINE.guidelineName }).click()
  await expect(page.getByRole('checkbox', { name: new RegExp(SECOND_GUIDELINE.guidelineName) })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: new RegExp(GUIDELINE.guidelineName) })).toBeChecked()
  await page.getByRole('button', { name: 'Save Changes' }).click()
  // The button goes once the saved list matches the ticked one.
  await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0)
}

async function addAuditorBySearch(page: Page, user: TestUser): Promise<void> {
  await page.getByLabel('Search auditors to add').fill(user.userName.split(' ')[0])
  await teamPanel(page).getByRole('listitem').getByRole('button', { name: new RegExp(user.userName) }).click()
  await expect(teamRow(page, user.userName)).toBeVisible()
}

test.describe('Managing an existing project', () => {
  test('TC-08 (FR-004): guidelines, scope and team changes to an existing project are sent and shown', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    const overlay = await installManageOverlay(page, stub)
    await seedCoreSession(page, HEAD)
    // Pre: one guideline and one Auditor (besides the Head Auditor).
    expect(stub.project(PROJECT)?.guidelineIds).toEqual([GUIDELINE.guidelineId])
    expect(stub.project(PROJECT)?.memberIds).toEqual([HEAD.userId, AUDITOR.userId])
    await openProject(page)

    // 1. Add a second guideline and save.
    await addGuideline(page)
    expect(overlay.bodiesTo('POST', `/projects/${PROJECT}/guidelines`)).toEqual([
      { guidelineIds: [GUIDELINE.guidelineId, SECOND_GUIDELINE.guidelineId] },
    ])
    await expect(inUse(page, GUIDELINE.guidelineName)).toBeVisible()
    await expect(inUse(page, SECOND_GUIDELINE.guidelineName)).toBeVisible()

    // 2. Add scope features and save.
    await tab(page, 'Scope / Features').click()
    const input = page.getByLabel('Add a feature to the audit scope')
    for (const feature of ['Login', 'Direct Messages']) {
      await input.fill(feature)
      await input.press('Enter')
    }
    await page.getByRole('button', { name: 'Save Scope' }).click()
    await expect.poll(() => overlay.bodiesTo('POST', `/projects/${PROJECT}/scope`)).toEqual([{ features: ['Login', 'Direct Messages'] }])
    await expect(scopeChip(page, 'Login')).toBeVisible()
    await expect(scopeChip(page, 'Direct Messages')).toBeVisible()

    // 3. Add one Auditor and remove another.
    await page.getByRole('button', { name: 'Manage Auditors' }).click()
    await addAuditorBySearch(page, SECOND_AUDITOR)
    await teamPanel(page).getByRole('button', { name: `Remove ${AUDITOR.userName} from this project` }).click()
    await expect(teamRow(page, AUDITOR.userName)).toHaveCount(0)
    expect(overlay.bodiesTo('POST', `/projects/${PROJECT}/members/add`)).toEqual([{ userId: SECOND_AUDITOR.userId }])
    expect(overlay.bodiesTo('DELETE', `/projects/${PROJECT}/members/${AUDITOR.userId}`)).toEqual([null])
    await expect(teamRows(page)).toHaveCount(2)

    // Every change is still there when the page is loaded again from the server.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Manage Auditors' })).toBeVisible()
    await expect(page.getByRole('button', { name: GUIDELINE.shortName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: SECOND_GUIDELINE.shortName, exact: true })).toBeVisible()
    await tab(page, 'Scope / Features').click()
    await expect(scopeChip(page, 'Login')).toBeVisible()
    await expect(scopeChip(page, 'Direct Messages')).toBeVisible()
    await page.getByRole('button', { name: 'Manage Auditors' }).click()
    await expect(teamRow(page, SECOND_AUDITOR.userName)).toBeVisible()
    await expect(teamRow(page, AUDITOR.userName)).toHaveCount(0)
    expect(stub.violations).toEqual([])
  })

  test('TC-14 (FR-008): ticking a second guideline in the Guidelines tab sends both on Save Changes', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    const overlay = await installManageOverlay(page, stub)
    await seedCoreSession(page, HEAD)
    await openProject(page)

    await addGuideline(page)
    expect(overlay.bodiesTo('POST', `/projects/${PROJECT}/guidelines`)).toEqual([
      { guidelineIds: [GUIDELINE.guidelineId, SECOND_GUIDELINE.guidelineId] },
    ])
    expect(stub.guidelineSyncs).toEqual([{ projectId: PROJECT, guidelineIds: [GUIDELINE.guidelineId, SECOND_GUIDELINE.guidelineId] }])
    await expect(inUse(page, GUIDELINE.guidelineName)).toBeVisible()
    await expect(inUse(page, SECOND_GUIDELINE.guidelineName)).toBeVisible()
    // The checklist now offers both guidelines.
    await tab(page, 'Checklist').click()
    await expect(page.getByRole('button', { name: GUIDELINE.shortName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: SECOND_GUIDELINE.shortName, exact: true })).toBeVisible()
    expect(stub.violations).toEqual([])
  })

  test('TC-17 (FR-011): the scope can be changed later, after reopening the project from the list', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    const overlay = await installManageOverlay(page, stub, { scope: ['Login', 'Privacy Settings'] })
    await seedCoreSession(page, HEAD)

    // 1. Reopen the project from the list.
    await openProject(page)
    await tab(page, 'Scope / Features').click()
    await expect(scopeChip(page, 'Login')).toBeVisible()
    await expect(scopeChip(page, 'Privacy Settings')).toBeVisible()

    // 2. Remove Login, add Direct Messages. 3. Save Scope.
    await scopeChip(page, 'Login').click()
    await page.getByLabel('Add a feature to the audit scope').fill('Direct Messages')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: 'Save Scope' }).click()

    await expect.poll(() => overlay.bodiesTo('POST', `/projects/${PROJECT}/scope`)).toEqual([{ features: ['Privacy Settings', 'Direct Messages'] }])
    await expect(scopeChip(page, 'Login')).toHaveCount(0)
    await expect(scopeChip(page, 'Privacy Settings')).toBeVisible()
    await expect(scopeChip(page, 'Direct Messages')).toBeVisible()

    // Reopened again, the page shows the saved scope.
    await openProject(page)
    await tab(page, 'Scope / Features').click()
    await expect(scopeChip(page, 'Privacy Settings')).toBeVisible()
    await expect(scopeChip(page, 'Direct Messages')).toBeVisible()
    await expect(scopeChip(page, 'Login')).toHaveCount(0)
    expect(stub.violations).toEqual([])
  })

  test('TC-19 (FR-012): an Auditor is added by search and another removed, and the team list shows both changes', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    const overlay = await installManageOverlay(page, stub)
    await seedCoreSession(page, HEAD)
    await openProject(page)

    // 1. Manage Auditors: the one Auditor is on the team.
    await page.getByRole('button', { name: 'Manage Auditors' }).click()
    await expect(teamRow(page, AUDITOR.userName)).toBeVisible()
    await expect(teamRow(page, SECOND_AUDITOR.userName)).toHaveCount(0)

    // 2. Search and add a second Auditor.
    await addAuditorBySearch(page, SECOND_AUDITOR)
    expect(overlay.bodiesTo('POST', `/projects/${PROJECT}/members/add`)).toEqual([{ userId: SECOND_AUDITOR.userId }])
    await expect(teamRows(page)).toHaveCount(3)

    // 3. Remove the first.
    await teamPanel(page).getByRole('button', { name: `Remove ${AUDITOR.userName} from this project` }).click()
    await expect(teamRow(page, AUDITOR.userName)).toHaveCount(0)
    expect(overlay.bodiesTo('DELETE', `/projects/${PROJECT}/members/${AUDITOR.userId}`)).toHaveLength(1)
    await expect(teamRows(page)).toHaveCount(2)
    await expect(teamRow(page, HEAD.userName)).toBeVisible()
    await expect(teamRow(page, SECOND_AUDITOR.userName)).toBeVisible()
    expect(overlay.sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      `POST /projects/${PROJECT}/members/add`,
      `DELETE /projects/${PROJECT}/members/${AUDITOR.userId}`,
    ])
    expect(stub.project(PROJECT)?.memberIds).toEqual([HEAD.userId, SECOND_AUDITOR.userId])
    expect(stub.violations).toEqual([])
  })

  test('TC-20 (FR-013): Manage Auditors lists each team member with their role and marks the Head Auditor', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    await installManageOverlay(page, stub)
    await seedCoreSession(page, HEAD)
    await openProject(page)

    await page.getByRole('button', { name: 'Manage Auditors' }).click()
    await expect(teamRows(page)).toHaveCount(2)
    const head = teamRow(page, HEAD.userName)
    const auditor = teamRow(page, AUDITOR.userName)
    // innerText, so the role reads as it is shown (the page capitalises it with CSS).
    await expect(head.locator('p').nth(1)).toHaveText(/^Head Auditor\s*· Head Auditor$/, { useInnerText: true })
    await expect(auditor.locator('p').nth(1)).toHaveText(/^Auditor$/, { useInnerText: true })
    await expect(head.getByText('· Head Auditor')).toBeVisible()
    await expect(auditor.getByText('· Head Auditor')).toHaveCount(0)
    // The Head Auditor cannot be removed from their own project; the Auditor can.
    await expect(head.getByRole('button', { name: /^Remove / })).toHaveCount(0)
    await expect(auditor.getByRole('button', { name: `Remove ${AUDITOR.userName} from this project` })).toBeVisible()
    expect(stub.violations).toEqual([])
  })
})

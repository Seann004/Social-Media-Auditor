import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { AUDITOR, HEAD } from './stubApi'
import { CORE_ITEMS, GUIDELINE, SEEDED_PROJECT, installCoreStub, seedCoreSession, type CoreStub } from './coreStub'

// Browser checks for viewing a project, the confirmations before destructive changes, and the sign-in guard
// (report TC-10, TC-16, TC-70, TC-71, TC-73). The backend is stubbed (coreStub); the routes it lacks
// (delete a project, toggle a category, delete a checklist item) are stubbed here and every call is recorded.

const API_ORIGIN = 'http://127.0.0.1:5198'
const PROJECT_NOTES = 'Focus on how teen accounts are set up and who can contact them.'
const CATEGORY = GUIDELINE.categories[0]
const CLONED_GUIDELINE_ID = `${SEEDED_PROJECT.id}-${GUIDELINE.guidelineId}`

type Json = Record<string, unknown>

interface ExtraOptions {
  /** Notes to give the seeded project, as if the head auditor had typed them when creating it. */
  notes?: string
}

interface ExtraStub {
  /** Project ids a DELETE was sent for. */
  projectDeletes: string[]
  /** Bodies posted to toggle a checklist category. */
  categoryToggles: { category: string; enabled: boolean; guidelineId: string }[]
  /** Checklist item ids a DELETE was sent for. */
  itemDeletes: string[]
  /** Every API call the page made, as "METHOD /path". */
  calls: string[]
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** The project's own copy of the guideline's items, in the shape GET /projects/:id/checklist answers with. */
const checklistRows = (projectId: string) =>
  CORE_ITEMS.map((it, i) => ({
    itemId: `${projectId}-${it.key}`,
    guidelineId: `${projectId}-${GUIDELINE.guidelineId}`,
    category: CATEGORY,
    itemDescription: it.text,
    severity: i % 2 === 0 ? 'major' : 'critical',
    reference: `${GUIDELINE.shortName} ${i + 1}`,
    itemName: null,
    itemCode: null,
    rowType: null,
    helpText: null,
    verbatimClauseText: null,
    answerOptions: null,
  }))

/**
 * Registered after installCoreStub, so it is asked first. It answers the routes the core stub lacks and keeps
 * their effects (a deleted project, a disabled category, a deleted item) in what later reads return.
 * Anything else falls through to the core stub.
 */
async function installExtraRoutes(page: Page, core: CoreStub, options: ExtraOptions = {}): Promise<ExtraStub> {
  const extra: ExtraStub = { projectDeletes: [], categoryToggles: [], itemDeletes: [], calls: [] }
  const projectId = SEEDED_PROJECT.id
  let deletedProjects = new Set<string>()
  let disabledCategories = new Set<string>()
  let deletedItems = new Set<string>()

  /** The seeded project as GET /projects lists it, with any notes from the options. */
  const listRow = (): Json[] => {
    const state = core.project(projectId)
    if (!state || deletedProjects.has(projectId)) return []
    const { scope: _scope, ...rest } = state
    return [{
      ...rest,
      projectNotes: options.notes ?? rest.projectNotes,
      guidelineIds: rest.guidelineIds.map((g) => `${projectId}-${g}`),
    }]
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== API_ORIGIN) return route.fallback()
    const method = request.method()
    const path = url.pathname.replace(/^\/api/, '')
    extra.calls = [...extra.calls, `${method} ${path}`]

    if (method === 'GET' && path === '/projects') return json(route, listRow())
    if (path === `/projects/${projectId}` && deletedProjects.has(projectId)) {
      return json(route, { error: 'That project was not found.' }, 404)
    }
    if (method === 'DELETE' && path === `/projects/${projectId}`) {
      extra.projectDeletes = [...extra.projectDeletes, projectId]
      deletedProjects = new Set([...deletedProjects, projectId])
      return json(route, { success: true })
    }
    if (method === 'POST' && path === `/projects/${projectId}/checklist/categories/toggle`) {
      const body = request.postDataJSON() as ExtraStub['categoryToggles'][number]
      extra.categoryToggles = [...extra.categoryToggles, body]
      disabledCategories = body.enabled
        ? new Set([...disabledCategories].filter((c) => c !== body.category))
        : new Set([...disabledCategories, body.category])
      return json(route, { success: true })
    }
    if (method === 'GET' && path === `/projects/${projectId}/checklist`) {
      return json(route, checklistRows(projectId).filter((r) => !disabledCategories.has(r.category) && !deletedItems.has(r.itemId)))
    }
    const itemDelete = /^\/checklist\/items\/([^/]+)$/.exec(path)
    if (method === 'DELETE' && itemDelete) {
      extra.itemDeletes = [...extra.itemDeletes, itemDelete[1]]
      deletedItems = new Set([...deletedItems, itemDelete[1]])
      return json(route, { success: true })
    }
    return route.fallback()
  })
  return extra
}

/**
 * The core stub lets only port 5199 through to the app server. Registered last, so it wins: the app's own
 * files load whatever port this run serves them on.
 */
async function allowAppOrigin(page: Page, baseURL: string | undefined): Promise<void> {
  const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:5199').origin
  await page.route((url) => url.origin === appOrigin, (route) => route.continue())
}

/** Core stub, the extra routes and a signed-in session, in the order that gives the extra routes priority. */
async function setUp(page: Page, baseURL: string | undefined, user: typeof HEAD, options: ExtraOptions = {}) {
  const core = await installCoreStub(page, { project: 'in_progress' })
  const extra = await installExtraRoutes(page, core, options)
  await allowAppOrigin(page, baseURL)
  await seedCoreSession(page, user)
  return { core, extra }
}

/** One checklist row on the audit page. */
const row = (page: Page, index: number): Locator => page.locator('div.px-6.py-5').filter({ hasText: CORE_ITEMS[index].text })

async function expectAllItemsShown(page: Page): Promise<void> {
  for (const item of CORE_ITEMS) await expect(page.getByText(item.text)).toBeVisible()
}

async function expectNoItemsShown(page: Page): Promise<void> {
  for (const item of CORE_ITEMS) await expect(page.getByText(item.text)).toHaveCount(0)
}

test.describe('Project safety', () => {
  test('TC-10 (FR-006): an assigned auditor opening a project sees its platform, guideline, status, notes and checklist', async ({ page, baseURL }) => {
    const { core, extra } = await setUp(page, baseURL, AUDITOR, { notes: PROJECT_NOTES })
    await page.goto('/projects')
    await page.getByRole('main').getByRole('link', { name: new RegExp(SEEDED_PROJECT.title) }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${SEEDED_PROJECT.id}$`))

    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { name: SEEDED_PROJECT.title, level: 1 })).toBeVisible()
    await expect(main.getByText(SEEDED_PROJECT.platform, { exact: true })).toBeVisible()
    await expect(main.getByText('In Progress', { exact: true }).first()).toBeVisible()
    await expect(main.getByText(PROJECT_NOTES)).toBeVisible()
    await expectAllItemsShown(page)

    // What is shown came from the project's own checklist and details, and opening it changed nothing. The one
    // write allowed is the on-load fill-in of same-requirement items (AuditPage); here it fills nothing.
    const fillIn = `POST /projects/${SEEDED_PROJECT.id}/suggestions/fill-in`
    expect(extra.calls).toContain(`GET /projects/${SEEDED_PROJECT.id}/checklist`)
    expect(extra.calls).toContain(`GET /projects/${SEEDED_PROJECT.id}`)
    expect(extra.calls.filter((c) => !c.startsWith('GET ') && c !== fillIn)).toEqual([])
    expect(core.answers(SEEDED_PROJECT.id)).toEqual([])
    expect(core.violations).toEqual([])

    // The guideline the project is audited against, checked last: by its name or short name (not the "OSC 1" clause references).
    await expect(main.getByText(GUIDELINE.guidelineName).or(main.getByText(GUIDELINE.shortName, { exact: true })).first()).toBeVisible()
  })

  test('TC-16 (FR-010): disabling a category asks first, Cancel keeps it, and enabling brings its items back', async ({ page, baseURL }) => {
    const { core, extra } = await setUp(page, baseURL, HEAD)
    await page.goto(`/projects/${SEEDED_PROJECT.id}`)
    await expectAllItemsShown(page)

    const disable = page.getByRole('checkbox', { name: `Disable category ${CATEGORY}` })
    const enable = page.getByRole('checkbox', { name: `Enable category ${CATEGORY}` })
    const prompt = page.getByRole('dialog', { name: 'Disable this category?' })
    await expect(disable).toBeChecked()

    // 1-2. Untick, then Cancel: nothing is sent and nothing changes.
    await disable.click()
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText(`${CATEGORY} and its checklist items will be removed`)
    await prompt.getByRole('button', { name: 'Cancel' }).click()
    await expect(prompt).toBeHidden()
    await expect(disable).toBeChecked()
    await expectAllItemsShown(page)
    expect(extra.categoryToggles).toEqual([])

    // 3. Untick again and confirm: the category is disabled and its items leave the checklist.
    await disable.click()
    await prompt.getByRole('button', { name: 'Disable' }).click()
    await expect(prompt).toBeHidden()
    await expect(enable).not.toBeChecked()
    await expectNoItemsShown(page)
    await expect(page.getByText('No checklist items in this category.')).toBeVisible()
    expect(extra.categoryToggles).toEqual([{ category: CATEGORY, enabled: false, guidelineId: CLONED_GUIDELINE_ID }])

    // 4. Tick it again: no prompt, the category is enabled and its items come back.
    await enable.click()
    await expect(disable).toBeChecked()
    await expect(prompt).toBeHidden()
    await expectAllItemsShown(page)
    expect(extra.categoryToggles).toEqual([
      { category: CATEGORY, enabled: false, guidelineId: CLONED_GUIDELINE_ID },
      { category: CATEGORY, enabled: true, guidelineId: CLONED_GUIDELINE_ID },
    ])
    expect(core.violations).toEqual([])
  })

  test('TC-70 (NFR-02): Delete Project asks first, Cancel keeps the project and confirming deletes it', async ({ page, baseURL }) => {
    const { core, extra } = await setUp(page, baseURL, HEAD)
    await page.goto(`/projects/${SEEDED_PROJECT.id}`)
    const title = page.getByRole('main').getByRole('heading', { name: SEEDED_PROJECT.title, level: 1 })
    await expect(title).toBeVisible()
    const dialog = page.getByRole('dialog', { name: 'Delete Project' })

    // 1-2. Delete Project, then Cancel: no delete is sent and the project stays open.
    await page.getByRole('button', { name: 'Delete Project' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`Are you sure you want to delete ${SEEDED_PROJECT.title}?`)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/projects/${SEEDED_PROJECT.id}$`))
    await expect(title).toBeVisible()
    expect(extra.projectDeletes).toEqual([])

    // 3. Delete Project and confirm: the delete is sent, the page returns to the list and the project is gone.
    await page.getByRole('button', { name: 'Delete Project' }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL(/\/projects$/)
    expect(extra.projectDeletes).toEqual([SEEDED_PROJECT.id])
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(SEEDED_PROJECT.title) })).toHaveCount(0)
    expect(core.violations).toEqual([])
  })

  test('TC-71 (NFR-02): deleting a checklist item asks first and Cancel keeps it', async ({ page, baseURL }) => {
    const { core, extra } = await setUp(page, baseURL, HEAD)
    await page.goto(`/projects/${SEEDED_PROJECT.id}`)
    await expectAllItemsShown(page)
    const first = row(page, 0)
    const question = first.getByText('Delete this checklist item permanently?')

    // 1. Delete an item: a confirmation shows and nothing is sent yet.
    await first.getByRole('button', { name: 'Delete checklist item' }).click()
    await expect(question).toBeVisible()
    expect(extra.itemDeletes).toEqual([])

    // 2. Cancel: the confirmation closes, the item is still there and no delete was sent.
    await first.getByRole('button', { name: 'Cancel' }).click()
    await expect(question).toBeHidden()
    await expectAllItemsShown(page)
    expect(extra.itemDeletes).toEqual([])
    expect(extra.calls.filter((c) => c.startsWith('DELETE '))).toEqual([])

    // Beyond the report's steps: the same prompt's Delete does send it, so the check above could have caught one.
    await first.getByRole('button', { name: 'Delete checklist item' }).click()
    await first.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText(CORE_ITEMS[0].text)).toHaveCount(0)
    expect(extra.itemDeletes).toEqual([`${SEEDED_PROJECT.id}-${CORE_ITEMS[0].key}`])
    await expect(page.getByText(CORE_ITEMS[1].text)).toBeVisible()
    expect(core.violations).toEqual([])
  })

  test('TC-73 (NFR-03): every app page shows the sign-in page when nobody is signed in', async ({ page, baseURL }) => {
    const core = await installCoreStub(page, { project: 'in_progress' })
    await allowAppOrigin(page, baseURL)
    const apiCalls: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith(API_ORIGIN)) apiCalls.push(`${request.method()} ${new URL(request.url()).pathname}`)
    })

    for (const path of ['/dashboard', '/projects', `/projects/${SEEDED_PROJECT.id}`, '/reports', '/generator']) {
      await page.goto(path)
      await expect(page, `${path} should land on sign-in`).toHaveURL(/\/$/)
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toHaveCount(0)
      await expect(page.getByText(SEEDED_PROJECT.title)).toHaveCount(0)
    }
    // No page asked the server for its data without a session.
    expect(apiCalls).toEqual([])
    expect(core.violations).toEqual([])
  })
})

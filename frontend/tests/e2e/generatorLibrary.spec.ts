import { expect, test, type Page, type Route } from '@playwright/test'
import * as XLSX from 'xlsx'
import { ADMIN, CORE_ITEMS, GUIDELINE, installCoreStub, seedCoreSession, type CoreStub } from './coreStub'

// Browser checks for the guideline generator and the guideline library (report TC-22, TC-23, TC-25, TC-27, TC-72).
// The backend is stubbed: coreStub answers sign-in data, and this file adds the guideline save and delete routes,
// with one in-test guideline list so a saved guideline shows in the next GET and a deleted one leaves it.
// Shapes follow src/lib/db.ts (createGuideline, deleteGuideline, fetchGuidelines) and backend/src/server.ts.

const API_ORIGIN = 'http://127.0.0.1:5198'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Json = Record<string, unknown>

/** The spreadsheet the report describes: two sections and three items, in the Row Type layout the generator reads. */
const FILE_NAME = 'Kids Online Safety.xlsx'
const GUIDELINE_NAME = 'Kids Online Safety'
const SHEET_ROWS = [
  ['Kids Online Safety checklist'],
  ['Row Type', 'Item ID', 'Item Name', 'Item Description', 'Help Text', 'Clause Reference'],
  ['SECTION', '1', 'Section 1 - Accounts', '', '', ''],
  ['SUBSECTION', '1.1', 'Default settings', '', '', ''],
  ['ITEM', '1.1.1', 'Private by default', 'Accounts of under-18 users must be private by default.', 'Open a new teen account.', 'KOS 1.1.1'],
  ['ITEM', '1.1.2', 'Location off', 'Location sharing is switched off by default.', 'Check the location setting.', 'KOS 1.1.2'],
  ['SECTION', '2', 'Section 2 - Messaging', '', '', ''],
  ['ITEM', '2.1', 'Read receipts', 'Read receipts are an option the child can switch off.', 'Look in the chat settings.', 'KOS 2.1'],
]

/** What the generator should make of each item: its category, clause reference and severity. */
const EXPECTED_ITEMS = [
  {
    text: 'Accounts of under-18 users must be private by default.',
    category: 'Accounts > Default settings',
    reference: 'KOS 1.1.1',
    severity: 'critical',
    helpText: 'Open a new teen account.',
  },
  {
    text: 'Location sharing is switched off by default.',
    category: 'Accounts > Default settings',
    reference: 'KOS 1.1.2',
    severity: 'major',
    helpText: 'Check the location setting.',
  },
  {
    text: 'Read receipts are an option the child can switch off.',
    category: 'Messaging',
    reference: 'KOS 2.1',
    severity: 'minor',
    helpText: 'Look in the chat settings.',
  },
] as const

const SEVERITY_LABEL = { critical: 'Critical', major: 'Major', minor: 'Minor' } as const

function excelFile(): { name: string; mimeType: string; buffer: Buffer } {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(SHEET_ROWS), 'Checklist')
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return { name: FILE_NAME, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer }
}

interface StoredGuideline {
  guideline: Json
  items: Json[]
}

interface LibraryStub {
  /** Requests this file's routes refused: a missing admin session or a body the backend would reject. */
  violations: string[]
  /** Bodies posted to save a guideline. */
  saves: Json[]
  /** Guideline ids sent to DELETE. */
  deletes: string[]
  /** How many times the guideline list was read. */
  listReads: number
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** A saved item as GET /guidelines/:id/items returns it. */
const itemRow = (guidelineId: string, item: Json) => ({
  itemId: item.id,
  guidelineId,
  category: item.category,
  itemDescription: item.text,
  severity: item.severity,
  reference: item.reference ?? null,
  itemName: item.itemName ?? null,
  itemCode: item.itemCode ?? null,
  rowType: null,
  helpText: item.helpText ?? null,
  verbatimClauseText: item.verbatimClauseText ?? null,
  answerOptions: item.answerOptions ?? null,
})

/**
 * Adds the guideline save, delete and list routes on top of the core stub. Registered after it, so these win;
 * anything they do not claim falls back to the core stub.
 */
async function installLibraryStub(page: Page, seeded: StoredGuideline[] = []): Promise<LibraryStub> {
  const stub: LibraryStub = { violations: [], saves: [], deletes: [], listReads: 0 }
  const core: Json = { ...GUIDELINE, itemCount: CORE_ITEMS.length }
  let library: StoredGuideline[] = [{ guideline: core, items: [] }, ...seeded]
  const adminAuth = `Bearer e2e-token-${ADMIN.userId}`

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== API_ORIGIN) return route.fallback()
    const method = request.method()
    const path = url.pathname.replace(/^\/api/, '')

    if (method === 'GET' && path === '/guidelines') {
      stub.listReads += 1
      return json(route, library.map((g) => ({ ...g.guideline, itemCount: g.guideline === core ? CORE_ITEMS.length : g.items.length })))
    }
    const items = /^\/guidelines\/([^/]+)\/items$/.exec(path)
    if (method === 'GET' && items && items[1] !== GUIDELINE.guidelineId) {
      const found = library.find((g) => g.guideline.guidelineId === items[1])
      return json(route, found ? found.items.map((it) => itemRow(items[1], it)) : [])
    }
    if (method === 'POST' && path === '/guidelines') {
      if (request.headers()['authorization'] !== adminAuth) {
        stub.violations.push('POST /guidelines without the admin session')
        return json(route, { error: 'You do not have permission to do this.' }, 403)
      }
      const body = request.postDataJSON() as { guideline?: Json; items?: Json[] }
      stub.saves.push(body as Json)
      if (!body.guideline?.guidelineId || !body.guideline.guidelineName || !Array.isArray(body.items)) {
        stub.violations.push('POST /guidelines with a body the backend would refuse')
        return json(route, { error: 'guideline (with guidelineId and guidelineName) is required.' }, 400)
      }
      const { userId: _userId, ...guideline } = body.guideline
      library = [...library, { guideline: { ...guideline, isDeleted: false }, items: body.items }]
      return json(route, { success: true }, 201)
    }
    const one = /^\/guidelines\/([^/]+)$/.exec(path)
    if (method === 'DELETE' && one) {
      if (request.headers()['authorization'] !== adminAuth) {
        stub.violations.push('DELETE /guidelines without the admin session')
        return json(route, { error: 'You do not have permission to do this.' }, 403)
      }
      stub.deletes.push(one[1])
      library = library.filter((g) => g.guideline.guidelineId !== one[1])
      return json(route, { success: true })
    }
    return route.fallback()
  })
  return stub
}

/**
 * The core stub lets only port 5199 through; when E2E_PORT moves the dev server, the app's own files must still load.
 * This only passes the page's own origin on to the dev server; every API request still meets a stub.
 */
async function allowAppOrigin(page: Page, baseURL: string | undefined) {
  const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:5199').origin
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === appOrigin ? route.continue() : route.fallback())
}

async function openAsAdmin(page: Page, baseURL: string | undefined, path: string, seeded: StoredGuideline[] = []) {
  const core = await installCoreStub(page, { project: 'none' })
  await allowAppOrigin(page, baseURL)
  const library = await installLibraryStub(page, seeded)
  await seedCoreSession(page, ADMIN)
  await page.goto(path)
  return { core, library }
}

/** Chooses the spreadsheet on the Excel tab and waits for the parsed checklist. */
async function uploadExcel(page: Page) {
  await expect(page.getByRole('heading', { name: 'Compliance Generator' })).toBeVisible()
  await page.locator('input[accept=".xlsx, .xls"]').setInputFiles(excelFile())
  await expect(page.getByText('Parsing Compliance Spreadsheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: GUIDELINE_NAME })).toBeVisible()
}

/** The card of the n-th generated item (1-based), found by its numbered text. */
const itemCard = (page: Page, n: number) =>
  page.getByText(`${n}. ${EXPECTED_ITEMS[n - 1].text}`, { exact: true }).locator('xpath=..')

/** A library card (the row with a guideline's name and its delete button). */
const libraryRow = (page: Page, name: string) =>
  page.getByRole('button', { name: `Delete ${name}`, exact: true })

const expectNoViolations = (core: CoreStub, library: LibraryStub) => {
  expect(core.violations).toEqual([])
  expect(library.violations).toEqual([])
}

test.describe('Guideline generator and library', () => {
  // The first page load waits for Vite to compile the app (xlsx, pdf.js); that alone can pass a minute on a busy machine.
  test.describe.configure({ timeout: 120_000 })

  test('TC-22 (FR-015): an Excel guideline with 2 sections and 3 items is read and its items are shown', async ({ page, baseURL }) => {
    const { core, library } = await openAsAdmin(page, baseURL, '/generator')
    await uploadExcel(page)

    // The chosen file is named in the upload box, and the parsed guideline is shown with its three items.
    await expect(page.getByText(FILE_NAME, { exact: true })).toBeVisible()
    await expect(page.getByText(`Guideline framework imported from file ${FILE_NAME}.`)).toBeVisible()
    await expect(page.getByText('Framework Items').locator('xpath=following-sibling::p[1]')).toHaveText('3')
    for (const [i, item] of EXPECTED_ITEMS.entries()) {
      await expect(page.getByText(`${i + 1}. ${item.text}`, { exact: true })).toBeVisible()
    }
    await expect(page.getByText(/^4\. /)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Save as Guideline/ })).toBeEnabled()

    // Reading the file happens in the browser: nothing is saved until the Admin asks.
    expect(library.saves).toEqual([])
    expectNoViolations(core, library)
  })

  test('TC-23 (FR-016): the checklist generated from the Excel file has 3 items in Accounts > Default settings and Messaging, with clause references and severity, and is saved', async ({ page, baseURL }) => {
    const { core, library } = await openAsAdmin(page, baseURL, '/generator')
    await uploadExcel(page)

    // Categories and clause references on each card.
    for (let n = 1; n <= 2; n++) {
      const card = itemCard(page, n)
      await expect(card.getByText('Accounts', { exact: true })).toBeVisible()
      await expect(card.getByText('Default settings', { exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: EXPECTED_ITEMS[n - 1].reference, exact: true })).toBeVisible()
    }
    const messaging = itemCard(page, 3)
    await expect(messaging.getByText('Messaging', { exact: true })).toBeVisible()
    await expect(messaging.getByText('Default settings', { exact: true })).toHaveCount(0)
    await expect(messaging.getByRole('button', { name: EXPECTED_ITEMS[2].reference, exact: true })).toBeVisible()

    // Severity, shown in each item's Help details.
    for (const [i, item] of EXPECTED_ITEMS.entries()) {
      await itemCard(page, i + 1).getByRole('button', { name: 'Help', exact: true }).click()
      await expect(page.getByText('Help & Audit Guidance', { exact: true })).toBeVisible()
      await expect(page.getByText('CHECKLIST QUESTION', { exact: true }).locator('xpath=following-sibling::p[1]')).toHaveText(item.text)
      await expect(page.getByText('SEVERITY', { exact: true }).locator('xpath=following-sibling::*[1]')).toHaveText(SEVERITY_LABEL[item.severity])
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await expect(page.getByText('Help & Audit Guidance', { exact: true })).toHaveCount(0)
    }

    await page.getByRole('button', { name: /Save as Guideline/ }).click()
    await expect(page).toHaveURL(/\/guidelines$/)

    // Exactly one save, carrying the guideline and its three items as the backend expects them.
    expect(library.saves).toHaveLength(1)
    const body = library.saves[0] as { guideline: Json; items: Json[] }
    expect(body.guideline).toMatchObject({
      guidelineName: GUIDELINE_NAME,
      shortName: 'KIDS-ONLIN',
      version: '1.0 (Excel Import)',
      description: `Guideline framework imported from file ${FILE_NAME}.`,
      source: 'Excel Upload',
      categories: ['Accounts > Default settings', 'Messaging'],
      userId: ADMIN.userId,
    })
    expect(String(body.guideline.guidelineId)).toMatch(UUID)
    expect(body.items).toHaveLength(3)
    body.items.forEach((sent, i) => {
      const { text, category, reference, severity, helpText } = EXPECTED_ITEMS[i]
      expect(sent).toMatchObject({ text, category, reference, severity, helpText })
      expect(String(sent.id)).toMatch(UUID)
    })
    expect(new Set(body.items.map((it) => it.id)).size).toBe(3)
    expectNoViolations(core, library)
  })

  test('TC-25 (FR-017): the guideline saved from the Excel file is listed in the library next to the existing one', async ({ page, baseURL }) => {
    const { core, library } = await openAsAdmin(page, baseURL, '/generator')
    await uploadExcel(page)

    const readsBefore = library.listReads
    expect(readsBefore).toBeGreaterThan(0)
    await page.getByRole('button', { name: /Save as Guideline/ }).click()
    await expect(page).toHaveURL(/\/guidelines$/)
    expect(library.saves).toHaveLength(1)

    // The Admin has no "Guidelines" menu entry; the Admin's Dashboard is the guideline library. Opening it reads the
    // list from the server again, so the new guideline must come back from the saved data, not the page's memory.
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect.poll(() => library.listReads).toBeGreaterThan(readsBefore)

    await expect(page.getByRole('heading', { name: 'Guidelines', exact: true })).toBeVisible()
    await expect(libraryRow(page, GUIDELINE.guidelineName)).toBeVisible()
    await expect(libraryRow(page, GUIDELINE_NAME)).toBeVisible()
    await expect(page.getByText('Regulatory frameworks loaded').locator('xpath=preceding-sibling::p[1]')).toHaveText('2')

    // The new guideline's row shows its three items and two categories, as saved.
    const newRow = page.getByRole('button', { name: new RegExp(`^${GUIDELINE_NAME}`) })
    await expect(newRow).toContainText('3items')
    await expect(newRow).toContainText('2 categories')
    await newRow.click()
    await expect(page.getByText('1. Accounts', { exact: true })).toBeVisible()
    await expect(page.getByText('2. Messaging', { exact: true })).toBeVisible()
    await expect(page.getByText('1.1 Default settings', { exact: true })).toBeVisible()
    expectNoViolations(core, library)
  })

  test('TC-27 (FR-018) and TC-72 (NFR-02): deleting a guideline asks first; Cancel deletes nothing, confirming deletes it and removes it from the list', async ({ page, baseURL }) => {
    const saved: StoredGuideline = {
      guideline: {
        guidelineId: 'g-kos',
        guidelineName: GUIDELINE_NAME,
        shortName: 'KIDS-ONLIN',
        version: '1.0 (Excel Import)',
        description: `Guideline framework imported from file ${FILE_NAME}.`,
        source: 'Excel Upload',
        lastUpdated: '2026-11-20',
        categories: ['Accounts > Default settings', 'Messaging'],
        isDeleted: false,
      },
      items: EXPECTED_ITEMS.map((it, i) => ({ ...it, id: `kos-${i + 1}` })),
    }
    const { core, library } = await openAsAdmin(page, baseURL, '/dashboard', [saved])
    const target = GUIDELINE.guidelineName
    const confirmText = page.getByText(/Permanently delete .* and all its checklist items\? This cannot be undone\./)
    await expect(libraryRow(page, target)).toBeVisible()
    await expect(libraryRow(page, GUIDELINE_NAME)).toBeVisible()

    // 1. Click Delete: the page asks before deleting anything.
    await libraryRow(page, target).click()
    await expect(confirmText).toBeVisible()
    await expect(confirmText).toContainText(target)
    expect(library.deletes).toEqual([])

    // 2. Cancel: the question goes away and nothing is deleted.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmText).toHaveCount(0)
    await expect(libraryRow(page, target)).toBeVisible()
    await expect(libraryRow(page, GUIDELINE_NAME)).toBeVisible()
    expect(library.deletes).toEqual([])

    // 3. Click Delete and confirm: one DELETE for that guideline only, and it leaves the list.
    await libraryRow(page, target).click()
    await expect(confirmText).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(() => library.deletes).toEqual([GUIDELINE.guidelineId])
    await expect(libraryRow(page, target)).toHaveCount(0)
    await expect(confirmText).toHaveCount(0)
    await expect(libraryRow(page, GUIDELINE_NAME)).toBeVisible()
    await expect(page.getByText('Regulatory frameworks loaded').locator('xpath=preceding-sibling::p[1]')).toHaveText('1')

    // Still gone when the list is read from the server again.
    const readsBefore = library.listReads
    await page.reload()
    await expect.poll(() => library.listReads).toBeGreaterThan(readsBefore)
    await expect(libraryRow(page, GUIDELINE_NAME)).toBeVisible()
    await expect(libraryRow(page, target)).toHaveCount(0)
    expect(library.deletes).toEqual([GUIDELINE.guidelineId])
    expectNoViolations(core, library)
  })
})

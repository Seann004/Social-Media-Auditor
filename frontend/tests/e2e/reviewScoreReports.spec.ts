import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { AUDITOR, HEAD, answeredCount } from './stubApi'
import { CORE_ITEMS, GUIDELINE, SEEDED_PROJECT, installCoreStub, seedCoreSession, switchCoreSession, type CoreSeed, type CoreStub } from './coreStub'

/** One API request the page sent, as the recorder saw it. */
interface SentRequest {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024
const ITEM_ID = (index: number) => `${SEEDED_PROJECT.id}-${CORE_ITEMS[index].key}`
const CATEGORY = GUIDELINE.categories[0]

/** One checklist row on the audit page. */
const row = (page: Page, index: number): Locator => page.locator('div.px-6.py-5').filter({ hasText: CORE_ITEMS[index].text })
/** An answer button in a row. Exact, so "No" never matches "Add note". */
const answer = (page: Page, index: number, label: string): Locator => row(page, index).getByRole('button', { name: label, exact: true })
/** A figure in the audit header, found by the small label under it ("Compliance", "Passing", "Failing"). */
const headerFigure = (page: Page, label: string): Locator =>
  page.getByText(label, { exact: true }).locator('xpath=preceding-sibling::p[1]')
/** The category entry in the desktop sidebar ("1.1 Accounts" with its answered count). */
const sidebarCategory = (page: Page): Locator => page.getByRole('button', { name: new RegExp(`^1\\.1 ${CATEGORY}`) })
/** The category entry in the phone-width category picker, which carries the category's score. */
const pickerCategory = (page: Page): Locator => page.locator('#mobile-category-select option').filter({ hasText: CATEGORY })
const reportButton = (page: Page, title: string): Locator => page.getByRole('button', { name: new RegExp(title) })

/**
 * The core stub lets only http://127.0.0.1:5199 through as the app. When E2E_PORT moves the dev server,
 * the app's own files are let through here too; every other request still reaches the core stub's guard.
 */
async function installStub(page: Page, baseURL: string | undefined, seed: CoreSeed): Promise<CoreStub> {
  const stub = await installCoreStub(page, seed)
  const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:5199').origin
  await page.route((url) => url.origin === appOrigin, (route) => route.continue())
  return stub
}

/**
 * Records every API request the page sends, then hands it on to the core stub. Registered after
 * installCoreStub, so it runs first. `handle` may answer a request itself; otherwise it falls through.
 */
async function recordApi(page: Page, handle?: (route: Route, sent: SentRequest) => Promise<void> | null): Promise<SentRequest[]> {
  const sent: SentRequest[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    let body: unknown = null
    try {
      body = request.postDataJSON()
    } catch {
      body = request.postData()
    }
    const entry: SentRequest = { method: request.method(), path: url.pathname.replace(/^\/api/, ''), query: url.searchParams, body }
    sent.push(entry)
    const handled = handle?.(route, entry)
    if (handled) return handled
    return route.fallback()
  })
  return sent
}

const resultPosts = (sent: SentRequest[]) =>
  sent.filter((r) => r.method === 'POST' && r.path === `/projects/${SEEDED_PROJECT.id}/results`).map((r) => r.body)

/**
 * A cold dev server (or several running side by side) can take well over a minute to serve the app's modules,
 * so navigation waits only for the document and the first render gets a long allowance. The checks after it do not.
 */
const FIRST_RENDER = { timeout: 150_000 }
async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'commit', timeout: FIRST_RENDER.timeout })
}
async function reloadApp(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'commit', timeout: FIRST_RENDER.timeout })
}

async function openSeededAudit(page: Page): Promise<void> {
  await gotoApp(page, `/projects/${SEEDED_PROJECT.id}`)
  await expect(page.getByRole('heading', { name: SEEDED_PROJECT.title, level: 1 })).toBeVisible(FIRST_RENDER)
  await expect(row(page, 0)).toBeVisible(FIRST_RENDER)
}

test.describe('Review, score and reports', () => {
  test.describe.configure({ timeout: 300_000 })

  test('TC-46 (FR-029): the head auditor rejects a submission with remarks and the rejection banner shows them', async ({ page, baseURL }) => {
    const stub = await installStub(page, baseURL, { project: 'pending_review' })
    await seedCoreSession(page, HEAD)
    await openSeededAudit(page)
    await expect(page.getByText('Audit Submitted for Review')).toBeVisible()
    await expect(page.getByText('Pending Review', { exact: true })).toBeVisible()

    // 1. Review Submission  2. Enter remarks  3. Reject
    await page.getByRole('button', { name: 'Review Submission' }).click()
    const remarks = 'Item 2 has no evidence of the stranger-messaging block. Add a screenshot and resubmit.'
    await page.getByLabel('Review Remarks').fill(remarks)
    expect(stub.reviews).toEqual([])
    await page.getByRole('button', { name: 'Reject', exact: true }).click()

    // The rejection and the remarks reach the server exactly as typed.
    await expect.poll(() => stub.reviews).toEqual([{ projectId: SEEDED_PROJECT.id, approved: false, remarks }])
    expect(stub.project(SEEDED_PROJECT.id)).toMatchObject({ submissionStatus: 'rejected', projectStatus: 'in_progress', submissionRemarks: remarks })

    // The review panel closes and the rejection banner carries the remarks.
    const banner = page.locator('div.bg-rose-50').filter({ hasText: 'Submission Rejected' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(remarks)
    await expect(page.getByText('Audit Submitted for Review')).toHaveCount(0)
    await expect(page.getByLabel('Review Remarks')).toHaveCount(0)
    await expect(page.getByText('Rejected', { exact: true })).toBeVisible()

    // A fresh load reads the rejection back from the server.
    await reloadApp(page)
    await expect(banner).toBeVisible(FIRST_RENDER)
    await expect(banner).toContainText(remarks)

    // The auditor sees the same banner and remarks, and can resubmit.
    await switchCoreSession(page, AUDITOR)
    await reloadApp(page)
    await expect(banner).toBeVisible(FIRST_RENDER)
    await expect(banner).toContainText(remarks)
    await expect(page.getByRole('button', { name: 'Resubmit for Review' })).toBeVisible()
    expect(stub.reviews).toHaveLength(1)
    expect(stub.violations).toEqual([])
  })

  test('TC-55 (FR-035): a photo over 5 MB is refused with its name and nothing is uploaded', async ({ page, baseURL }) => {
    const stub = await installStub(page, baseURL, { project: 'in_progress' })
    const uploads: SentRequest[] = []
    const evidencePath = new RegExp(`^/projects/${SEEDED_PROJECT.id}/results/([^/]+)/evidence$`)
    await recordApi(page, (route, sent) => {
      if (sent.method !== 'PATCH' || !evidencePath.test(sent.path)) return null
      uploads.push(sent)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    })
    await seedCoreSession(page, AUDITOR)
    await openSeededAudit(page)

    // Pre: the item is answered.
    await answer(page, 0, 'Yes').click()
    await expect(answer(page, 0, 'Yes')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => stub.answers(SEEDED_PROJECT.id).map((a) => a.result)).toEqual(['compliant'])

    // 1. Add photo  2. Choose a PNG of 5 MB plus 1 byte.
    const tooBig = 'too-big-screenshot.png'
    const chooser = page.waitForEvent('filechooser')
    await row(page, 0).getByRole('button', { name: 'Add photo' }).click()
    await (await chooser).setFiles({ name: tooBig, mimeType: 'image/png', buffer: Buffer.alloc(MAX_EVIDENCE_BYTES + 1) })

    const alert = page.getByRole('alert').filter({ hasText: 'too large (max 5 MB)' })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(`File too large (max 5 MB): ${tooBig}`)
    await expect(row(page, 0).getByRole('button', { name: 'Add photo' })).toBeVisible()
    await expect(row(page, 0).getByRole('img', { name: tooBig })).toHaveCount(0)

    // A photo of exactly 5 MB is accepted and uploaded, which proves the recorder would have caught the big one.
    const justFits = 'just-fits-screenshot.png'
    const second = page.waitForEvent('filechooser')
    await row(page, 0).getByRole('button', { name: 'Add photo' }).click()
    expect(uploads).toHaveLength(0)
    await (await second).setFiles({ name: justFits, mimeType: 'image/png', buffer: Buffer.alloc(MAX_EVIDENCE_BYTES) })
    await expect(alert).toHaveCount(0)
    await expect(row(page, 0).getByRole('button', { name: '1 photo' })).toBeVisible()
    await expect.poll(() => uploads.length).toBe(1)
    const uploaded = uploads[0].body as { userId: string; images: { name: string; url: string }[] }
    expect(uploads[0].path).toBe(`/projects/${SEEDED_PROJECT.id}/results/${ITEM_ID(0)}/evidence`)
    expect(uploaded.userId).toBe(AUDITOR.userId)
    expect(uploaded.images.map((i) => i.name)).toEqual([justFits])
    expect(uploaded.images[0].url).toMatch(/^data:image\/png;base64,/)
    // The oversized file was never sent, on its own or alongside the accepted one.
    expect(JSON.stringify(uploads.map((u) => u.body))).not.toContain(tooBig)
    expect(stub.violations).toEqual([])
  })

  test('TC-60 (FR-038): the compliance score is recomputed after each answer', async ({ page, baseURL }) => {
    const stub = await installStub(page, baseURL, { project: 'in_progress' })
    const sent = await recordApi(page)
    await seedCoreSession(page, AUDITOR)
    await openSeededAudit(page)
    const score = headerFigure(page, 'Compliance')

    // Pre: nothing answered.
    await expect(answeredCount(page)).toHaveText(`0/${CORE_ITEMS.length}`)
    await expect(score).toHaveText('0%')
    expect(resultPosts(sent)).toEqual([])

    // 1. Answer Yes: one applicable item, passing.
    await answer(page, 0, 'Yes').click()
    await expect(score).toHaveText('100%')
    await expect.poll(() => resultPosts(sent)).toEqual([expect.objectContaining({ itemId: ITEM_ID(0), result: 'compliant' })])

    // 2. Answer No: one of two applicable items passing.
    await answer(page, 1, 'No').click()
    await expect(score).toHaveText('50%')
    await expect.poll(() => resultPosts(sent).length).toBe(2)
    expect(resultPosts(sent)[1]).toMatchObject({ itemId: ITEM_ID(1), result: 'non_compliant' })

    // 3. Answer N/A: not applicable items do not count, so the score stays at 50%.
    await answer(page, 2, 'N/A').click()
    await expect(answeredCount(page)).toHaveText(`3/${CORE_ITEMS.length}`)
    await expect(score).toHaveText('50%')
    await expect.poll(() => resultPosts(sent).length).toBe(3)
    expect(resultPosts(sent)[2]).toMatchObject({ itemId: ITEM_ID(2), result: 'not_applicable' })

    // The score is worked out in the browser; a fresh load from the saved answers gives the same number.
    expect(stub.answers(SEEDED_PROJECT.id).map((a) => [a.itemId, a.result])).toEqual([
      [ITEM_ID(0), 'compliant'],
      [ITEM_ID(1), 'non_compliant'],
      [ITEM_ID(2), 'not_applicable'],
    ])
    await reloadApp(page)
    await expect(answeredCount(page)).toHaveText(`3/${CORE_ITEMS.length}`, FIRST_RENDER)
    await expect(score).toHaveText('50%')
    expect(stub.violations).toEqual([])
  })

  test('TC-61 (FR-039): score, progress, passing and failing counts and the category score are shown', async ({ page, baseURL }) => {
    const stub = await installStub(page, baseURL, { project: 'in_progress' })
    const sent = await recordApi(page)
    await seedCoreSession(page, AUDITOR)
    await openSeededAudit(page)
    const total = CORE_ITEMS.length

    const expectFigures = async (step: { score: string; answered: number; passing: number; failing: number; category: string }) => {
      await expect(headerFigure(page, 'Compliance')).toHaveText(step.score)
      await expect(answeredCount(page)).toHaveText(`${step.answered}/${total}`)
      await expect(headerFigure(page, 'Passing')).toHaveText(String(step.passing))
      await expect(headerFigure(page, 'Failing')).toHaveText(String(step.failing))
      // Desktop sidebar: the category's progress.
      await expect(sidebarCategory(page)).toContainText(`${step.answered}/${total}`)
      // Category picker: the category's own score.
      await expect(pickerCategory(page)).toHaveText(`1.1 ${CATEGORY}${step.category}`)
    }

    await expectFigures({ score: '0%', answered: 0, passing: 0, failing: 0, category: '' })
    await answer(page, 0, 'Yes').click()
    await expectFigures({ score: '100%', answered: 1, passing: 1, failing: 0, category: ' (100%)' })
    await answer(page, 1, 'No').click()
    await expectFigures({ score: '50%', answered: 2, passing: 1, failing: 1, category: ' (50%)' })
    await answer(page, 2, 'N/A').click()
    await expectFigures({ score: '50%', answered: 3, passing: 1, failing: 1, category: ' (50%)' })
    await expect(page.getByText('1 item remaining')).toBeVisible()

    // Each answer was saved on the server.
    await expect.poll(() => resultPosts(sent).length).toBe(3)
    expect(stub.answers(SEEDED_PROJECT.id).map((a) => a.result)).toEqual(['compliant', 'non_compliant', 'not_applicable'])

    // The category's score is only printed in the category picker, which the page shows at phone width.
    await page.setViewportSize({ width: 390, height: 844 })
    const picker = page.getByLabel('Checklist category')
    await expect(picker).toBeVisible()
    await expect(picker.locator('option:checked')).toHaveText(`1.1 ${CATEGORY} (50%)`)
    expect(stub.violations).toEqual([])
  })

  test.describe('reports filter', () => {
    // A fixed time zone, so the date range the page sends is the same on any machine.
    test.use({ timezoneId: 'Asia/Kuala_Lumpur' })

    test('TC-64 (FR-041): search and date filters narrow the reports, and Clear filters brings both back', async ({ page, baseURL }) => {
      const stub = await installStub(page, baseURL, { project: 'pending_review' })
      const october = {
        projectId: 'p-oct',
        projectTitle: 'Autumn Messaging Check',
        smPlatform: 'YouTube',
        projectStatus: 'completed',
        submissionStatus: 'approved',
        submissionRemarks: null,
        headAuditorId: HEAD.userId,
        headAuditorName: HEAD.userName,
        timeCreated: '2026-10-15T03:00:00.000Z',
        updatedAt: '2026-10-16T03:00:00.000Z',
        dueDate: null,
        scorePercentage: 75,
        guidelineIds: [],
      }
      // GET /reports filters on the server, so this stub filters as backend fetchAuditReports does:
      // title or platform contains the search, and the report's time is within [dateFrom, dateTo].
      const sent = await recordApi(page, (route, req) => {
        if (req.method !== 'GET' || req.path !== '/reports') return null
        const seeded = stub.project(SEEDED_PROJECT.id)!
        const november = {
          ...october,
          projectId: seeded.projectId,
          projectTitle: seeded.projectTitle,
          smPlatform: seeded.smPlatform,
          projectStatus: seeded.projectStatus,
          submissionStatus: seeded.submissionStatus,
          timeCreated: '2026-11-10T03:00:00.000Z',
          updatedAt: seeded.updatedAt,
          scorePercentage: 50,
        }
        const search = (req.query.get('search') ?? '').toLowerCase()
        const from = req.query.get('dateFrom')
        const to = req.query.get('dateTo')
        const rows = [november, october]
          .filter((r) => !search || `${r.projectTitle} ${r.smPlatform}`.toLowerCase().includes(search))
          .filter((r) => !from || new Date(r.timeCreated) >= new Date(from))
          .filter((r) => !to || new Date(r.timeCreated) <= new Date(to))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
      })
      const reportQueries = () => sent.filter((r) => r.method === 'GET' && r.path === '/reports').map((r) => Object.fromEntries(r.query))
      await seedCoreSession(page, HEAD)
      await gotoApp(page, '/reports')
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible(FIRST_RENDER)

      const count = page.getByRole('status').filter({ hasText: /report/ })
      const teen = reportButton(page, SEEDED_PROJECT.title)
      const autumn = reportButton(page, october.projectTitle)
      await expect(count).toHaveText('2 reports')
      await expect(teen).toBeVisible()
      await expect(autumn).toBeVisible()

      // 1. Search "teen": one report.
      const search = page.getByLabel('Search reports')
      await search.fill('teen')
      await expect(count).toHaveText('1 report matching "teen"')
      await expect(teen).toBeVisible()
      await expect(autumn).toHaveCount(0)
      expect(reportQueries().at(-1)).toEqual({ search: 'teen' })

      // 2. Clear it and set 1 to 31 October: only the October report.
      await search.fill('')
      await page.getByRole('button', { name: 'Toggle date filters' }).click()
      await page.getByLabel('From date').fill('2026-10-01')
      await page.getByLabel('To date').fill('2026-10-31')
      await expect(count).toHaveText('1 report')
      await expect(autumn).toBeVisible()
      await expect(autumn).toContainText('15 Oct 2026')
      await expect(teen).toHaveCount(0)
      // The whole of each day in the page's time zone (UTC+8).
      expect(reportQueries().at(-1)).toEqual({ dateFrom: '2026-09-30T16:00:00.000Z', dateTo: '2026-10-31T15:59:59.999Z' })

      // 3. Clear filters: both again, and the inputs are empty.
      await page.getByRole('button', { name: 'Clear filters' }).click()
      await expect(count).toHaveText('2 reports')
      await expect(teen).toBeVisible()
      await expect(autumn).toBeVisible()
      await expect(search).toHaveValue('')
      await expect(page.getByLabel('From date')).toHaveValue('')
      await expect(page.getByLabel('To date')).toHaveValue('')
      expect(reportQueries().at(-1)).toEqual({})
      expect(stub.violations).toEqual([])
    })
  })

  test('TC-66 (FR-043): Print on an open report opens the browser print dialog', async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      const calls: number[] = []
      ;(window as unknown as { __printCalls: number[] }).__printCalls = calls
      window.print = () => { calls.push(Date.now()) }
    })
    const printCalls = () => page.evaluate(() => (window as unknown as { __printCalls: number[] }).__printCalls.length)
    const stub = await installStub(page, baseURL, { project: 'pending_review' })
    const sent = await recordApi(page)
    await seedCoreSession(page, HEAD)
    await gotoApp(page, '/reports')

    const print = page.getByRole('main').getByRole('button', { name: 'Print', exact: true })
    await expect(print).toBeDisabled(FIRST_RENDER)

    // Pre: the report is open, with its scores loaded from the server.
    await reportButton(page, SEEDED_PROJECT.title).click()
    const report = page.locator('.xl\\:col-span-3')
    await expect(report.getByRole('heading', { name: SEEDED_PROJECT.title, level: 2 })).toBeVisible()
    await expect(report.getByRole('img', { name: 'Compliance score: 50%' })).toBeVisible()
    const loaded = sent.filter((r) => r.method === 'GET').map((r) => r.path)
    expect(loaded).toEqual(expect.arrayContaining([
      `/projects/${SEEDED_PROJECT.id}/compliance-scores`,
      `/projects/${SEEDED_PROJECT.id}/results`,
      `/projects/${SEEDED_PROJECT.id}/checklist`,
    ]))

    // 1. Click Print: a confirmation dialog, and no print yet.
    await expect(print).toBeEnabled()
    await print.click()
    const dialog = page.getByRole('dialog', { name: 'Print this report' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("This opens your browser's print dialog.")
    expect(await printCalls()).toBe(0)

    // 2. Click Print in the dialog: the browser print dialog is asked for, once, and the dialog closes.
    await dialog.getByRole('button', { name: 'Print' }).click()
    await expect.poll(printCalls).toBe(1)
    await expect(dialog).toHaveCount(0)

    // What prints: the print-only header names the report, and the app controls are hidden.
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByRole('heading', { name: 'SafetyAudit: Audit Report' })).toBeVisible()
    await expect(page.getByText(`${SEEDED_PROJECT.title} · ${SEEDED_PROJECT.platform}`)).toBeVisible()
    await expect(print).toBeHidden()
    expect(stub.violations).toEqual([])
  })
})

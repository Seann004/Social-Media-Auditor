import { expect, test, type Locator, type Page } from '@playwright/test'
import { AUDITOR, answeredCount, HEAD, ITEMS, PROJECT_ID, installStub, seedSession, switchSession, type Stub, type TestUser } from './stubApi'

const SHOTS = process.env.E2E_SHOTS ?? ''

/** Opens the audit page as `user` with the network stubbed. */
async function openAudit(page: Page, user: TestUser, options: { withRun: boolean; evidenceDown?: boolean }): Promise<Stub> {
  const stub = await installStub(page, options)
  await seedSession(page, user)
  await page.goto(`/projects/${PROJECT_ID}`)
  await expect(page.getByText(ITEMS[0].text)).toBeVisible()
  return stub
}

const row = (page: Page, index: number): Locator => page.locator('div.px-6.py-5').filter({ hasText: ITEMS[index].text })
const barOf = (page: Page): Locator => page.getByRole('region', { name: 'AI evidence assessment' })

/** The panel lives in a drawer opened from the slim bar at the top of the audit page. */
async function openPanel(page: Page): Promise<Locator> {
  await barOf(page).getByRole('button', { name: 'Open AI evidence' }).click()
  const panel = page.getByRole('dialog', { name: 'AI evidence assessment' })
  await expect(panel).toBeVisible()
  return panel
}

/** Closes the drawer so it no longer covers the checklist rows. */
async function closePanel(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Close AI evidence' }).click()
  await expect(panel).toBeHidden()
}

async function snap(target: Page | Locator, name: string): Promise<void> {
  if (!SHOTS) return
  await new Promise((done) => setTimeout(done, 500)) // let the entrance animation finish
  await target.screenshot({ path: `${SHOTS}/${name}.png` })
}

test.describe('AI evidence assessment', () => {
  test('auditor runs an assessment, accepts one suggestion and overrides another', async ({ page }) => {
    const stub = await openAudit(page, AUDITOR, { withRun: false })
    const panel = await openPanel(page)

    // Run: the links are saved, then progress shows, then the cards arrive.
    await panel.getByLabel('Website links (one per line)').fill('https://example.test/safety')
    await panel.getByRole('button', { name: 'Run assessment' }).click()
    await expect(panel.getByText('Capturing pages')).toBeVisible()
    await expect(panel.getByText('Pages captured: 1 of 3')).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Last run' })).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText('3 pages · 3 suggestions · 1 flagged')).toBeVisible()
    await expect(answeredCount(page)).toHaveText('0/3')
    await snap(panel, 'panel')
    await closePanel(panel)
    await expect(barOf(page).getByText('Last run: 3 suggestions · 1 flagged')).toBeVisible()

    // Nothing was answered by the suggestions alone.
    await expect(row(page, 0).getByRole('region', { name: 'AI suggestion' })).toContainText('No')
    expect(stub.decisions).toHaveLength(0)

    // The screenshot viewer sits above the page, not inside the row, and Escape closes it.
    await snap(row(page, 0), 'card')
    await row(page, 0).getByRole('button', { name: 'Enlarge screenshot' }).click()
    const viewer = page.getByRole('dialog', { name: 'Screenshot of the quoted passage' })
    const picture = viewer.getByRole('img')
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    const covered = await picture.evaluate((img) => {
      const box = img.getBoundingClientRect()
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      const overlay = img.closest('[role="dialog"]')?.parentElement
      return {
        onTop: top === img,
        overlayFixed: overlay ? getComputedStyle(overlay).position === 'fixed' : false,
        overlayFillsViewport: overlay
          ? overlay.getBoundingClientRect().width === window.innerWidth && overlay.getBoundingClientRect().height === window.innerHeight
          : false,
        inViewport: box.top >= 0 && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      }
    })
    expect(covered).toEqual({ onTop: true, overlayFixed: true, overlayFillsViewport: true, inViewport: true })
    await snap(page, 'viewer')
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()

    // Accept: the answer, the findings, the photo count and the score all move.
    await row(page, 0).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(row(page, 0).getByText('Accepted', { exact: true })).toBeVisible()
    await expect(row(page, 0).getByText('1 photo', { exact: true })).toBeVisible()
    await expect(row(page, 0).getByRole('textbox').first()).toHaveValue(/AI evidence: The sign-up page has no link/)
    await expect(answeredCount(page)).toHaveText('1/3')
    expect(stub.decisions[0]).toMatchObject({ decision: 'accepted', origin: 'card' })

    // Override: the dialog will not confirm without a reason.
    await row(page, 1).getByRole('button', { name: 'Override' }).click()
    const dialog = page.getByRole('dialog', { name: 'Override AI suggestion' })
    const confirm = dialog.getByRole('button', { name: 'Confirm override' })
    await dialog.getByText('No', { exact: true }).click()
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Reason').fill('The control is hidden behind a paywall.')
    await expect(confirm).toBeEnabled()
    await snap(dialog, 'override')
    await confirm.click()
    await expect(dialog).toBeHidden()
    await expect(row(page, 1).getByText('Overridden to No')).toBeVisible()
    await expect(row(page, 1).getByText('Reason: The control is hidden behind a paywall.')).toBeVisible()
    await expect(answeredCount(page)).toHaveText('2/3')
    expect(stub.decisions[1]).toMatchObject({ decision: 'overridden', origin: 'card', finalResult: 'non_compliant', overrideReason: 'The control is hidden behind a paywall.' })

    // The Head Auditor sees where each answer came from, on the audit and in the report.
    const accepted = 'AI suggested No · accepted'
    const overridden = 'AI suggested Yes · overridden to No: The control is hidden behind a paywall.'
    await switchSession(page, HEAD)
    await page.goto(`/projects/${PROJECT_ID}`)
    await expect(row(page, 0).getByText(accepted)).toBeVisible()
    await expect(row(page, 1).getByText(overridden)).toBeVisible()
    await page.goto('/reports')
    await page.getByRole('button', { name: /Kids Chat Audit/ }).click()
    // The report also holds a print copy of each line, hidden on screen.
    await expect(page.getByText(accepted).and(page.locator(":visible"))).toHaveCount(1)
    await expect(page.getByText(overridden).and(page.locator(":visible"))).toHaveCount(1)

    expect(stub.violations).toEqual([])
  })

  test('a flagged suggestion shows its reason and the flagged filter finds it', async ({ page }) => {
    const stub = await openAudit(page, AUDITOR, { withRun: true })

    const flagged = row(page, 2).getByRole('region', { name: 'AI suggestion' })
    await expect(flagged.getByText('Needs human review')).toBeVisible()
    await expect(flagged.getByText('The pages that mention reporting are vague.')).toBeVisible()
    await expect(row(page, 0).getByText('Needs human review')).toHaveCount(0)
    await snap(flagged, 'flagged-card')

    const toggle = page.getByRole('button', { name: 'Flagged by AI only' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(ITEMS[2].text)).toBeVisible()
    await expect(page.getByText(ITEMS[0].text)).toHaveCount(0)
    await expect(page.getByText(ITEMS[1].text)).toHaveCount(0)

    await toggle.click()
    await expect(page.getByText(ITEMS[0].text)).toBeVisible()
    await expect(page.getByText(ITEMS[1].text)).toBeVisible()
    expect(stub.violations).toEqual([])
  })

  test('the page stays usable when the evidence API answers 503', async ({ page }) => {
    const stub = await openAudit(page, AUDITOR, { withRun: false, evidenceDown: true })

    await expect(page.getByRole('alert').filter({ hasText: 'AI evidence assessment is not set up on this server.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run assessment' })).toHaveCount(0)

    // The ordinary audit still works: an answer button saves the old way.
    await row(page, 0).getByRole('button', { name: 'Yes' }).click()
    await expect(answeredCount(page)).toHaveText('1/3')
    expect(stub.savedAnswers).toHaveLength(1)
    expect(stub.savedAnswers[0]).toMatchObject({ itemId: 'i1', result: 'compliant' })
    await snap(page, 'unavailable')

    // No call to a stub that was not written, and nothing left the machine.
    expect(stub.violations).toEqual([])
  })
})

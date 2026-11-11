import { expect, test, type Locator, type Page } from '@playwright/test'
import { AUDITOR, answeredCount, ITEMS, PROJECT_ID, installStub, seedSession, type Stub } from './stubApi'

const SHOTS = process.env.E2E_SHOTS ?? ''
const PASSWORD = 'Sup3r-secret-pw-9431'

async function openAudit(page: Page, options: { evidenceDown?: boolean; appDown?: boolean } = {}): Promise<Stub> {
  const stub = await installStub(page, { withRun: false, ...options })
  await seedSession(page, AUDITOR)
  await page.goto(`/projects/${PROJECT_ID}`)
  await expect(page.getByText(ITEMS[0].text)).toBeVisible()
  return stub
}

const row = (page: Page, index: number): Locator => page.locator('div.px-6.py-5').filter({ hasText: ITEMS[index].text })
const panelOf = (page: Page): Locator => page.getByRole('region', { name: 'AI evidence assessment' })

async function snap(target: Page | Locator, name: string): Promise<void> {
  if (!SHOTS) return
  await new Promise((done) => setTimeout(done, 500)) // let the entrance animation finish
  await target.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function addAccount(panel: Locator, fields: { name: string; group: string; age: string; login: string }): Promise<void> {
  await panel.getByRole('button', { name: 'Add test account' }).click()
  await panel.getByLabel('Account name').fill(fields.name)
  await panel.getByLabel('Age group').selectOption({ label: fields.group })
  await panel.getByLabel('Age (optional)').fill(fields.age)
  await panel.getByLabel('Login name').fill(fields.login)
  await panel.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await panel.getByRole('button', { name: 'Save account' }).click()
  await expect(panel.getByText(fields.name, { exact: true })).toBeVisible()
}

async function setUpApp(page: Page): Promise<Locator> {
  const panel = panelOf(page)
  await panel.getByLabel('App (test accounts)').check()
  await panel.getByLabel('App address').fill('https://social.example.test')
  await panel.getByRole('button', { name: 'Save app address' }).click()
  await addAccount(panel, { name: 'Teen 15', group: 'Under 18', age: '15', login: 'teen15' })
  await addAccount(panel, { name: 'Adult 30', group: 'Adult', age: '30', login: 'adult30' })
  return panel
}

test.describe('AI evidence from inside the app', () => {
  test('auditor adds the app and two accounts, picks items, runs, replays a step and accepts one suggestion', async ({ page }) => {
    const stub = await openAudit(page)
    const panel = await setUpApp(page)
    expect(stub.accountBodies.map((a) => a.label)).toEqual(['Teen 15', 'Adult 30'])

    await panel.getByLabel(ITEMS[0].text).check()
    await panel.getByLabel(ITEMS[1].text).check()
    await expect(panel.getByText('Items to check (2 picked)')).toBeVisible()
    await snap(panel, 'app-panel')

    await panel.getByRole('button', { name: 'Run app check' }).click()
    expect(stub.appRunItems).toEqual([['i1', 'i2']])
    await expect(panel.getByText(`Checking in the app: ${ITEMS[0].text} · step 3 of 15`)).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Last run' })).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText('2 suggestions · 0 flagged')).toBeVisible()
    await expect(panel.getByText('Left changed')).toBeVisible()

    // Suggestions alone change nothing.
    await expect(answeredCount(page)).toHaveText('0/3')
    await expect(row(page, 0).getByRole('region', { name: 'AI suggestion' })).toContainText('No')
    expect(stub.decisions).toHaveLength(0)

    // Replay: every step with its picture, the refused one with its reason.
    await row(page, 0).getByRole('button', { name: 'Replay steps' }).click()
    const replay = page.getByRole('dialog', { name: "Replay of the AI's steps" })
    const steps = replay.getByRole('list', { name: 'Steps' }).getByRole('listitem')
    await expect(steps).toHaveCount(3)
    const picture = replay.getByRole('img', { name: 'Screenshot of step 1' })
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await snap(page, 'replay')

    await replay.getByRole('button', { name: 'Next' }).click()
    await expect(replay.getByText('Deleting an account is never allowed.')).toBeVisible()
    await expect(steps.nth(1)).toContainText('Refused')
    await expect(replay.getByText('No screenshot for this step')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(replay.getByRole('img', { name: 'Screenshot of step 3' })).toBeVisible()
    await expect(replay.getByRole('heading', { name: 'Left changed' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(replay).toBeHidden()
    expect(stub.decisions).toHaveLength(0)

    // Only a decision moves the answer and the score.
    await row(page, 0).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(row(page, 0).getByText('Accepted', { exact: true })).toBeVisible()
    await expect(answeredCount(page)).toHaveText('1/3')
    expect(stub.decisions).toHaveLength(1)
    expect(stub.violations).toEqual([])
  })

  test('the password never appears on the page after saving an account', async ({ page }) => {
    const stub = await openAudit(page)
    const panel = await setUpApp(page)

    expect(stub.accountBodies[0].password).toBe(PASSWORD) // it was sent once, to the server
    await expect(panel.getByText('Password saved')).toHaveCount(2)
    expect(await page.content()).not.toContain(PASSWORD)
    const kept = await page.evaluate(
      (secret) => ({
        inputs: [...document.querySelectorAll('input, textarea')].some((el) => (el as HTMLInputElement).value.includes(secret)),
        storage: JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret),
      }),
      PASSWORD,
    )
    expect(kept).toEqual({ inputs: false, storage: false })
    expect(stub.violations).toEqual([])
  })

  test('the page stays usable when the app endpoints answer 503', async ({ page }) => {
    const stub = await openAudit(page, { appDown: true })
    const panel = panelOf(page)

    await panel.getByLabel('App (test accounts)').check()
    await expect(panel.getByRole('alert').filter({ hasText: 'Checking inside the app is not set up on this server.' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Run app check' })).toHaveCount(0)

    // The page-based check and the ordinary audit are untouched.
    await panel.getByLabel('Public pages').check()
    await expect(panel.getByRole('button', { name: 'Run assessment' })).toBeVisible()
    await row(page, 0).getByRole('button', { name: 'Yes' }).click()
    await expect(answeredCount(page)).toHaveText('1/3')
    expect(stub.savedAnswers).toHaveLength(1)
    expect(stub.violations).toEqual([])
  })
})

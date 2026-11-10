import { expect, test, type Locator, type Page } from '@playwright/test'
import { AUDITOR, answeredCount, ITEMS, PROJECT_ID, installStub, seedSession, type Stub } from './stubApi'

async function openAudit(page: Page): Promise<Stub> {
  const stub = await installStub(page, { withRun: false })
  await seedSession(page, AUDITOR)
  await page.goto(`/projects/${PROJECT_ID}`)
  await expect(page.getByText(ITEMS[0].text)).toBeVisible()
  return stub
}

const row = (page: Page, index: number): Locator => page.locator('div.px-6.py-5').filter({ hasText: ITEMS[index].text })
const panelOf = (page: Page): Locator => page.getByRole('region', { name: 'AI evidence assessment' })

test.describe('AI evidence from a code repository', () => {
  test('auditor saves a repository, picks items, runs, opens the code and accepts one suggestion', async ({ page }) => {
    const stub = await openAudit(page)
    const panel = panelOf(page)

    await panel.getByRole('radio', { name: 'Code repository' }).check()
    await panel.getByLabel('Repository address').fill('https://github.com/acme/social-app')
    await panel.getByRole('button', { name: 'Save repository' }).click()
    await expect(panel.getByText('Saved:')).toBeVisible()
    expect(stub.repoBodies).toEqual([{ repoUrl: 'https://github.com/acme/social-app', branch: null }])

    await panel.getByLabel(ITEMS[0].text).check()
    await panel.getByLabel(ITEMS[1].text).check()
    await panel.getByRole('button', { name: 'Check the code' }).click()
    expect(stub.repoRunItems).toEqual([['i1', 'i2']])
    await expect(panel.getByRole('heading', { name: 'Last run' })).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText('2 suggestions · 0 flagged')).toBeVisible()

    // Suggestions alone change nothing.
    await expect(answeredCount(page)).toHaveText('0/3')
    await expect(row(page, 0).getByRole('region', { name: 'AI suggestion' })).toContainText('No')
    await expect(row(page, 0).getByText('Based on the code at commit abc1234, not on the live app.')).toBeVisible()
    expect(stub.decisions).toHaveLength(0)

    await row(page, 0).getByRole('button', { name: 'Code found' }).click()
    await expect(row(page, 0).getByText('isPrivate: age < 18')).toBeVisible()
    await expect(row(page, 0).getByText('lines 41–43')).toBeVisible()
    await expect(row(page, 0).getByText('Quoted')).toHaveCount(1)
    const link = row(page, 0).getByRole('link', { name: 'Open on GitHub' }).first()
    await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/acme\/social-app\//)
    expect(stub.decisions).toHaveLength(0)

    // Only a decision moves the answer and the score.
    await row(page, 0).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(row(page, 0).getByText('Accepted', { exact: true })).toBeVisible()
    await expect(answeredCount(page)).toHaveText('1/3')
    expect(stub.decisions).toHaveLength(1)
    expect(stub.violations).toEqual([])
  })
})

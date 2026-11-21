import { expect, test } from '@playwright/test'
import { HEAD } from './stubApi'
import { ADMIN, SEEDED_PROJECT, installCoreStub, seedCoreSession } from './coreStub'

// Browser checks for the two failures found in functional testing (report TC-11 and TC-85).
// The backend is stubbed (coreStub), so these check what the screens show and send.

test.describe('Fixed failures', () => {
  test('TC-11 (FR-006): saved scope features still show after the project page is reloaded', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    await seedCoreSession(page, HEAD)
    // Opened directly by its address, not from the project list.
    await page.goto(`/projects/${SEEDED_PROJECT.id}`)
    await page.getByRole('button', { name: /Scope \/ Features/ }).click()

    const input = page.getByLabel('Add a feature to the audit scope')
    for (const feature of ['Login', 'Privacy Settings']) {
      await input.fill(feature)
      await input.press('Enter')
    }
    await page.getByRole('button', { name: 'Save Scope' }).click()
    await expect.poll(() => stub.project(SEEDED_PROJECT.id)?.scope).toEqual(['Login', 'Privacy Settings'])

    await page.reload()
    await page.getByRole('button', { name: /Scope \/ Features/ }).click()
    await expect(page.getByRole('button', { name: 'Remove Login from scope' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove Privacy Settings from scope' })).toBeVisible()
    await expect(page.getByText('No features defined yet. Add features above.')).toHaveCount(0)
    expect(stub.violations).toEqual([])
  })

  test('TC-85 (NFR-06): the Excel tab refuses a .txt file even when the picker is set to All files', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'none' })
    await seedCoreSession(page, ADMIN)
    await page.goto('/generator')
    // setInputFiles ignores the accept filter, as choosing "All files" in the picker does.
    await page.locator('input[accept=".xlsx, .xls"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some notes') })
    await expect(page.getByText('"notes.txt" is not an Excel file. Choose a .xlsx or .xls file.')).toBeVisible()
    await expect(page.getByText('Parsing Compliance Spreadsheet')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Save as Guideline/ })).toHaveCount(0)
    expect(stub.violations).toEqual([])
  })

  test('TC-86 (NFR-06): the PDF tab says the file type is wrong for a .txt file', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'none' })
    await seedCoreSession(page, ADMIN)
    await page.goto('/generator')
    await page.getByRole('button', { name: /PDF Guidelines/ }).click()
    await page.locator('input[accept=".pdf"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('just some notes') })
    await expect(page.getByText('"notes.txt" is not a PDF file. Choose a .pdf file.')).toBeVisible()
    expect(stub.violations).toEqual([])
  })
})

import { expect, test, type Locator, type Page } from '@playwright/test'
import { AUDITOR, HEAD, answeredCount } from './stubApi'
import {
  CORE_ITEMS,
  GUIDELINE,
  NEW_PROJECT_ID,
  PASSWORD,
  SEEDED_FINDING,
  SEEDED_PROJECT,
  installCoreStub,
  seedCoreSession,
  sha256Hex,
  switchCoreSession,
} from './coreStub'

/** One checklist row on the audit page. */
const row = (page: Page, index: number): Locator => page.locator('div.px-6.py-5').filter({ hasText: CORE_ITEMS[index].text })
/** An answer button in a row. Exact, so "No" never matches "Add note". */
const answer = (page: Page, index: number, label: string): Locator => row(page, index).getByRole('button', { name: label, exact: true })
const projectLink = (page: Page, title: string): Locator => page.getByRole('main').getByRole('link', { name: new RegExp(title) })

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account menu for/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByRole('dialog', { name: 'Sign Out' }).getByRole('button', { name: 'Sign Out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}

async function expectOnDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
}

test.describe('Core audit workflow', () => {
  test('sign in: a wrong password is refused and the right one opens the dashboard', async ({ page }) => {
    const stub = await installCoreStub(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    // Nothing is posted until both fields are filled.
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Please enter your email.')).toBeVisible()
    await page.getByLabel('Email').fill(HEAD.userEmail)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Please enter your password.')).toBeVisible()
    expect(stub.logins).toHaveLength(0)

    // A wrong password: the page says so and stays on the sign-in form.
    await signIn(page, '  Hana@Example.test ', 'not-the-password')
    await expect(page.getByText('Incorrect email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    expect(stub.logins).toHaveLength(1)
    // The email is tidied and the password is hashed in the browser: the plain text never leaves the page.
    expect(stub.logins[0].email).toBe(HEAD.userEmail)
    expect(stub.logins[0].password).toBe(await sha256Hex('not-the-password'))

    // The right password lands on the dashboard, signed in as the head auditor, with their project counted.
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expectOnDashboard(page)
    await expect(page.getByRole('button', { name: `Account menu for ${HEAD.userName}` })).toBeVisible()
    await expect(page.getByText(/1 audit in progress/)).toBeVisible()
    expect(stub.logins[1].password).toBe(await sha256Hex(PASSWORD))
    expect(JSON.stringify(stub.logins)).not.toContain(PASSWORD)

    // The session survives a reload.
    await page.reload()
    await expectOnDashboard(page)
    expect(stub.violations).toEqual([])
  })

  test('registration checks each field, refuses a taken email and registers an auditor', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'none' })
    await page.goto('/')
    await page.getByRole('link', { name: 'Register' }).click()
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()
    const create = page.getByRole('button', { name: 'Create account' })
    const password = page.getByLabel('Password', { exact: true })
    const confirm = page.getByLabel('Confirm Password')

    await create.click()
    await expect(page.getByText('Please enter your full name.')).toBeVisible()
    await page.getByLabel('Full Name').fill('Cara Checker')
    await create.click()
    await expect(page.getByText('Please enter your email.')).toBeVisible()
    await page.getByLabel('Email').fill('cara@example.test')

    // A weak password shows which rules it misses and is refused.
    await password.fill('short')
    await password.blur()
    const rules = page.getByRole('listitem')
    await expect(rules.filter({ hasText: 'At least 8 characters' })).toBeVisible()
    await expect(rules.filter({ hasText: 'One uppercase letter (A to Z)' })).toBeVisible()
    await create.click()
    await expect(page.getByText('Password does not meet the requirements below.')).toBeVisible()

    // A strong one that the confirmation does not match is refused too.
    await password.fill('Checker_2026')
    await confirm.fill('Checker_2027')
    await create.click()
    await expect(page.getByText('Passwords do not match.')).toBeVisible()
    await confirm.fill('Checker_2026')
    expect(stub.registrations).toHaveLength(0)

    // The role picker: Auditor is the default, and the choice can change back and forth.
    const auditorRole = page.getByRole('radio', { name: /^Auditor/ })
    const headRole = page.getByRole('radio', { name: /^Head Auditor/ })
    await expect(auditorRole).toBeChecked()
    await page.getByText('Head Auditor', { exact: true }).click()
    await expect(headRole).toBeChecked()
    await page.getByText('Auditor', { exact: true }).click()
    await expect(auditorRole).toBeChecked()

    // An email that already has an account is refused by the server, and the page says why.
    await page.getByLabel('Email').fill(AUDITOR.userEmail)
    await create.click()
    await expect(page.getByText('An account with this email already exists.')).toBeVisible()
    await expect(page).toHaveURL(/\/register$/)

    await page.getByLabel('Email').fill('cara@example.test')
    await create.click()
    await expect(page.getByText('Account created successfully! Redirecting…')).toBeVisible()
    await expectOnDashboard(page)
    await expect(page.getByRole('button', { name: 'Account menu for Cara Checker' })).toBeVisible()
    const body = stub.registrations[stub.registrations.length - 1]
    expect(body).toMatchObject({ userName: 'Cara Checker', userEmail: 'cara@example.test', role: 'auditor', userPassword: await sha256Hex('Checker_2026') })
    expect(String(body.userId)).toMatch(/^[0-9a-f-]{36}$/)

    // The new account signs in again with its own password.
    await signOut(page)
    await signIn(page, 'cara@example.test', 'Checker_2026')
    await expectOnDashboard(page)
    await expect(page.getByRole('button', { name: 'Account menu for Cara Checker' })).toBeVisible()
    expect(stub.violations).toEqual([])
  })

  test('a head auditor creates an audit project and finds it in the project list', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'none' })
    await seedCoreSession(page, HEAD)
    await page.goto('/projects')
    await expect(page.getByText('No audits yet.')).toBeVisible()
    await page.getByRole('main').getByRole('link', { name: 'New Audit' }).click()
    await expect(page).toHaveURL(/\/projects\/new$/)
    await expect(page.getByRole('heading', { name: 'Create New Audit' })).toBeVisible()

    // An empty form lists everything that is missing and creates nothing.
    const createButton = page.getByRole('button', { name: 'Create Audit Project' })
    await createButton.click()
    const problems = page.getByRole('alert').filter({ hasText: 'Fix 3 items before creating' })
    await expect(problems).toBeVisible()
    await expect(problems).toContainText('Enter a project name.')
    await expect(problems).toContainText('Select a platform to audit.')
    await expect(problems).toContainText('Select at least one guideline.')
    expect(stub.createdProjects).toHaveLength(0)

    await page.getByLabel('Project Name').fill('Spring Teen Audit')
    await page.getByRole('button', { name: /TikTok/ }).click()
    await expect(page.getByRole('button', { name: /TikTok/ })).toHaveAttribute('aria-pressed', 'true')
    const guideline = page.getByRole('button', { name: new RegExp(GUIDELINE.guidelineName) })
    await guideline.click()
    await expect(guideline).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(`1 selected · ${CORE_ITEMS.length} items`)).toBeVisible()

    // One auditor joins the team; the other stays out.
    await page.getByLabel('Search auditors to add').fill('Ada')
    await page.getByRole('button', { name: new RegExp(AUDITOR.userName) }).click()
    await expect(page.getByRole('button', { name: `Remove ${AUDITOR.userName}` })).toBeVisible()
    await expect(page.getByText('2 members')).toBeVisible()

    await createButton.click()
    await expect(page).toHaveURL(new RegExp(`/projects/${NEW_PROJECT_ID}$`))
    await expect(page.getByRole('heading', { name: 'Spring Teen Audit', level: 1 })).toBeVisible()
    await expect(page.getByText(CORE_ITEMS[0].text)).toBeVisible()
    expect(stub.createdProjects).toEqual([
      expect.objectContaining({ title: 'Spring Teen Audit', platform: 'TikTok', headAuditorId: HEAD.userId, status: 'in_progress' }),
    ])
    expect(stub.memberSyncs).toEqual([{ projectId: NEW_PROJECT_ID, userIds: [HEAD.userId, AUDITOR.userId] }])
    expect(stub.guidelineSyncs).toEqual([{ projectId: NEW_PROJECT_ID, guidelineIds: [GUIDELINE.guidelineId] }])

    // Back in the list, the new project is there and nothing is answered yet.
    await page.getByRole('link', { name: 'Back to Audits' }).click()
    const listed = projectLink(page, 'Spring Teen Audit')
    await expect(listed).toBeVisible()
    await expect(listed).toContainText('TikTok')
    await expect(listed).toContainText('In Progress')
    await expect(listed).toContainText(`0/${CORE_ITEMS.length} items`)

    // The auditor who was added sees it in their own list.
    await switchCoreSession(page, AUDITOR)
    await page.goto('/projects')
    await expect(projectLink(page, 'Spring Teen Audit')).toBeVisible()
    expect(stub.violations).toEqual([])
  })

  test('an auditor answers every item, records a finding and submits for review', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    await seedCoreSession(page, AUDITOR)
    await page.goto('/projects')
    await projectLink(page, SEEDED_PROJECT.title).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${SEEDED_PROJECT.id}$`))
    await expect(row(page, 0)).toBeVisible()

    // Submitting is refused while items are unanswered.
    const submit = page.getByRole('button', { name: 'Submit for Review' })
    await expect(submit).toBeDisabled()
    await expect(page.getByText('4 items remaining')).toBeVisible()
    await expect(answeredCount(page)).toHaveText('0/4')

    await answer(page, 0, 'Yes').click()
    await expect(answeredCount(page)).toHaveText('1/4')
    await answer(page, 1, 'No').click()
    await expect(answeredCount(page)).toHaveText('2/4')
    await answer(page, 2, 'Partially').click()
    await expect(answeredCount(page)).toHaveText('3/4')

    // A flagged item still counts as unanswered.
    await answer(page, 3, 'Flag').click()
    await expect(answer(page, 3, 'Flag')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('1 item remaining')).toBeVisible()
    await expect(submit).toBeDisabled()

    // A finding for the failing item is saved when the box loses focus.
    const findings = row(page, 1).getByLabel('Findings')
    await findings.fill(SEEDED_FINDING)
    await findings.blur()
    await expect(row(page, 1).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
    await expect.poll(() => stub.answers(SEEDED_PROJECT.id).find((a) => a.itemId.endsWith('-a2'))?.findings).toBe(SEEDED_FINDING)

    await answer(page, 3, 'N/A').click()
    await expect(answeredCount(page)).toHaveText('4/4')
    await expect(page.getByText(/items? remaining/)).toHaveCount(0)
    expect(stub.submits).toHaveLength(0)
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByText('Submitted, waiting for the head auditor')).toBeVisible()
    await expect(page.getByText('Pending Review', { exact: true })).toBeVisible()
    await expect(page.getByText('Under Review', { exact: true })).toBeVisible()
    await expect(answer(page, 0, 'Yes')).toBeDisabled()
    expect(stub.submits).toEqual([SEEDED_PROJECT.id])
    expect(stub.project(SEEDED_PROJECT.id)).toMatchObject({ submissionStatus: 'pending_review', projectStatus: 'under_review' })
    expect(stub.answers(SEEDED_PROJECT.id).map((a) => a.result).sort()).toEqual(['compliant', 'non_compliant', 'not_applicable', 'partially'])

    // A fresh load reads the submitted state back from the server.
    await page.reload()
    await expect(page.getByText('Submitted, waiting for the head auditor')).toBeVisible()
    await expect(row(page, 1).getByLabel('Findings')).toHaveValue(SEEDED_FINDING)
    await expect(answer(page, 1, 'No')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Submit for Review' })).toHaveCount(0)
    expect(stub.violations).toEqual([])
  })

  test('the head auditor approves a submitted audit, and the list and report show it approved', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'pending_review' })
    await seedCoreSession(page, HEAD)
    await page.goto('/projects')
    const listed = projectLink(page, SEEDED_PROJECT.title)
    await expect(listed).toContainText('Under Review')
    await listed.click()

    await expect(page.getByText('Audit Submitted for Review')).toBeVisible()
    // The head auditor reads the answers and findings but cannot change them.
    await expect(row(page, 1).getByText('No', { exact: true })).toBeVisible()
    await expect(row(page, 1).getByLabel('Findings (read-only)')).toHaveValue(SEEDED_FINDING)
    await expect(row(page, 0).getByRole('button', { name: 'Yes', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Review Submission' }).click()
    const remarks = 'Every answer is backed by a finding or a clear reason.'
    await page.getByLabel('Review Remarks').fill(remarks)
    await page.getByRole('button', { name: 'Approve', exact: true }).click()

    await expect(page.getByText('Submission Approved')).toBeVisible()
    // The review panel closes (its remarks box goes with it) and the approval banner repeats the remarks.
    await expect(page.getByText('Audit Submitted for Review')).toHaveCount(0)
    await expect(page.getByLabel('Review Remarks')).toHaveCount(0)
    await expect(page.getByText(remarks)).toBeVisible()
    await expect(page.getByText('Approved', { exact: true })).toBeVisible()
    await expect(page.getByText('Completed', { exact: true })).toBeVisible()
    expect(stub.reviews).toEqual([{ projectId: SEEDED_PROJECT.id, approved: true, remarks }])
    expect(stub.project(SEEDED_PROJECT.id)).toMatchObject({ submissionStatus: 'approved', projectStatus: 'completed', submissionRemarks: remarks })

    // The project list reads the new status from the server.
    await page.getByRole('link', { name: 'Back to Audits' }).click()
    await expect(listed).toContainText('Completed')
    await page.getByRole('button', { name: /^Completed/ }).click()
    await expect(listed).toBeVisible()

    // The report shows the approval, the remarks and the score.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click()
    await page.getByRole('button', { name: new RegExp(SEEDED_PROJECT.title) }).click()
    // The right-hand column holds the selected report; the list on the left repeats the badges.
    const report = page.locator('.xl\\:col-span-3')
    await expect(report.getByRole('heading', { name: SEEDED_PROJECT.title, level: 2 })).toBeVisible()
    await expect(report.getByText('Approved', { exact: true })).toBeVisible()
    await expect(report.getByText('Completed', { exact: true })).toBeVisible()
    await expect(report.getByText('Review Remarks:')).toBeVisible()
    await expect(report.getByText(remarks)).toBeVisible()
    await expect(report.getByText('Based on 4 of 4 items answered')).toBeVisible()
    // One Yes, one Partially and one No over three applicable items: (1 + 0.5) / 3.
    await expect(report.getByRole('img', { name: 'Compliance score: 50%' })).toBeVisible()
    await expect(report.getByText('Failing (2)')).toBeVisible()
    expect(stub.violations).toEqual([])
  })

  test('role guards keep an auditor out of head-auditor and admin pages', async ({ page }) => {
    const stub = await installCoreStub(page, { project: 'in_progress' })
    await seedCoreSession(page, AUDITOR)
    await page.goto('/dashboard')
    await expectOnDashboard(page)

    // The auditor's menu has no link to the guidelines or the generator, and no way to start an audit.
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Audits' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Reports' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Guidelines' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Generator' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'New Audit' })).toHaveCount(0)
    await page.goto('/projects')
    await expect(projectLink(page, SEEDED_PROJECT.title)).toBeVisible()
    await expect(page.getByRole('link', { name: 'New Audit' })).toHaveCount(0)

    // Typing the address of a page the role may not use sends the auditor back to the dashboard.
    for (const path of ['/generator', '/guidelines', '/projects/new']) {
      await page.goto(path)
      await expectOnDashboard(page)
    }

    // The generator is for admins only, so even a head auditor is sent back.
    await switchCoreSession(page, HEAD)
    await page.goto('/dashboard')
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Guidelines' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Generator' })).toHaveCount(0)
    await page.goto('/generator')
    await expectOnDashboard(page)

    // Signed out, any app page leads to the sign-in form.
    await signOut(page)
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    expect(stub.violations).toEqual([])
  })
})

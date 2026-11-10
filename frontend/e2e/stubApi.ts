// A stand-in for the whole backend, driven by `page.route`. Nothing here talks to a real server.
// Shapes follow backend/src/features/evidence/views.ts through src/features/evidence/types.ts.
import type { Locator, Page, Route } from '@playwright/test'

export const APP_ORIGIN = 'http://127.0.0.1:5199'
const API_ORIGIN = 'http://127.0.0.1:5198'
export const PROJECT_ID = 'p1'

export interface TestUser {
  userId: string
  userName: string
  userEmail: string
  role: 'auditor' | 'head_auditor'
}
export const AUDITOR: TestUser = { userId: 'u-aud', userName: 'Ada Auditor', userEmail: 'ada@example.test', role: 'auditor' }
export const HEAD: TestUser = { userId: 'u-head', userName: 'Hana Head', userEmail: 'hana@example.test', role: 'head_auditor' }

type Answer = 'compliant' | 'non_compliant' | 'partially' | 'not_applicable'
type Json = Record<string, unknown>

export const ITEMS = [
  { itemId: 'i1', text: 'The privacy policy is linked from the sign-up page.' },
  { itemId: 'i2', text: 'Parental controls can be turned on by a guardian.' },
  { itemId: 'i3', text: 'A reporting tool is easy to find for children.' },
] as const

// A plain picture with a size of its own, so the viewer has something real to lay out.
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<rect width="640" height="360" fill="#e2e8f0"/><rect x="40" y="120" width="560" height="60" fill="#fde047"/>
<text x="56" y="160" font-family="sans-serif" font-size="28" fill="#0f172a">Create your account in one step</text></svg>`

interface StoredAnswer {
  result: Answer
  findings: string | null
  evidenceImages: { url: string; name: string }[]
}

export interface StubOptions {
  /** Start with a finished run and its suggestions, and no decisions yet. */
  withRun: boolean
  /** Every evidence route answers 503, as an unconfigured server does. */
  evidenceDown?: boolean
  /** Only the app endpoints answer 503; the page-based ones work. */
  appDown?: boolean
}

export interface SavedAccount {
  label: string
  ageGroup: string
  loginName: string
  password?: string
}

export interface Stub {
  /** Requests that tried to leave the machine, or hit a path nobody stubbed. */
  violations: string[]
  /** Decision bodies posted, in order. */
  decisions: Json[]
  /** Answers saved the older way (answer buttons without a suggestion). */
  savedAnswers: Json[]
  /** Bodies of test accounts posted, with the password the page sent. The stub never echoes it back. */
  accountBodies: SavedAccount[]
  /** Item ids sent to start an app run. */
  appRunItems: string[][]
  /** Item ids sent to start a code repository run. */
  repoRunItems: string[][]
  /** Repository addresses saved. */
  repoBodies: { repoUrl: string; branch: string | null }[]
}

type RunSource = 'pages' | 'app' | 'repo'

const run = (status: 'capturing' | 'completed', pagesDone: number, source: RunSource = 'pages', itemIds: string[] = []) => ({
  id: 'run-1',
  projectId: PROJECT_ID,
  startedBy: AUDITOR.userId,
  status,
  capturedInRunId: 'run-1',
  scope: 'all',
  unassessedCategories: [],
  categoriesTotal: source !== 'pages' ? itemIds.length : 1,
  categoriesDone: status === 'completed' ? (source !== 'pages' ? itemIds.length : 1) : 0,
  pagesTotal: 3,
  pagesDone,
  tokensUsed: 1200,
  model: 'e2e-model',
  promptVersion: 'evidence-v1',
  source,
  checkedItemIds: status === 'completed' ? itemIds : [],
  uncheckedItemIds: [],
  currentItemId: status === 'capturing' && source === 'app' ? (itemIds[0] ?? null) : null,
  currentStep: status === 'capturing' && source === 'app' ? 3 : 0,
  error: null,
  createdAt: '2026-11-04T09:00:00.000Z',
  startedAt: '2026-11-04T09:00:01.000Z',
  finishedAt: status === 'completed' ? '2026-11-04T09:05:00.000Z' : null,
})

const quote = (id: string, text: string) => ({
  id,
  pageId: 'pg-1',
  quoteText: text,
  verified: true,
  pageUrl: 'https://example.test/safety',
  pageTitle: 'Safety centre',
  hasHighlight: true,
})

const SUGGESTIONS = [
  {
    id: 's1',
    runId: 'run-1',
    projectId: PROJECT_ID,
    source: 'pages',
    itemId: 'i1',
    suggestedResult: 'no',
    reason: 'The sign-up page has no link to a privacy policy.',
    confidence: 'high',
    flags: [],
    quotes: [quote('q1', 'Create your account in one step')],
  },
  {
    id: 's2',
    runId: 'run-1',
    projectId: PROJECT_ID,
    source: 'pages',
    itemId: 'i2',
    suggestedResult: 'yes',
    reason: 'The help page says guardians can switch on parental controls.',
    confidence: 'medium',
    flags: [],
    quotes: [quote('q2', 'Guardians can turn on parental controls')],
  },
  {
    id: 's3',
    runId: 'run-1',
    projectId: PROJECT_ID,
    source: 'pages',
    itemId: 'i3',
    suggestedResult: 'partially',
    reason: 'A report link exists but only on some pages.',
    confidence: 'low',
    flags: [{ type: 'low_confidence', reason: 'The pages that mention reporting are vague.' }],
    quotes: [],
  },
]

const APP_RESULT: Readonly<Record<string, 'yes' | 'no' | 'partially'>> = { i1: 'no', i2: 'yes', i3: 'partially' }

/** What an app run suggests for the items it was asked to check. */
const appSuggestions = (itemIds: string[]) =>
  itemIds.map((itemId) => ({
    id: `as-${itemId}`,
    runId: 'run-1',
    projectId: PROJECT_ID,
    source: 'app',
    itemId,
    suggestedResult: APP_RESULT[itemId] ?? 'partially',
    reason: `Signed in as Teen 15 and Adult 30, the app showed the same result for ${itemId}.`,
    confidence: 'medium',
    flags: [],
    quotes: [],
  }))

const COMMIT_SHA = 'abc1234def5678abc1234def5678abc1234def56'
const REPO_URL = 'https://github.com/acme/social-app'

/** What a repository run suggests for the items it was asked to check. */
const repoSuggestions = (itemIds: string[]) =>
  itemIds.map((itemId) => ({
    id: `rs-${itemId}`,
    runId: 'run-1',
    projectId: PROJECT_ID,
    source: 'repo',
    itemId,
    suggestedResult: APP_RESULT[itemId] ?? 'partially',
    reason: `The code decides this for ${itemId}.`,
    confidence: 'medium',
    flags: [],
    quotes: [],
  }))

/** The code the AI looked at: one quoted piece, one extra piece. */
const CODE = {
  commitSha: COMMIT_SHA,
  repoUrl: REPO_URL,
  pieces: [
    {
      id: 'cp-1',
      path: 'src/accounts/privacy.ts',
      startLine: 41,
      endLine: 43,
      code: 'export function defaults(age: number) {\n  return { isPrivate: age < 18 }\n}',
      url: `${REPO_URL}/blob/${COMMIT_SHA}/src/accounts/privacy.ts#L41-L43`,
      round: 1,
      quoted: true,
    },
    {
      id: 'cp-2',
      path: 'src/accounts/signup.ts',
      startLine: 10,
      endLine: 11,
      code: 'const minAge = 13\nexport { minAge }',
      url: `${REPO_URL}/blob/${COMMIT_SHA}/src/accounts/signup.ts#L10-L11`,
      round: 1,
      quoted: false,
    },
  ],
}

/** Three steps for one suggestion: a page with a picture, a refused action, and a page with a picture. */
const STEPS = [
  { id: 'st-1', position: 1, accountLabel: 'Teen 15', line: 'Opened the settings page', outcome: 'done', refusalReason: null, pageId: 'pg-1', hasScreenshot: true, hint: false },
  { id: 'st-2', position: 2, accountLabel: 'Teen 15', line: 'Tried to press Delete account', outcome: 'refused', refusalReason: 'Deleting an account is never allowed.', pageId: null, hasScreenshot: false, hint: false },
  { id: 'st-3', position: 3, accountLabel: 'Adult 30', line: 'Read the privacy options', outcome: 'done', refusalReason: null, pageId: 'pg-2', hasScreenshot: true, hint: false },
]
const CHANGES = [
  { id: 'c-1', itemId: 'i1', accountLabel: 'Teen 15', pageUrl: 'http://127.0.0.1:5199/settings', control: 'Private account', before: 'on', after: 'off', restored: false, restoreDetail: 'The switch could not be found again.' },
]

const ANSWER_OF: Readonly<Record<string, Answer>> = {
  yes: 'compliant',
  no: 'non_compliant',
  partially: 'partially',
  not_applicable: 'not_applicable',
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

const SOURCE_BASE = { id: 'src-1', projectId: PROJECT_ID, createdBy: AUDITOR.userId, createdAt: '2026-11-04T08:00:00.000Z' }

/** Installs every stub for one page. State lives in the closure, so a decision changes what the next GET returns. */
export async function installStub(page: Page, options: StubOptions): Promise<Stub> {
  const stub: Stub = { violations: [], decisions: [], savedAnswers: [], accountBodies: [], appRunItems: [], repoRunItems: [], repoBodies: [] }
  const answers = new Map<string, StoredAnswer>()
  const decisions = new Map<string, Json>()
  let runState: 'none' | 'capturing' | 'completed' = options.withRun ? 'completed' : 'none'
  let latestReads = 0
  let startUrls: string[] | null = null
  let runSource: RunSource = 'pages'
  let appRunItems: string[] = []
  let repoRunItems: string[] = []
  let repoSource: { repoUrl: string; branch: string | null; updatedAt: string } | null = null
  let appSource: { appUrl: string; loginDomains: string[]; updatedAt: string } | null = null
  const accounts: Json[] = []
  const runItems = (): string[] => (runSource === 'repo' ? repoRunItems : appRunItems)
  const currentSuggestions = (): Json[] =>
    runSource === 'app' ? appSuggestions(appRunItems) : runSource === 'repo' ? repoSuggestions(repoRunItems) : SUGGESTIONS

  // Registered first, so it has the lowest priority: anything the stubs below do not claim lands here.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === APP_ORIGIN) return route.continue()
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    }
    stub.violations.push(`${route.request().method()} ${url.href}`)
    return route.abort()
  })
  await page.routeWebSocket(/\/realtime\//, () => {
    // Accepted and left silent: the live-guidelines channel has nothing to say.
  })
  await page.route(`${API_ORIGIN}/files/**`, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE }))

  const project = () => ({
    projectId: PROJECT_ID,
    projectTitle: 'Kids Chat Audit',
    smPlatform: 'tiktok',
    projectStatus: 'in_progress',
    submissionStatus: 'not_submitted',
    submissionRemarks: null,
    headAuditorId: HEAD.userId,
    projectNotes: null,
    dueDate: null,
    timeCreated: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    memberIds: [HEAD.userId, AUDITOR.userId],
    guidelineIds: ['g1'],
  })
  const guideline = {
    guidelineId: 'g1',
    guidelineName: 'Child Safety Code',
    shortName: 'CSC',
    version: '1.0',
    description: 'E2E guideline',
    source: 'test',
    lastUpdated: '2026-01-01',
    categories: ['Privacy'],
    itemCount: ITEMS.length,
    isDeleted: false,
  }
  const items = ITEMS.map((it, i) => ({
    itemId: it.itemId,
    guidelineId: 'g1',
    category: 'Privacy',
    itemDescription: it.text,
    severity: 'major',
    reference: `CSC ${i + 1}`,
    itemName: null,
    itemCode: `P-${i + 1}`,
    rowType: null,
    helpText: null,
    verbatimClauseText: null,
    answerOptions: null,
  }))
  const resultRows = () =>
    [...answers.entries()].map(([itemId, a]) => ({
      resultId: `r-${itemId}`,
      projectId: PROJECT_ID,
      itemId,
      userId: AUDITOR.userId,
      guidelineId: 'g1',
      result: a.result,
      notes: null,
      findings: a.findings,
      evidenceImages: a.evidenceImages,
      timeSubmitted: '2026-11-04T10:00:00.000Z',
    }))
  const percentage = () => {
    const rows = [...answers.values()].filter((a) => a.result !== 'not_applicable')
    if (rows.length === 0) return 0
    const sum = rows.reduce((n, a) => n + (a.result === 'compliant' ? 1 : a.result === 'partially' ? 0.5 : 0), 0)
    return Math.round((sum / rows.length) * 1000) / 10
  }

  const decide = (route: Route, suggestionId: string) => {
    const body = route.request().postDataJSON() as Json
    stub.decisions.push(body)
    const suggestion = currentSuggestions().find((s) => s.id === suggestionId) as (typeof SUGGESTIONS)[number] | undefined
    if (!suggestion) return json(route, { error: 'That was not found.' }, 404)
    const accepted = body.decision === 'accepted'
    const finalResult = accepted ? ANSWER_OF[suggestion.suggestedResult] : (body.finalResult as Answer)
    const before = answers.get(suggestion.itemId)
    const answer: StoredAnswer = {
      result: finalResult,
      findings: before?.findings ?? (accepted ? `AI evidence: ${suggestion.reason}` : null),
      // Only an accept brings the captured picture along.
      evidenceImages: accepted
        ? [...(before?.evidenceImages ?? []), { url: `${API_ORIGIN}/files/q.svg`, name: 'AI evidence.jpg' }]
        : (before?.evidenceImages ?? []),
    }
    answers.set(suggestion.itemId, answer)
    const decision = {
      id: `d-${suggestionId}`,
      suggestionId,
      itemId: suggestion.itemId,
      userId: AUDITOR.userId,
      decision: accepted ? 'accepted' : 'overridden',
      finalResult,
      overrideReason: accepted ? null : (body.overrideReason ?? null),
      origin: body.origin,
      decidedAt: '2026-11-04T10:00:00.000Z',
      suggestedResult: suggestion.suggestedResult,
    }
    decisions.set(suggestion.itemId, decision)
    return json(route, {
      decision,
      answer: { itemId: suggestion.itemId, status: finalResult, findings: answer.findings, evidenceImages: answer.evidenceImages },
    })
  }

  const sources = (route: Route, method: string) => {
    if (method === 'POST') startUrls = (route.request().postDataJSON() as { startUrls: string[] }).startUrls
    const source = startUrls ? { ...SOURCE_BASE, startUrls } : null
    return json(route, method === 'POST' ? { source } : { source, permission: null })
  }

  const latest = (route: Route) => {
    if (runState === 'capturing') {
      latestReads += 1
      // The first read shows progress; the next one finds the run done.
      if (latestReads >= 2) runState = 'completed'
    }
    const captured = {
      id: 'pg-1',
      url: 'https://example.test/safety',
      finalUrl: null,
      httpStatus: 200,
      accessStatus: 'ok',
      accessDetail: null,
      title: 'Safety centre',
      hasScreenshot: true,
      capturedAt: '2026-11-04T09:01:00.000Z',
    }
    if (runState === 'none') return json(route, { run: null, pages: [] })
    return json(route, { run: runState === 'capturing' ? run('capturing', 1, runSource, runItems()) : run('completed', 3, runSource, runItems()), pages: [captured] })
  }

  const evidence = (route: Route, method: string, path: string): Promise<void> | null => {
    if (!/^\/(projects\/[^/]+\/(evidence-|ai-suggestions|app-|repo-|test-accounts)|suggestions\/|evidence\/)/.test(path)) return null
    if (options.evidenceDown) {
      return json(route, { error: 'AI evidence assessment is not set up on this server.' }, 503)
    }
    if (options.appDown && /\/(app-|test-accounts)|\/suggestions\/[^/]+\/steps$/.test(path)) {
      return json(route, { error: 'Checking inside the app is not set up on this server.' }, 503)
    }
    if (path.endsWith('/evidence-sources')) return sources(route, method)
    if (path.endsWith('/app-setup')) return json(route, { app: appSource, accounts, secretKeyConfigured: true })
    if (path.endsWith('/app-source') && method === 'PUT') {
      const body = route.request().postDataJSON() as { appUrl: string; loginDomains: string[] }
      appSource = { ...body, updatedAt: '2026-11-04T08:30:00.000Z' }
      return json(route, { app: appSource })
    }
    if (path.endsWith('/test-accounts') && method === 'POST') {
      const body = route.request().postDataJSON() as SavedAccount
      stub.accountBodies.push(body)
      // A password is write-only: the view says only that one is saved.
      const { password: _password, ...rest } = body
      const account = { ...rest, id: `acct-${accounts.length + 1}`, hasPassword: true, updatedAt: '2026-11-04T08:31:00.000Z' }
      accounts.push(account)
      return json(route, { account }, 201)
    }
    if (path.endsWith('/app-runs') && method === 'POST') {
      appRunItems = (route.request().postDataJSON() as { itemIds: string[] }).itemIds
      stub.appRunItems.push(appRunItems)
      runSource = 'app'
      runState = 'capturing'
      latestReads = 0
      return json(route, { run: run('capturing', 0, 'app', appRunItems) }, 202)
    }
    if (path.endsWith('/repo-source')) {
      if (method === 'PUT') {
        const body = route.request().postDataJSON() as { repoUrl: string; branch: string | null }
        stub.repoBodies.push(body)
        repoSource = { ...body, updatedAt: '2026-11-04T08:30:00.000Z' }
        return json(route, { repo: repoSource })
      }
      return json(route, { repo: repoSource })
    }
    if (path.endsWith('/repo-runs') && method === 'POST') {
      repoRunItems = (route.request().postDataJSON() as { itemIds: string[] }).itemIds
      stub.repoRunItems.push(repoRunItems)
      runSource = 'repo'
      runState = 'capturing'
      latestReads = 0
      return json(route, { run: run('capturing', 0, 'repo', repoRunItems) }, 202)
    }
    if (/^\/suggestions\/[^/]+\/code$/.test(path)) return json(route, CODE)
    if (path.endsWith('/app-changes')) return json(route, { changes: runSource === 'app' && runState === 'completed' ? CHANGES : [] })
    if (/^\/suggestions\/[^/]+\/steps$/.test(path)) return json(route, { steps: STEPS, changes: CHANGES })
    if (path.endsWith('/evidence-runs') && method === 'POST') {
      runSource = 'pages'
      runState = 'capturing'
      latestReads = 0
      return json(route, { run: run('capturing', 0) }, 202)
    }
    if (path.endsWith('/evidence-runs/latest')) return latest(route)
    if (path.endsWith('/ai-suggestions') && method === 'GET') {
      return json(
        route,
        runState === 'completed'
          ? { run: run('completed', 3, runSource, runItems()), suggestions: currentSuggestions(), decisions: [...decisions.values()] }
          : { run: null, suggestions: [], decisions: [] },
      )
    }
    if (/^\/suggestions\/[^/]+\/decision$/.test(path)) return decide(route, path.split('/')[2])
    if (path.startsWith('/evidence/screenshots/')) return json(route, { url: `${API_ORIGIN}/files/shot.svg` })
    stub.violations.push(`unstubbed evidence route ${method} ${path}`)
    return json(route, { error: 'unstubbed' }, 500)
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== API_ORIGIN) {
      stub.violations.push(`${request.method()} ${url.href}`)
      return route.abort()
    }
    const method = request.method()
    const path = url.pathname.replace(/^\/api/, '')
    const handled = evidence(route, method, path)
    if (handled) return handled

    if (method === 'GET' && path === '/users') return json(route, [AUDITOR, HEAD])
    if (method === 'GET' && path === '/guidelines') return json(route, [guideline])
    if (method === 'GET' && path === '/guidelines/g1/items') return json(route, items)
    if (method === 'GET' && path === '/projects') return json(route, [project()])
    if (method === 'GET' && path === '/projects/compliance-summary') {
      return json(route, { [PROJECT_ID]: { percentage: percentage(), answered: answers.size, total: ITEMS.length } })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
      return json(route, {
        project: project(),
        members: [HEAD, AUDITOR].map((u) => ({ userId: u.userId, userName: u.userName, role: u.role })),
        guidelines: [guideline],
        scope: [],
      })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/checklist`) return json(route, items)
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/results`) return json(route, resultRows())
    // The rest of the audit page: Head Auditor resolutions, answers from earlier audits, photos per auditor, agreement.
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/resolutions`) return json(route, [])
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/suggestions`) return json(route, [])
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/evidence`) {
      const wanted = (url.searchParams.get('itemIds') ?? '').split(',')
      return json(route, wanted.flatMap((itemId) => {
        const images = answers.get(itemId)?.evidenceImages ?? []
        return images.length > 0 ? [{ itemId, userId: AUDITOR.userId, images }] : []
      }))
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/reliability`) return json(route, { kappa: null, sharedItems: 0, raterPair: null })
    if (method === 'POST' && path === `/projects/${PROJECT_ID}/activate`) return json(route, { success: true })
    if (method === 'POST' && path === `/projects/${PROJECT_ID}/results`) {
      const body = route.request().postDataJSON() as { itemId: string; result: Answer }
      stub.savedAnswers.push(body as unknown as Json)
      answers.set(body.itemId, { result: body.result, findings: null, evidenceImages: [] })
      return json(route, { answered: answers.size, compliant: 0, nonCompliant: 0, notApplicable: 0, percentage: percentage(), total: ITEMS.length })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}/compliance-scores`) {
      return json(route, [
        {
          scoreId: 'sc-1',
          guidelineId: 'g1',
          guidelineName: 'Child Safety Code',
          shortName: 'CSC',
          totalItems: ITEMS.length,
          answeredItems: answers.size,
          compliantItems: 0,
          nonCompliantItems: answers.size,
          notApplicableItems: 0,
          scorePercentage: percentage(),
          timeCalculated: '2026-11-04T10:00:00.000Z',
        },
      ])
    }
    if (method === 'GET' && path === '/reports') {
      return json(route, [
        {
          projectId: PROJECT_ID,
          projectTitle: 'Kids Chat Audit',
          smPlatform: 'tiktok',
          projectStatus: 'in_progress',
          submissionStatus: 'not_submitted',
          submissionRemarks: null,
          headAuditorId: HEAD.userId,
          headAuditorName: HEAD.userName,
          timeCreated: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-04T10:00:00.000Z',
          dueDate: null,
          scorePercentage: percentage(),
          guidelineIds: ['g1'],
        },
      ])
    }
    stub.violations.push(`unstubbed ${method} ${path}`)
    return json(route, { error: 'unstubbed' }, 500)
  })
  return stub
}

const sessionOf = (u: TestUser) => ({
  state: {
    isAuthenticated: true,
    authToken: 'e2e-auth-token',
    currentUserId: u.userId,
    users: [{ id: u.userId, name: u.userName, role: u.role, initials: 'XX', color: 'bg-slate-500' }],
  },
  version: 0,
})

/** Writes the signed-in session where the app keeps it, before any page script runs. Only when none is there yet. */
export async function seedSession(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript((session) => {
    if (window.localStorage.getItem('safetyaudit-session') === null) {
      window.localStorage.setItem('safetyaudit-session', JSON.stringify(session))
    }
  }, sessionOf(user))
}

/** Switches the stored session to another user, as a second person opening the app would. */
export async function switchSession(page: Page, user: TestUser): Promise<void> {
  await page.evaluate((session) => {
    window.localStorage.setItem('safetyaudit-session', JSON.stringify(session))
  }, sessionOf(user))
}

/** The "Answered" figure in the audit header, such as "1/3". */
export function answeredCount(page: Page): Locator {
  return page.getByText('Answered', { exact: true }).locator('xpath=preceding-sibling::p[1]')
}

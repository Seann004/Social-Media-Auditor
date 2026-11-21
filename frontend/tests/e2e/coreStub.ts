// A stand-in for the core audit backend (sign-in, accounts, projects, answers, submit, review, reports), driven by
// `page.route`. State lives in the closure, so a write changes what the next read returns.
// Shapes follow src/lib/db.ts and the handlers in backend/src/server.ts. Nothing here talks to a real server.
import type { Page, Route } from '@playwright/test'
import { APP_ORIGIN, AUDITOR, HEAD, type TestUser } from './stubApi'

const API_ORIGIN = 'http://127.0.0.1:5198'
const SESSION_KEY = 'safetyaudit-session'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const T0 = '2026-11-01T09:00:00.000Z'
/** The routes of the AI evidence feature: these tests do not cover it, so it answers as an unconfigured server does. */
const EVIDENCE_PATH = /^\/(projects\/[^/]+\/(evidence-|ai-suggestions|app-|repo-|test-accounts|item-kinds)|suggestions\/|evidence\/)/

type Role = 'auditor' | 'head_auditor' | 'admin'
type Result = 'compliant' | 'non_compliant' | 'partially' | 'not_applicable' | 'needs_review'
type Json = Record<string, unknown>

/** Every seeded account signs in with this password. */
export const PASSWORD = 'Audit_2026!'
export const SECOND_AUDITOR: TestUser = { userId: 'u-aud-2', userName: 'Ben Builder', userEmail: 'ben@example.test', role: 'auditor' }
export const ADMIN: TestUser = { userId: 'u-admin', userName: 'Ari Admin', userEmail: 'ari@example.test', role: 'admin' }

export const GUIDELINE = {
  guidelineId: 'g-osc',
  guidelineName: 'Online Safety Code',
  shortName: 'OSC',
  version: '2.0',
  description: 'Core duties for platforms that children use.',
  source: 'e2e',
  lastUpdated: '2026-01-01',
  categories: ['Accounts'],
  isDeleted: false,
} as const

export const CORE_ITEMS = [
  { key: 'a1', text: 'Accounts of under-18s are private by default.' },
  { key: 'a2', text: 'Strangers cannot send direct messages to children.' },
  { key: 'a3', text: 'Age checks run before mature content is shown.' },
  { key: 'a4', text: 'Location sharing is switched off by default.' },
] as const

export const SEEDED_PROJECT = { id: 'p-teen', title: 'Teen Safety Review', platform: 'Instagram' } as const
export const NEW_PROJECT_ID = 'p-new-1'
export const SEEDED_FINDING = 'Any adult account can message a 13-year-old.'

interface Account {
  userId: string
  userName: string
  userEmail: string
  role: Role
  passwordHash: string
}

interface ProjectState {
  projectId: string
  projectTitle: string
  smPlatform: string
  projectStatus: 'draft' | 'in_progress' | 'under_review' | 'completed'
  submissionStatus: 'not_submitted' | 'pending_review' | 'approved' | 'rejected'
  submissionRemarks: string | null
  headAuditorId: string
  projectNotes: string | null
  dueDate: string | null
  timeCreated: string
  updatedAt: string
  memberIds: string[]
  /** Global guideline ids; the project works on its own copy of each, as the backend clones them. */
  guidelineIds: string[]
  /** Saved scope features. Only the project details answer carries them, as in the backend. */
  scope?: string[]
}

export interface StoredAnswer {
  projectId: string
  itemId: string
  userId: string
  result: Result
  notes: string
  findings: string | null
}

export interface CoreSeed {
  /** No project, one in progress with nothing answered, or one fully answered and waiting for review. */
  project: 'none' | 'in_progress' | 'pending_review'
}

export interface CoreStub {
  /** Requests that tried to leave the machine, or hit a path nobody stubbed. */
  violations: string[]
  /** Sign-in bodies as posted: the password is whatever the page sent. */
  logins: { email: string; password: string }[]
  /** Registration bodies as posted. */
  registrations: Json[]
  /** Bodies posted to create a project, then the member and guideline lists synced to it. */
  createdProjects: Json[]
  memberSyncs: { projectId: string; userIds: string[] }[]
  guidelineSyncs: { projectId: string; guidelineIds: string[] }[]
  /** Project ids submitted for review, and the reviews posted. */
  submits: string[]
  reviews: { projectId: string; approved: boolean; remarks: string }[]
  project(projectId: string): ProjectState | undefined
  answers(projectId: string): StoredAnswer[]
}

/** The SHA-256 hex digest the login and registration pages send in place of the password. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const tokenOf = (userId: string) => `e2e-token-${userId}`
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** The project's own copy of a guideline and its items, as the backend makes them. */
const cloneId = (projectId: string, id: string) => `${projectId}-${id}`
const itemRow = (guidelineId: string, itemId: string, text: string, index: number) => ({
  itemId,
  guidelineId,
  category: GUIDELINE.categories[0],
  itemDescription: text,
  severity: index % 2 === 0 ? 'major' : 'critical',
  reference: `${GUIDELINE.shortName} ${index + 1}`,
  itemName: null,
  itemCode: null,
  rowType: null,
  helpText: null,
  verbatimClauseText: null,
  answerOptions: null,
})
const projectItems = (projectId: string) =>
  CORE_ITEMS.map((it, i) => itemRow(cloneId(projectId, GUIDELINE.guidelineId), cloneId(projectId, it.key), it.text, i))

function seededProject(stage: CoreSeed['project']): ProjectState | null {
  if (stage === 'none') return null
  const pending = stage === 'pending_review'
  return {
    projectId: SEEDED_PROJECT.id,
    projectTitle: SEEDED_PROJECT.title,
    smPlatform: SEEDED_PROJECT.platform,
    projectStatus: pending ? 'under_review' : 'in_progress',
    submissionStatus: pending ? 'pending_review' : 'not_submitted',
    submissionRemarks: null,
    headAuditorId: HEAD.userId,
    projectNotes: null,
    dueDate: null,
    timeCreated: T0,
    updatedAt: T0,
    memberIds: [HEAD.userId, AUDITOR.userId],
    guidelineIds: [GUIDELINE.guidelineId],
  }
}

/** A fully answered audit: one Yes, one No with a finding, one Partially and one N/A, all by the auditor. */
function seededAnswers(stage: CoreSeed['project']): StoredAnswer[] {
  if (stage !== 'pending_review') return []
  const results: Result[] = ['compliant', 'non_compliant', 'partially', 'not_applicable']
  return CORE_ITEMS.map((it, i) => ({
    projectId: SEEDED_PROJECT.id,
    itemId: cloneId(SEEDED_PROJECT.id, it.key),
    userId: AUDITOR.userId,
    result: results[i],
    notes: '',
    findings: i === 1 ? SEEDED_FINDING : null,
  }))
}

/** Counts like the backend: an item whose auditors disagree, or that is only flagged, is not answered. */
function tally(items: { itemId: string }[], answers: StoredAnswer[]) {
  let answered = 0, compliant = 0, nonCompliant = 0, notApplicable = 0, weighted = 0
  for (const item of items) {
    const results = new Set(answers.filter((a) => a.itemId === item.itemId).map((a) => a.result))
    if (results.size !== 1) continue
    const [result] = [...results]
    if (result === 'needs_review') continue
    answered += 1
    if (result === 'compliant') { compliant += 1; weighted += 1 }
    else if (result === 'partially') { nonCompliant += 1; weighted += 0.5 }
    else if (result === 'non_compliant') nonCompliant += 1
    else notApplicable += 1
  }
  const applicable = answered - notApplicable
  const percentage = applicable > 0 ? Math.round((weighted / applicable) * 1000) / 10 : 0
  return { total: items.length, answered, compliant, nonCompliant, notApplicable, weighted, percentage }
}

/** Installs every stub for one page. */
export async function installCoreStub(page: Page, seed: CoreSeed = { project: 'in_progress' }): Promise<CoreStub> {
  const passwordHash = await sha256Hex(PASSWORD)
  let accounts: Account[] = [HEAD, AUDITOR, SECOND_AUDITOR, ADMIN].map((u) => ({ ...u, passwordHash }))
  const projects = new Map<string, ProjectState>()
  const first = seededProject(seed.project)
  if (first) projects.set(first.projectId, first)
  let answers: StoredAnswer[] = seededAnswers(seed.project)
  let createdCount = 0

  const stub: CoreStub = {
    violations: [],
    logins: [],
    registrations: [],
    createdProjects: [],
    memberSyncs: [],
    guidelineSyncs: [],
    submits: [],
    reviews: [],
    project: (projectId) => projects.get(projectId),
    answers: (projectId) => answers.filter((a) => a.projectId === projectId),
  }

  const update = (projectId: string, changes: Partial<ProjectState>) => {
    const current = projects.get(projectId)
    if (current) projects.set(projectId, { ...current, ...changes, updatedAt: new Date().toISOString() })
  }
  const canSee = (p: ProjectState, user: Account) => p.headAuditorId === user.userId || p.memberIds.includes(user.userId)
  // The project list carries no scope, as the backend list does not; only the details answer has it.
  const projectOut = ({ scope: _scope, ...p }: ProjectState) => ({ ...p, guidelineIds: p.guidelineIds.map((g) => cloneId(p.projectId, g)) })
  const summaryOf = (projectId: string) => tally(projectItems(projectId), stub.answers(projectId))

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

  /** Routes that need no session. */
  const open = (route: Route, method: string, path: string): Promise<void> | null => {
    if (method === 'POST' && path === '/auth/login') {
      const body = route.request().postDataJSON() as { email: string; password: string }
      stub.logins.push(body)
      const user = accounts.find((u) => u.userEmail === String(body.email).trim().toLowerCase())
      if (!user || user.passwordHash !== body.password) return json(route, { error: 'Incorrect email or password.' }, 401)
      const { userId, userName, role } = user
      return json(route, { token: tokenOf(userId), user: { userId, userName, role } })
    }
    if (method === 'POST' && path === '/users') {
      const body = route.request().postDataJSON() as Json
      stub.registrations.push(body)
      const { userId, userName, userEmail, role, userPassword } = body as Record<string, string>
      if (!userId || !userName || !userEmail || !userPassword) {
        return json(route, { error: 'userId, userName, userEmail and userPassword are required.' }, 400)
      }
      if (!UUID.test(userId)) return json(route, { error: 'userId must be a UUID.' }, 400)
      if (role !== 'auditor' && role !== 'head_auditor') return json(route, { error: 'That role cannot be self-registered.' }, 403)
      const email = userEmail.trim().toLowerCase()
      if (accounts.some((u) => u.userEmail === email)) return json(route, { error: 'That record already exists.' }, 409)
      accounts = [...accounts, { userId, userName, userEmail: email, role, passwordHash: userPassword }]
      return json(route, { success: true, token: tokenOf(userId) }, 201)
    }
    return null
  }

  const projectRoutes = async (route: Route, method: string, path: string, user: Account, url: URL): Promise<void> => {
    if (method === 'GET' && path === '/projects') {
      return json(route, [...projects.values()].filter((p) => canSee(p, user)).map(projectOut))
    }
    if (method === 'GET' && path === '/projects/compliance-summary') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter((id) => projects.has(id))
      return json(route, Object.fromEntries(ids.map((id) => {
        const s = summaryOf(id)
        return [id, { percentage: s.percentage, answered: s.answered, total: s.total }]
      })))
    }
    if (method === 'POST' && path === '/projects') {
      if (user.role !== 'head_auditor') return json(route, { error: 'You do not have permission to do this.' }, 403)
      const body = route.request().postDataJSON() as Json
      stub.createdProjects.push(body)
      if (!body.title || !body.platform) return json(route, { error: 'title and platform are required.' }, 400)
      createdCount += 1
      const projectId = createdCount === 1 ? NEW_PROJECT_ID : `p-new-${createdCount}`
      const now = new Date().toISOString()
      projects.set(projectId, {
        projectId,
        projectTitle: String(body.title),
        smPlatform: String(body.platform),
        projectStatus: (body.status as ProjectState['projectStatus']) ?? 'draft',
        submissionStatus: 'not_submitted',
        submissionRemarks: null,
        headAuditorId: user.userId,
        projectNotes: (body.notes as string) || null,
        dueDate: (body.dueDate as string) ?? null,
        timeCreated: now,
        updatedAt: now,
        memberIds: [user.userId],
        guidelineIds: [],
      })
      return json(route, { projectId }, 201)
    }

    const match = /^\/projects\/([^/]+)(\/.*)?$/.exec(path)
    const project = match ? projects.get(match[1]) : undefined
    if (!match || !project) return json(route, { error: 'That project was not found.' }, 404)
    if (!canSee(project, user)) return json(route, { error: 'You do not have access to this project.' }, 403)
    return oneProject(route, method, match[2] ?? '', project, user)
  }

  const oneProject = (route: Route, method: string, rest: string, p: ProjectState, user: Account): Promise<void> => {
    const id = p.projectId
    const isOwner = user.role === 'head_auditor' && p.headAuditorId === user.userId
    const locked = p.submissionStatus === 'pending_review' || p.submissionStatus === 'approved'
    const key = `${method} ${rest}`
    switch (key) {
      case 'GET ':
        return json(route, {
          project: projectOut(p),
          members: p.memberIds.flatMap((uid) => accounts.filter((u) => u.userId === uid))
            .map(({ userId, userName, role }) => ({ userId, userName, role })),
          guidelines: p.guidelineIds.map((gid) => ({ ...GUIDELINE, guidelineId: cloneId(id, gid), originalGuidelineId: gid, itemCount: CORE_ITEMS.length })),
          scope: p.scope ?? [],
        })
      case 'POST /scope': {
        if (!isOwner) return json(route, { error: 'Only the head auditor of this project can do this.' }, 403)
        if (locked) return json(route, { error: 'This audit is locked while it is under review or approved.' }, 403)
        const { features } = route.request().postDataJSON() as { features: string[] }
        update(id, { scope: [...features] })
        return json(route, { success: true })
      }
      case 'POST /members': {
        if (!isOwner) return json(route, { error: 'Only the head auditor of this project can do this.' }, 403)
        const { userIds } = route.request().postDataJSON() as { userIds: string[] }
        stub.memberSyncs.push({ projectId: id, userIds })
        update(id, { memberIds: [...userIds] })
        return json(route, { success: true })
      }
      case 'POST /guidelines': {
        const { guidelineIds } = route.request().postDataJSON() as { guidelineIds: string[] }
        stub.guidelineSyncs.push({ projectId: id, guidelineIds })
        update(id, { guidelineIds: [...guidelineIds] })
        return json(route, { success: true })
      }
      case 'GET /checklist':
        return json(route, p.guidelineIds.length > 0 ? projectItems(id) : [])
      case 'GET /results':
        return json(route, stub.answers(id).map((a) => ({
          resultId: `r-${a.itemId}-${a.userId}`,
          projectId: id,
          itemId: a.itemId,
          userId: a.userId,
          guidelineId: cloneId(id, GUIDELINE.guidelineId),
          result: a.result,
          notes: a.notes,
          findings: a.findings,
          timeSubmitted: '2026-11-04T10:00:00.000Z',
        })))
      case 'POST /results': {
        if (locked) return json(route, { error: 'This audit is locked while it is under review or approved.' }, 403)
        const body = route.request().postDataJSON() as { itemId: string; result: Result; notes?: string }
        const before = answers.find((a) => a.projectId === id && a.itemId === body.itemId && a.userId === user.userId)
        const next: StoredAnswer = { projectId: id, itemId: body.itemId, userId: user.userId, result: body.result, notes: body.notes ?? '', findings: before?.findings ?? null }
        answers = [...answers.filter((a) => a !== before), next]
        return json(route, { success: true, filledIn: [] })
      }
      case 'GET /compliance-scores': {
        const s = summaryOf(id)
        return json(route, p.guidelineIds.map((gid) => ({
          scoreId: `sc-${id}-${gid}`,
          guidelineId: cloneId(id, gid),
          guidelineName: GUIDELINE.guidelineName,
          shortName: GUIDELINE.shortName,
          totalItems: s.total,
          answeredItems: s.answered,
          compliantItems: s.compliant,
          nonCompliantItems: s.nonCompliant,
          notApplicableItems: s.notApplicable,
          weightedCompliant: s.weighted,
          scorePercentage: s.percentage,
          timeCalculated: '2026-11-04T10:00:00.000Z',
        })))
      }
      case 'POST /submit': {
        if (user.role !== 'auditor') return json(route, { error: 'You do not have permission to do this.' }, 403)
        stub.submits.push(id)
        if (p.submissionStatus !== 'not_submitted' && p.submissionStatus !== 'rejected') {
          return json(route, { error: 'This audit has already been submitted.' }, 409)
        }
        const s = summaryOf(id)
        if (s.total === 0 || s.answered < s.total) {
          return json(route, { error: 'This audit cannot be submitted until every checklist item has been answered.' }, 409)
        }
        update(id, { submissionStatus: 'pending_review', projectStatus: 'under_review' })
        return json(route, { success: true })
      }
      case 'POST /review': {
        if (!isOwner) return json(route, { error: 'Only the head auditor of this project can do this.' }, 403)
        const { approved, remarks } = route.request().postDataJSON() as { approved: boolean; remarks: string }
        stub.reviews.push({ projectId: id, approved, remarks })
        if (p.submissionStatus !== 'pending_review') return json(route, { error: 'This audit is not waiting for review.' }, 409)
        update(id, approved
          ? { submissionStatus: 'approved', projectStatus: 'completed', submissionRemarks: remarks }
          : { submissionStatus: 'rejected', projectStatus: 'in_progress', submissionRemarks: remarks })
        return json(route, { success: true })
      }
      case 'POST /activate':
        if (p.projectStatus === 'draft') update(id, { projectStatus: 'in_progress' })
        return json(route, { success: true })
      // The rest of the audit page: resolutions, answers from earlier audits, same-requirement links, photos, agreement.
      case 'GET /resolutions':
      case 'GET /suggestions':
      case 'GET /similar-items':
        return json(route, [])
      case 'GET /evidence':
        return json(route, [])
      case 'POST /suggestions/fill-in':
        return json(route, { filledIn: [] })
      case 'GET /reliability':
        return json(route, { kappa: null, sharedItems: 0, raterPair: null })
    }
    const findings = /^\/results\/([^/]+)\/findings$/.exec(rest)
    if (method === 'PATCH' && findings) {
      if (locked) return json(route, { error: 'This audit is locked while it is under review or approved.' }, 403)
      const row = answers.find((a) => a.projectId === id && a.itemId === findings[1] && a.userId === user.userId)
      if (!row) return json(route, { error: 'Answer the item before adding findings.' }, 404)
      const { findings: text } = route.request().postDataJSON() as { findings: string }
      answers = answers.map((a) => (a === row ? { ...a, findings: text } : a))
      return json(route, { success: true })
    }
    stub.violations.push(`unstubbed ${method} /projects/${id}${rest}`)
    return json(route, { error: 'unstubbed' }, 500)
  }

  const reports = (route: Route, user: Account, url: URL) => {
    const search = (url.searchParams.get('search') ?? '').toLowerCase()
    const rows = [...projects.values()]
      .filter((p) => canSee(p, user) && p.submissionStatus !== 'not_submitted')
      .filter((p) => !search || `${p.projectTitle} ${p.smPlatform}`.toLowerCase().includes(search))
      .map((p) => ({
        projectId: p.projectId,
        projectTitle: p.projectTitle,
        smPlatform: p.smPlatform,
        projectStatus: p.projectStatus,
        submissionStatus: p.submissionStatus,
        submissionRemarks: p.submissionRemarks,
        headAuditorId: p.headAuditorId,
        headAuditorName: accounts.find((u) => u.userId === p.headAuditorId)?.userName ?? 'Unknown',
        timeCreated: p.timeCreated,
        updatedAt: p.updatedAt,
        dueDate: p.dueDate,
        scorePercentage: summaryOf(p.projectId).percentage,
        guidelineIds: p.guidelineIds.map((g) => cloneId(p.projectId, g)),
      }))
    return json(route, rows)
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
    if (EVIDENCE_PATH.test(path)) return json(route, { error: 'AI evidence assessment is not set up on this server.' }, 503)
    const unauthenticated = open(route, method, path)
    if (unauthenticated) return unauthenticated

    const token = (request.headers()['authorization'] ?? '').replace(/^Bearer /, '')
    const user = accounts.find((u) => tokenOf(u.userId) === token)
    if (!user) {
      stub.violations.push(`no session for ${method} ${path}`)
      return json(route, { error: 'Sign in again.' }, 401)
    }
    if (method === 'GET' && path === '/users') {
      // Only an admin sees email addresses.
      return json(route, accounts.map(({ userId, userName, role }) => ({ userId, userName, role })))
    }
    if (method === 'GET' && path === '/guidelines') return json(route, [{ ...GUIDELINE, itemCount: CORE_ITEMS.length }])
    if (method === 'GET' && path === `/guidelines/${GUIDELINE.guidelineId}/items`) {
      return json(route, CORE_ITEMS.map((it, i) => itemRow(GUIDELINE.guidelineId, it.key, it.text, i)))
    }
    if (method === 'GET' && path === '/reports') return reports(route, user, url)
    if (path === '/projects' || path.startsWith('/projects/')) return projectRoutes(route, method, path, user, url)
    stub.violations.push(`unstubbed ${method} ${path}`)
    return json(route, { error: 'unstubbed' }, 500)
  })
  return stub
}

const sessionOf = (u: TestUser) => ({
  state: {
    isAuthenticated: true,
    authToken: tokenOf(u.userId),
    currentUserId: u.userId,
    users: [{ id: u.userId, name: u.userName, role: u.role, initials: 'XX', color: 'bg-slate-500' }],
  },
  version: 0,
})

/** Writes the signed-in session where the app keeps it, before any page script runs. Only when none is there yet. */
export async function seedCoreSession(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript(({ key, session }) => {
    if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, JSON.stringify(session))
  }, { key: SESSION_KEY, session: sessionOf(user) })
}

/** Switches the stored session to another user, as a second person opening the app would. */
export async function switchCoreSession(page: Page, user: TestUser): Promise<void> {
  await page.evaluate(({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)), {
    key: SESSION_KEY,
    session: sessionOf(user),
  })
}

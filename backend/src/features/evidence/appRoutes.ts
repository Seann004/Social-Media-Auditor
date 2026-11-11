/**
 * The HTTP API of app evidence: the app's address, its test accounts, starting an app run, and reading
 * the recorded steps and changed settings. A password is write-only: it is encrypted before it is
 * stored and no answer, log line or error ever carries it or its ciphertext.
 */
import { randomUUID } from 'node:crypto'
import express, { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { requireSession, type Sessions } from '../auth/session.js'
import { checkLoginDomains, isPublicSuffix } from './appLoginDomains.js'
import { TestAccountLabelTakenError, type AppRepository } from './appRepository.js'
import { startAppRun } from './appRunStart.js'
import type { AgeGroup, TestAccount, TestAccountPatch } from './appTypes.js'
import { toAppChangeView, toAppSourceView, toAppStepView, toTestAccountView } from './appViews.js'
import type { AuditData, ProjectAccess } from './auditData.js'
import {
  API_REQUESTS_PER_MINUTE,
  APP_MAX_HANDLES,
  APP_MAX_TEST_ACCOUNTS,
  MAX_BODY_SIZE,
  MAX_ROUTE_PARAM_LENGTH,
  MAX_URL_LENGTH,
  ROUTE_ID_PATTERN,
} from './config.js'
import type { RunQueue } from './queue.js'
import type { EvidenceRepository } from './repository.js'
import { createProjectQueue, jsonErrorHandler, projectGate, route, sessionOf, userLimiter, validParams } from './routeSupport.js'
import { sweepStaleRuns, type RunStartDeps, type StartOutcome } from './runStart.js'
import { encryptSecret, secretAad } from './secrets.js'
import type { PageSummary } from './types.js'
import type { UrlGuard } from './urlGuard.js'
import { toRunView } from './views.js'

export interface AppRouterDeps {
  repo: EvidenceRepository
  appRepo: AppRepository
  audit: AuditData
  queue: RunQueue
  /** A new guard each time: a guard caches DNS answers for as long as it lives. */
  guard: () => UrlGuard
  sessions: Sessions
  /** The project lock shared with the evidence router. */
  acquire: (projectId: string) => (() => void) | null
  /** False when GROQ_API_KEY is missing: app runs cannot start. */
  aiConfigured: boolean
  /** Null when EVIDENCE_SECRET_KEY is not set: no password can be saved and app runs cannot start. Removing an account still works. */
  secretKey: Buffer | null
  requestsPerMinute?: number
}

export const APP_NOT_CONFIGURED = "Checking inside the app isn't configured: set EVIDENCE_SECRET_KEY (32 random bytes, base64)."

const AI_NOT_CONFIGURED = 'AI assessment is not configured on this server: GROQ_API_KEY is missing.'
const PUBLIC_APP_ADDRESS = 'Use a public http or https address for the app.'
const SHARED_APP_ADDRESS = "Use the app's own address, not a shared ending such as github.io or co.uk."
const APP_ADDRESS_USERINFO = 'Leave the user name and password out of the app address.'
const AGE_MISMATCH = 'The age does not match the age group: under 18 needs an age below 18, and adult an age of 18 or more.'
const ADULT_AGE = 18
const TOO_MANY_ACCOUNTS = `This project already has ${APP_MAX_TEST_ACCOUNTS} test accounts.`
const LABEL_TAKEN = 'A test account with this label already exists.'
const RUN_IN_PROGRESS = "Test accounts can't be removed while a run is in progress."
const NO_STEPS = 'This suggestion has no recorded steps.'
/** Far above the per-run item limit, which startAppRun answers with its own sentence. */
const MAX_ITEM_IDS_IN_BODY = 100

const BOTH: readonly ProjectAccess[] = ['head_auditor', 'auditor']

const label = z.string().trim().min(1).max(60)
const accountFields = {
  label,
  ageGroup: z.enum(['under_18', 'adult']),
  age: z.number().int().min(0).max(120).nullable(),
  loginName: z.string().trim().min(1).max(200),
  // Not trimmed: a password is exactly what was typed.
  password: z.string().min(1).max(200),
  handles: z.array(z.string().trim().min(1).max(60)).max(APP_MAX_HANDLES),
}
const createAccountBody = z.object({
  ...accountFields,
  age: accountFields.age.optional(),
  handles: accountFields.handles.optional(),
})
const patchAccountBody = z.object(accountFields).partial()
const appSourceBody = z.object({
  appUrl: z.string().trim().min(1).max(MAX_URL_LENGTH),
  loginDomains: z.array(z.string().max(253)).default([]),
})
const appRunBody = z.object({
  itemIds: z.array(z.string().min(1).max(MAX_ROUTE_PARAM_LENGTH).regex(ROUTE_ID_PATTERN)).max(MAX_ITEM_IDS_IN_BODY),
})

const fail = (res: Response, status: number, error: string): void => {
  res.status(status).json({ error })
}
const invalid = (res: Response): void => fail(res, 400, 'Invalid request')
const notFound = (res: Response, error = 'Not found'): void => fail(res, 404, error)

/**
 * A repository error made safe to log: its message with every secret cut out. The original is kept as
 * `cause` for a debugger; the error log prints only the message.
 */
export function wrapAccountError(err: unknown, secrets: readonly string[]): Error {
  let message = err instanceof Error ? err.message : 'unknown error'
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]')
  return new Error(message, { cause: err })
}

/**
 * Runs an account write. A taken label is passed on as it is, for the 409; any other error is passed
 * on through wrapAccountError, so the error log never holds the password or ciphertext.
 */
async function writeAccount<T>(secrets: string[], write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (err) {
    if (err instanceof TestAccountLabelTakenError) throw err
    throw wrapAccountError(err, secrets)
  }
}

/** False when a known age contradicts the age group the AI will be told. */
const ageFitsGroup = (ageGroup: AgeGroup, age: number | null): boolean =>
  age === null || (ageGroup === 'under_18' ? age < ADULT_AGE : age >= ADULT_AGE)

const labelTaken = (accounts: readonly TestAccount[], wanted: string, exceptId?: string): boolean =>
  accounts.some((a) => a.label === wanted && a.id !== exceptId)

/**
 * The refusal for an app address, or null when it is usable: http(s), no user name or password, not a
 * shared ending (navigation is allowed to the app host's subdomains, so github.io would open every
 * tenant), and let through by the guard. A reserved or private name is left to the guard, which allows
 * one only when EVIDENCE_ALLOWED_PRIVATE_HOSTS lists it.
 */
async function appUrlRefusal(guard: UrlGuard, url: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return PUBLIC_APP_ADDRESS
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return PUBLIC_APP_ADDRESS
  if (parsed.username !== '' || parsed.password !== '') return APP_ADDRESS_USERINFO
  if (isPublicSuffix(parsed.hostname)) return SHARED_APP_ADDRESS
  // One sentence for every guard refusal: the reason would tell whether an internal name exists.
  return (await guard.check(url)).allowed ? null : PUBLIC_APP_ADDRESS
}

export function createAppRouter(deps: AppRouterDeps): Router {
  const router = Router()
  const { repo, appRepo } = deps
  const common = [requireSession(deps.sessions), userLimiter(deps.requestsPerMinute ?? API_REQUESTS_PER_MINUTE), validParams]
  const json = express.json({ limit: MAX_BODY_SIZE })
  const { authorise, onProject } = projectGate(deps.audit)
  const runDeps: RunStartDeps & { appRepo: AppRepository } = { repo, audit: deps.audit, queue: deps.queue, acquire: deps.acquire, appRepo }
  // Account writes of a project one at a time, so the 6-account and label checks hold. Separate from
  // the run lock: a write waits its turn instead of being refused while a run starts.
  const oneAtATime = createProjectQueue()

  /** Without the key no password can be encrypted: adding an account answers 503. */
  const needsKey: RequestHandler = (_req, res, next) => {
    if (deps.secretKey) next()
    else fail(res, 503, APP_NOT_CONFIGURED)
  }
  const keyOf = (): Buffer => deps.secretKey as Buffer

  /** The account in `:accountId`, when it belongs to the project in `:id`. Answers 404 itself otherwise. */
  async function accountOf(res: Response, projectId: string, accountId: string): Promise<TestAccount | null> {
    const account = await appRepo.getTestAccount(accountId)
    if (account && account.projectId === projectId) return account
    notFound(res)
    return null
  }

  /** An account write; a label the database refuses is answered 409, and null is returned. */
  async function saveOrLabelTaken(res: Response, secrets: string[], write: () => Promise<TestAccount>): Promise<TestAccount | null> {
    try {
      return await writeAccount(secrets, write)
    } catch (err) {
      if (!(err instanceof TestAccountLabelTakenError)) throw err
      fail(res, 409, LABEL_TAKEN)
      return null
    }
  }

  const answerStart = (res: Response, outcome: StartOutcome): void => {
    if (outcome.ok) res.status(202).json({ run: toRunView(outcome.run) })
    else fail(res, outcome.status, outcome.error)
  }

  router.get(
    '/projects/:id/app-setup',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      const [app, accounts] = await Promise.all([appRepo.getAppSource(req.params.id), appRepo.listTestAccounts(req.params.id)])
      res.json({ app: app ? toAppSourceView(app) : null, accounts: accounts.map(toTestAccountView), secretKeyConfigured: deps.secretKey !== null })
    }),
  )

  router.put(
    '/projects/:id/app-source',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      const body = appSourceBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      const refusal = await appUrlRefusal(deps.guard(), body.data.appUrl)
      if (refusal) return fail(res, 400, refusal)
      const domains = checkLoginDomains(body.data.loginDomains)
      if (!domains.ok) return fail(res, 400, domains.error)
      const input = { appUrl: body.data.appUrl, loginDomains: domains.domains }
      const app = await appRepo.saveAppSource(req.params.id, input, sessionOf(res).userId)
      res.json({ app: toAppSourceView(app) })
    }),
  )

  router.post(
    '/projects/:id/test-accounts',
    ...common,
    json,
    onProject(BOTH),
    needsKey,
    route(async (req, res) => {
      const body = createAccountBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      const { password, ...fields } = body.data
      if (!ageFitsGroup(fields.ageGroup, fields.age ?? null)) return fail(res, 400, AGE_MISMATCH)
      const projectId = req.params.id
      await oneAtATime(projectId, async () => {
        const existing = await appRepo.listTestAccounts(projectId)
        if (existing.length >= APP_MAX_TEST_ACCOUNTS) return fail(res, 409, TOO_MANY_ACCOUNTS)
        if (labelTaken(existing, fields.label)) return fail(res, 409, LABEL_TAKEN)
        // The id is made first: it is part of what the ciphertext is bound to.
        const id = randomUUID()
        const passwordCiphertext = encryptSecret(password, keyOf(), secretAad(projectId, id))
        const account = await saveOrLabelTaken(res, [password, passwordCiphertext], () =>
          appRepo.addTestAccount({
            ...fields,
            id,
            projectId,
            age: fields.age ?? null,
            // Never the login name: with no handle, actions toward this account are refused.
            handles: fields.handles ?? [],
            passwordCiphertext,
            createdBy: sessionOf(res).userId,
          }),
        )
        if (account) res.status(201).json({ account: toTestAccountView(account) })
      })
    }),
  )

  router.patch(
    '/projects/:id/test-accounts/:accountId',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      const body = patchAccountBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      const { password, ...fields } = body.data
      // Only a new password needs the key: a label, age or handles change touches no secret.
      if (password !== undefined && !deps.secretKey) return fail(res, 503, APP_NOT_CONFIGURED)
      const projectId = req.params.id
      await oneAtATime(projectId, async () => {
        const current = await accountOf(res, projectId, req.params.accountId)
        if (!current) return
        if (!ageFitsGroup(fields.ageGroup ?? current.ageGroup, fields.age === undefined ? current.age : fields.age)) {
          return fail(res, 400, AGE_MISMATCH)
        }
        if (fields.label !== undefined && labelTaken(await appRepo.listTestAccounts(projectId), fields.label, current.id)) {
          return fail(res, 409, LABEL_TAKEN)
        }
        // Without a new password the stored ciphertext is left as it is.
        const passwordCiphertext = password === undefined ? undefined : encryptSecret(password, keyOf(), secretAad(projectId, current.id))
        const patch: TestAccountPatch = { ...fields, ...(passwordCiphertext ? { passwordCiphertext } : {}) }
        const account = await saveOrLabelTaken(res, [password ?? '', passwordCiphertext ?? ''], () =>
          appRepo.updateTestAccount(current.id, patch),
        )
        if (account) res.json({ account: toTestAccountView(account) })
      })
    }),
  )

  router.delete(
    '/projects/:id/test-accounts/:accountId',
    ...common,
    onProject(BOTH),
    // No key needed (ruling A24): removing a stored secret must always be possible.
    route(async (req, res) => {
      const projectId = req.params.id
      const account = await accountOf(res, projectId, req.params.accountId)
      if (!account) return
      // Under the run lock, so that no run starts between the check and the removal.
      const release = deps.acquire(projectId)
      if (!release) return fail(res, 409, RUN_IN_PROGRESS)
      try {
        if (await sweepStaleRuns(runDeps, projectId)) return fail(res, 409, RUN_IN_PROGRESS)
        await appRepo.deleteTestAccount(account.id)
        res.status(204).end()
      } finally {
        release()
      }
    }),
  )

  router.post(
    '/projects/:id/app-runs',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      if (!deps.aiConfigured) return fail(res, 503, AI_NOT_CONFIGURED)
      if (!deps.secretKey) return fail(res, 503, APP_NOT_CONFIGURED)
      const body = appRunBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      answerStart(res, await startAppRun(runDeps, req.params.id, sessionOf(res).userId, body.data.itemIds))
    }),
  )

  router.get(
    '/projects/:id/evidence-runs/:runId/app-changes',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      const run = await repo.getRun(req.params.runId)
      if (!run || run.projectId !== req.params.id) return notFound(res)
      const changes = await appRepo.listChanges(run.capturedInRunId)
      res.json({ changes: changes.map(toAppChangeView) })
    }),
  )

  router.get(
    '/suggestions/:id/steps',
    ...common,
    route(async (req, res) => {
      const suggestion = await repo.getSuggestion(req.params.id)
      if (!suggestion) return notFound(res)
      if (!(await authorise(res, suggestion.projectId, BOTH))) return
      // A copy carried forward shows the steps of the run that first assessed it.
      const origin = suggestion.originSuggestionId ? await repo.getSuggestion(suggestion.originSuggestionId) : suggestion
      if (!origin || origin.source !== 'app') return notFound(res, NO_STEPS)
      const run = await repo.getRun(origin.runId)
      if (!run) return notFound(res, NO_STEPS)
      const [steps, changes] = await Promise.all([
        appRepo.listSteps(run.capturedInRunId, suggestion.itemId),
        appRepo.listChanges(run.capturedInRunId, { itemId: suggestion.itemId }),
      ])
      const pageIds = [...new Set(steps.map((s) => s.pageId).filter((id): id is string => id !== null))]
      const pages = new Map<string, PageSummary>((pageIds.length > 0 ? await repo.getPageSummaries(pageIds) : []).map((p) => [p.id, p]))
      res.json({ steps: steps.map((s) => toAppStepView(s, pages)), changes: changes.map(toAppChangeView) })
    }),
  )

  router.use(jsonErrorHandler)
  return router
}


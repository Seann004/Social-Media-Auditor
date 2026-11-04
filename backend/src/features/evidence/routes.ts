import express, { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { requireSession, type Sessions } from '../auth/session.js'
import type { AuditData, ProjectAccess } from './auditData.js'
import {
  API_REQUESTS_PER_MINUTE,
  MAX_BODY_SIZE,
  MAX_OVERRIDE_REASON_CHARS,
  MAX_PERMISSION_NOTE_CHARS,
  MAX_START_URLS,
  MAX_URL_LENGTH,
  VIEWING_LINK_SECONDS,
} from './config.js'
import { DecisionError, recordDecision } from './decisions.js'
import type { RunQueue } from './queue.js'
import type { EvidenceRepository, ScreenshotStore } from './repository.js'
import { createProjectLock, isAllowed, jsonErrorHandler, route, userLimiter, validParams } from './routeSupport.js'
import { startReassess, startRun, sweepStaleRuns, type RunStartDeps, type StartOutcome } from './runStart.js'
import type { CapturedPage, PageSummary, Suggestion } from './types.js'
import type { UrlGuard } from './urlGuard.js'
import { latestDecisionViews, toDecisionView, toPageView, toRunView, toSuggestionView } from './views.js'

export interface EvidenceRouterDeps {
  repo: EvidenceRepository
  screenshots: ScreenshotStore
  audit: AuditData
  queue: RunQueue
  /** A new guard each time: a guard caches DNS answers for as long as it lives. */
  guard: () => UrlGuard
  sessions: Sessions
  /** False when GROQ_API_KEY is missing: runs cannot start, everything else works. */
  aiConfigured: boolean
  requestsPerMinute?: number
}

const BOTH: readonly ProjectAccess[] = ['head_auditor', 'auditor']
const HEAD_ONLY: readonly ProjectAccess[] = ['head_auditor']
const AUDITOR_ONLY: readonly ProjectAccess[] = ['auditor']

const NOT_CONFIGURED = 'AI assessment is not configured on this server: GROQ_API_KEY is missing.'

const sourcesBody = z.object({
  startUrls: z.array(z.string().trim().min(1).max(MAX_URL_LENGTH)).min(1).max(MAX_START_URLS),
})
const permissionBody = z.object({
  granted: z.boolean(),
  note: z.string().trim().max(MAX_PERMISSION_NOTE_CHARS).optional(),
})
const reassessBody = z.object({ scope: z.enum(['all', 'unfinished']).default('unfinished') })
const decisionBody = z.object({
  decision: z.enum(['accepted', 'overridden']),
  origin: z.enum(['card', 'answer_button']),
  finalResult: z.enum(['compliant', 'non_compliant', 'partially', 'not_applicable']).optional(),
  overrideReason: z.string().max(MAX_OVERRIDE_REASON_CHARS).optional(),
})

const invalid = (res: Response): void => {
  res.status(400).json({ error: 'Invalid request' })
}
const forbidden = (res: Response): void => {
  res.status(403).json({ error: 'You do not have access to this project.' })
}
const notFound = (res: Response): void => {
  res.status(404).json({ error: 'Not found' })
}

const sessionOf = (res: Response): { userId: string; role: string } => res.locals.session

export function createEvidenceRouter(deps: EvidenceRouterDeps): Router {
  const router = Router()
  const { repo, audit } = deps
  const common = [requireSession(deps.sessions), userLimiter(deps.requestsPerMinute ?? API_REQUESTS_PER_MINUTE), validParams]
  const json = express.json({ limit: MAX_BODY_SIZE })
  const acquire = createProjectLock()
  const runDeps: RunStartDeps = { repo, audit, queue: deps.queue, acquire }

  /** The caller's access to a project, checked against the allowed values. Answers 403 itself when it fails. */
  async function authorise(res: Response, projectId: string, allowed: readonly ProjectAccess[]): Promise<boolean> {
    const { userId, role } = sessionOf(res)
    const access = await audit.getProjectAccess(projectId, userId, role)
    if (isAllowed(access, allowed)) return true
    forbidden(res)
    return false
  }

  const onProject = (allowed: readonly ProjectAccess[]): RequestHandler =>
    route(async (req, res, next) => {
      if (await authorise(res, req.params.id, allowed)) next()
    })

  const answerStart = (res: Response, outcome: StartOutcome): void => {
    if (outcome.ok) res.status(202).json({ run: toRunView(outcome.run) })
    else res.status(outcome.status).json({ error: outcome.error })
  }

  router.get(
    '/projects/:id/evidence-sources',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      const [source, permission] = await Promise.all([repo.getSource(req.params.id), repo.getPermission(req.params.id)])
      res.json({ source, permission })
    }),
  )

  router.post(
    '/projects/:id/evidence-sources',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      const body = sourcesBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      const refusals = await Promise.all(
        body.data.startUrls.map(async (url, i) => {
          const verdict = await deps.guard().check(url)
          // One message for every refusal: the reason would tell whether an internal name exists.
          return verdict.allowed ? null : `Address ${i + 1} was refused: use a public http or https address.`
        }),
      )
      const first = refusals.find((r) => r !== null)
      if (first) {
        res.status(400).json({ error: first })
        return
      }
      const source = await repo.saveSource(req.params.id, body.data.startUrls, sessionOf(res).userId)
      res.json({ source })
    }),
  )

  router.put(
    '/projects/:id/evidence-permission',
    ...common,
    json,
    onProject(HEAD_ONLY),
    route(async (req, res) => {
      const body = permissionBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      const { granted, note } = body.data
      const permission = await repo.setPermission(req.params.id, granted, note ? note : null, sessionOf(res).userId)
      res.json({ permission })
    }),
  )

  router.post(
    '/projects/:id/evidence-runs',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      if (!deps.aiConfigured) {
        res.status(503).json({ error: NOT_CONFIGURED })
        return
      }
      answerStart(res, await startRun(runDeps, req.params.id, sessionOf(res).userId))
    }),
  )

  router.post(
    '/projects/:id/evidence-runs/:runId/reassess',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      if (!deps.aiConfigured) {
        res.status(503).json({ error: NOT_CONFIGURED })
        return
      }
      const body = reassessBody.safeParse(req.body ?? {})
      if (!body.success) return invalid(res)
      answerStart(res, await startReassess(runDeps, req.params.id, sessionOf(res).userId, req.params.runId, body.data.scope))
    }),
  )

  router.get(
    '/projects/:id/evidence-runs/latest',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      // A lost run is failed here too, so the page that polls can offer a new run.
      await sweepStaleRuns(runDeps, req.params.id)
      const run = await repo.latestRun(req.params.id)
      const pages = run ? await repo.listPageSummaries(run.capturedInRunId) : []
      res.json({ run: run ? toRunView(run) : null, pages: pages.map(toPageView) })
    }),
  )

  router.get(
    '/projects/:id/suggestions',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      const run = await repo.latestResultRun(req.params.id)
      if (!run) {
        res.json({ run: null, suggestions: [], decisions: [] })
        return
      }
      const pages = new Map<string, PageSummary>((await repo.listPageSummaries(run.capturedInRunId)).map((p) => [p.id, p]))
      const found = await repo.listSuggestions(run.id)
      const decisions = await latestDecisionViews(repo, req.params.id, found)
      res.json({ run: toRunView(run), suggestions: found.map((s) => toSuggestionView(s, pages)), decisions })
    }),
  )

  router.post(
    '/suggestions/:id/decision',
    ...common,
    json,
    route(async (req, res) => {
      const suggestion = await repo.getSuggestion(req.params.id)
      if (!suggestion) return notFound(res)
      if (!(await authorise(res, suggestion.projectId, AUDITOR_ONLY))) return
      const body = decisionBody.safeParse(req.body)
      if (!body.success) return invalid(res)
      await decide(res, suggestion, body.data)
    }),
  )

  async function decide(res: Response, suggestion: Suggestion, body: z.infer<typeof decisionBody>): Promise<void> {
    try {
      const done = await recordDecision(
        { ...body, suggestionId: suggestion.id, userId: sessionOf(res).userId },
        { repo, audit, screenshots: deps.screenshots },
      )
      res.json({ decision: toDecisionView(done.decision, suggestion.suggestedResult), answer: done.answer })
    } catch (err) {
      if (!(err instanceof DecisionError)) throw err
      res.status(err.status).json({ error: err.message })
    }
  }

  /** The project a captured page belongs to: the run that captured it. Null when either is gone. */
  async function projectOfPage(page: CapturedPage): Promise<string | null> {
    const run = await repo.getRun(page.runId)
    return run ? run.projectId : null
  }

  async function signFor(res: Response, projectId: string | null, path: string | null): Promise<void> {
    if (projectId === null) return notFound(res)
    if (!(await authorise(res, projectId, BOTH))) return
    if (path === null) return notFound(res)
    res.json({ url: await deps.screenshots.signedUrl(path, VIEWING_LINK_SECONDS) })
  }

  router.get(
    '/evidence/screenshots/page/:id',
    ...common,
    route(async (req, res) => {
      const page = await repo.getPage(req.params.id)
      if (!page) return notFound(res)
      await signFor(res, await projectOfPage(page), page.screenshotPath)
    }),
  )

  router.get(
    '/evidence/screenshots/quote/:id',
    ...common,
    route(async (req, res) => {
      const quote = await repo.getQuote(req.params.id)
      if (!quote) return notFound(res)
      const page = quote.pageId ? await repo.getPage(quote.pageId) : null
      if (!page) return notFound(res)
      await signFor(res, await projectOfPage(page), quote.highlightScreenshotPath ?? page.screenshotPath)
    }),
  )

  router.use(jsonErrorHandler)
  return router
}

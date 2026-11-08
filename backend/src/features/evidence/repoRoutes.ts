/**
 * The HTTP API of repository evidence: the repository's address, starting a code run, and reading the
 * code pieces behind a suggestion.
 */
import express, { Router, type Response } from 'express'
import { z } from 'zod'
import { requireSession, type Sessions } from '../auth/session.js'
import type { AuditData, ProjectAccess } from './auditData.js'
import { API_REQUESTS_PER_MINUTE, MAX_BODY_SIZE, MAX_ROUTE_PARAM_LENGTH, MAX_URL_LENGTH, ROUTE_ID_PATTERN } from './config.js'
import type { RunQueue } from './queue.js'
import { isValidBranch, parseRepoUrl } from './repoAddress.js'
import type { RepoRepository } from './repoRepository.js'
import { startRepoRun } from './repoRunStart.js'
import { toCodePieceView, toRepoSourceView, type CodePieceView } from './repoViews.js'
import type { EvidenceRepository } from './repository.js'
import { jsonErrorHandler, projectGate, route, sessionOf, userLimiter, validParams } from './routeSupport.js'
import type { RunStartDeps, StartOutcome } from './runStart.js'
import { toRunView } from './views.js'

export interface RepoRouterDeps {
  repo: EvidenceRepository
  repoRepo: RepoRepository
  audit: AuditData
  queue: RunQueue
  sessions: Sessions
  /** The project lock shared with the evidence and app routers. */
  acquire: (projectId: string) => (() => void) | null
  /** False when GROQ_API_KEY is missing: code runs cannot start. */
  aiConfigured: boolean
  requestsPerMinute?: number
}

const AI_NOT_CONFIGURED = 'AI assessment is not configured on this server: GROQ_API_KEY is missing.'
const BAD_ADDRESS = 'Enter a public GitHub repository address, like https://github.com/owner/name.'
const BAD_BRANCH = "That branch name isn't valid."
const NO_CODE = 'This suggestion has no code from a repository.'
/** Far above the per-run item limit, which startRepoRun answers with its own sentence. */
const MAX_ITEM_IDS_IN_BODY = 100

const BOTH: readonly ProjectAccess[] = ['head_auditor', 'auditor']

const repoSourceBody = z.object({
  repoUrl: z.string().trim().min(1).max(MAX_URL_LENGTH),
  branch: z.string().nullish(),
})
const repoRunBody = z.object({
  itemIds: z.array(z.string().min(1).max(MAX_ROUTE_PARAM_LENGTH).regex(ROUTE_ID_PATTERN)).max(MAX_ITEM_IDS_IN_BODY),
})

const fail = (res: Response, status: number, error: string): void => {
  res.status(status).json({ error })
}

export function createRepoRouter(deps: RepoRouterDeps): Router {
  const router = Router()
  const { repo, repoRepo } = deps
  const common = [requireSession(deps.sessions), userLimiter(deps.requestsPerMinute ?? API_REQUESTS_PER_MINUTE), validParams]
  const json = express.json({ limit: MAX_BODY_SIZE })
  const { authorise, onProject } = projectGate(deps.audit)
  const runDeps: RunStartDeps & { repoRepo: RepoRepository } = { repo, audit: deps.audit, queue: deps.queue, acquire: deps.acquire, repoRepo }

  const answerStart = (res: Response, outcome: StartOutcome): void => {
    if (outcome.ok) res.status(202).json({ run: toRunView(outcome.run) })
    else fail(res, outcome.status, outcome.error)
  }

  router.get(
    '/projects/:id/repo-source',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      const source = await repoRepo.getRepoSource(req.params.id)
      res.json({ repo: source ? toRepoSourceView(source) : null })
    }),
  )

  router.put(
    '/projects/:id/repo-source',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      const body = repoSourceBody.safeParse(req.body)
      if (!body.success) return fail(res, 400, BAD_ADDRESS)
      const parsed = parseRepoUrl(body.data.repoUrl)
      if (!parsed) return fail(res, 400, BAD_ADDRESS)
      const rawBranch = body.data.branch?.trim() ?? ''
      if (rawBranch !== '' && !isValidBranch(rawBranch)) return fail(res, 400, BAD_BRANCH)
      const source = await repoRepo.saveRepoSource(
        req.params.id,
        { repoUrl: parsed.repoUrl, owner: parsed.owner, name: parsed.name, branch: rawBranch === '' ? null : rawBranch },
        sessionOf(res).userId,
      )
      res.json({ repo: toRepoSourceView(source) })
    }),
  )

  router.post(
    '/projects/:id/repo-runs',
    ...common,
    json,
    onProject(BOTH),
    route(async (req, res) => {
      if (!deps.aiConfigured) return fail(res, 503, AI_NOT_CONFIGURED)
      const body = repoRunBody.safeParse(req.body)
      if (!body.success) return fail(res, 400, 'Invalid request')
      answerStart(res, await startRepoRun(runDeps, req.params.id, sessionOf(res).userId, body.data.itemIds))
    }),
  )

  router.get(
    '/suggestions/:id/code',
    ...common,
    route(async (req, res) => {
      const suggestion = await repo.getSuggestion(req.params.id)
      if (!suggestion) return fail(res, 404, 'Not found')
      if (!(await authorise(res, suggestion.projectId, BOTH))) return
      // A copy carried forward shows the code of the run that first assessed it.
      const origin = suggestion.originSuggestionId ? await repo.getSuggestion(suggestion.originSuggestionId) : suggestion
      if (!origin || origin.source !== 'repo') return fail(res, 404, NO_CODE)
      const run = await repo.getRun(origin.runId)
      if (!run) return fail(res, 404, NO_CODE)
      const [snapshot, pieces] = await Promise.all([
        repoRepo.getSnapshot(run.capturedInRunId),
        repoRepo.listPieces(run.capturedInRunId, suggestion.itemId),
      ])
      const quotedPages = new Set(origin.quotes.filter((q) => q.verified && q.pageId !== null).map((q) => q.pageId))
      const views: CodePieceView[] = []
      for (const piece of pieces) {
        const page = await repo.getPage(piece.pageId)
        if (page) views.push(toCodePieceView(piece, page, quotedPages.has(piece.pageId)))
      }
      res.json({ commitSha: snapshot?.commitSha ?? null, repoUrl: snapshot?.repoUrl ?? null, pieces: views })
    }),
  )

  router.use(jsonErrorHandler)
  return router
}

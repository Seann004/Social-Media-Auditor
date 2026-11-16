import { Router, type RequestHandler } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabaseAdmin.js'
import { sessionsFromEnv } from '../auth/session.js'
import type { AppRepository } from './appRepository.js'
import { createAppRouter } from './appRoutes.js'
import { createAuditData, type AuditData } from './auditData.js'
import { MAX_ROUTE_PARAM_LENGTH, ROUTE_ID_PATTERN } from './config.js'
import { createItemKindRouter } from './itemKindRoutes.js'
import { createRunQueue } from './queue.js'
import { createRepoRouter } from './repoRoutes.js'
import type { RepoRepository } from './repoRepository.js'
import type { EvidenceRepository, ScreenshotStore } from './repository.js'
import { createProjectLock } from './routeSupport.js'
import { createEvidenceRouter } from './routes.js'
import { runEvidenceJob, type RunnerDeps } from './runner.js'
import { parseSecretKey } from './secrets.js'
import { createSupabaseAppRepository } from './supabaseAppRepository.js'
import { createSupabaseRepoRepository } from './supabaseRepoRepository.js'
import { createSupabaseRepository, createSupabaseScreenshotStore } from './supabaseRepository.js'
import { createUrlGuard } from './urlGuard.js'

export interface EvidenceModule {
  routers: Router[]
  /** Fails the runs a restart left in progress. Logs instead of throwing. */
  start(): Promise<void>
  /** Best effort: logs instead of throwing. */
  removeProjectScreenshots(projectId: string): Promise<void>
}

export interface EvidenceModuleOptions {
  /** For tests. Defaults to the service-role client. */
  admin?: () => SupabaseClient | null
  repo?: EvidenceRepository
  screenshots?: ScreenshotStore
  audit?: AuditData
  appRepo?: AppRepository
  repoRepo?: RepoRepository
  requestsPerMinute?: number
  /** For tests. Defaults to runEvidenceJob. */
  runJob?: (runId: string, deps: RunnerDeps) => Promise<void>
}

type Env = Record<string, string | undefined>

export const NOT_CONFIGURED_MESSAGE =
  "AI evidence assessment isn't configured: set JWT_SECRET (at least 32 characters) and SUPABASE_SERVICE_ROLE_KEY"

/**
 * The evidence model. EVIDENCE_GROQ_MODEL overrides it; GROQ_MODEL is left to the app's other AI
 * features, whose model may not support reasoning_effort or JSON mode.
 */
export const DEFAULT_EVIDENCE_MODEL = 'openai/gpt-oss-120b'

const SECRET_KEY_MISSING = '[evidence] EVIDENCE_SECRET_KEY is not set: test accounts and app runs are unavailable.'

/** Every path of this module, so that an unconfigured server answers 503 on these and no others. */
const EVIDENCE_PATHS = [
  '/projects/:id/evidence-sources',
  '/projects/:id/evidence-permission',
  '/projects/:id/evidence-runs',
  '/projects/:id/evidence-runs/latest',
  '/projects/:id/evidence-runs/:runId/reassess',
  '/projects/:id/ai-suggestions',
  '/suggestions/:id/decision',
  '/evidence/screenshots/page/:id',
  '/evidence/screenshots/quote/:id',
  '/projects/:id/app-setup',
  '/projects/:id/app-source',
  '/projects/:id/test-accounts',
  '/projects/:id/test-accounts/:accountId',
  '/projects/:id/app-runs',
  '/projects/:id/evidence-runs/:runId/app-changes',
  '/suggestions/:id/steps',
  '/projects/:id/repo-source',
  '/projects/:id/repo-runs',
  '/suggestions/:id/code',
  '/projects/:id/item-kinds',
]

function unconfiguredRouter(): Router {
  const router = Router()
  const answer: RequestHandler = (_req, res) => {
    res.status(503).json({ error: NOT_CONFIGURED_MESSAGE })
  }
  router.all(EVIDENCE_PATHS, answer)
  return router
}

function allowedPrivateHosts(env: Env): string[] {
  return (env.EVIDENCE_ALLOWED_PRIVATE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '')
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error'
}

const disabled = (): EvidenceModule => ({
  routers: [unconfiguredRouter()],
  start: async () => undefined,
  removeProjectScreenshots: async () => undefined,
})

/**
 * Builds the evidence feature: the evidence, app, repo and item kinds routers, the job queue and the start-up step.
 * Importing this file opens no connection and starts no browser; that happens when a job runs.
 * The routes accept the app login token (`POST /api/auth/login`), checked with JWT_SECRET. Without a
 * JWT_SECRET of at least 32 characters, or without the service key, the feature is off (its routes
 * answer 503) and the rest of the app is untouched: this never throws for a missing or short secret.
 * An EVIDENCE_SECRET_KEY that is set but not 32 bytes of base64 throws. Without EVIDENCE_SECRET_KEY
 * the rest works, but not test accounts or app runs.
 */
export function createEvidenceModule(env: Env, options: EvidenceModuleOptions = {}): EvidenceModule {
  const sessions = sessionsFromEnv(env)
  const secretKey = parseSecretKey(env.EVIDENCE_SECRET_KEY)
  const admin = sessions && env.SUPABASE_SERVICE_ROLE_KEY ? (options.admin ?? getSupabaseAdmin)() : null
  if (!sessions || !env.SUPABASE_SERVICE_ROLE_KEY || (!admin && !(options.repo && options.screenshots && options.audit))) {
    console.error(`[evidence] ${NOT_CONFIGURED_MESSAGE}. The evidence routes answer 503 until then.`)
    return disabled()
  }

  const repo = options.repo ?? createSupabaseRepository(admin as SupabaseClient)
  const screenshots = options.screenshots ?? createSupabaseScreenshotStore(admin as SupabaseClient)
  const audit = options.audit ?? createAuditData({ client: () => admin })
  const appRepo = options.appRepo ?? createSupabaseAppRepository(admin as SupabaseClient)
  const repoRepo = options.repoRepo ?? createSupabaseRepoRepository(admin as SupabaseClient)
  const hosts = allowedPrivateHosts(env)
  const guard = () => createUrlGuard({ allowedPrivateHosts: hosts })
  const apiKey = env.GROQ_API_KEY ?? ''
  const model = env.EVIDENCE_GROQ_MODEL || DEFAULT_EVIDENCE_MODEL

  if (!apiKey) console.error('[evidence] GROQ_API_KEY is not set: suggestions can be read but runs cannot start.')
  if (!secretKey) console.error(SECRET_KEY_MISSING)

  const queue = createRunQueue((runId) =>
    (options.runJob ?? runEvidenceJob)(runId, {
      repo,
      screenshots,
      audit,
      guard: guard(),
      apiKey,
      model,
      app: { appRepo, secretKey },
      code: { repoRepo },
    }),
  )
  // One lock for both routers: a page run and an app run of a project never start at the same time.
  const acquire = createProjectLock()
  const aiConfigured = apiKey !== ''
  const requestsPerMinute = options.requestsPerMinute

  return {
    routers: [
      createEvidenceRouter({
        repo,
        screenshots,
        audit,
        queue,
        guard,
        sessions,
        aiConfigured,
        acquire,
        appRepo,
        repoRepo,
        requestsPerMinute,
      }),
      createAppRouter({ repo, appRepo, audit, queue, guard, sessions, acquire, aiConfigured, secretKey, requestsPerMinute }),
      createRepoRouter({ repo, repoRepo, audit, queue, sessions, acquire, aiConfigured, requestsPerMinute }),
      createItemKindRouter({ audit, sessions, aiConfigured, apiKey, model, requestsPerMinute }),
    ],
    async start() {
      try {
        await repo.markInterruptedRuns()
      } catch (err) {
        console.error('[evidence] Could not fail the runs a restart left in progress:', reasonOf(err))
      }
    },
    async removeProjectScreenshots(projectId) {
      if (projectId.length > MAX_ROUTE_PARAM_LENGTH || !ROUTE_ID_PATTERN.test(projectId)) {
        console.error('[evidence] Not removing screenshots: the project id has an unexpected shape.')
        return
      }
      try {
        await screenshots.removeProject(projectId)
      } catch (err) {
        console.error(`[evidence] Could not remove the screenshots of project ${projectId}:`, reasonOf(err))
      }
    },
  }
}

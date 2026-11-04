import { Router, type RequestHandler } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabaseAdmin.js'
import { createAuthRouter, verifyLoginWithSupabase } from '../auth/routes.js'
import { createSessions } from '../auth/session.js'
import { createAuditData, type AuditData } from './auditData.js'
import { MAX_ROUTE_PARAM_LENGTH } from './config.js'
import { createRunQueue } from './queue.js'
import type { EvidenceRepository, ScreenshotStore } from './repository.js'
import { createEvidenceRouter } from './routes.js'
import { runEvidenceJob } from './runner.js'
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
  requestsPerMinute?: number
}

type Env = Record<string, string | undefined>

export const NOT_CONFIGURED_MESSAGE =
  "AI evidence assessment isn't configured: set SESSION_SECRET and SUPABASE_SERVICE_ROLE_KEY"

/** The same default as the older Groq routes in server.ts. */
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'
const PROJECT_ID_PATTERN = /^[A-Za-z0-9-]+$/

/** Every path of this module, so that an unconfigured server answers 503 on these and no others. */
const EVIDENCE_PATHS = [
  '/auth/login',
  '/projects/:id/evidence-sources',
  '/projects/:id/evidence-permission',
  '/projects/:id/evidence-runs',
  '/projects/:id/evidence-runs/latest',
  '/projects/:id/evidence-runs/:runId/reassess',
  '/projects/:id/suggestions',
  '/suggestions/:id/decision',
  '/evidence/screenshots/page/:id',
  '/evidence/screenshots/quote/:id',
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
 * Builds the evidence feature: the login and evidence routers, the job queue and the start-up step.
 * Importing this file opens no connection and starts no browser; that happens when a job runs.
 * Without SESSION_SECRET or the service key the feature is off and the rest of the app is untouched.
 * A SESSION_SECRET that is set but too short throws.
 */
export function createEvidenceModule(env: Env, options: EvidenceModuleOptions = {}): EvidenceModule {
  const secret = env.SESSION_SECRET
  const admin = secret && env.SUPABASE_SERVICE_ROLE_KEY ? (options.admin ?? getSupabaseAdmin)() : null
  if (!secret || !env.SUPABASE_SERVICE_ROLE_KEY || (!admin && !(options.repo && options.screenshots && options.audit))) {
    console.error(`[evidence] ${NOT_CONFIGURED_MESSAGE}. The evidence routes answer 503 until then.`)
    return disabled()
  }
  const sessions = createSessions(secret)

  const repo = options.repo ?? createSupabaseRepository(admin as SupabaseClient)
  const screenshots = options.screenshots ?? createSupabaseScreenshotStore(admin as SupabaseClient)
  const audit = options.audit ?? createAuditData({ client: () => admin })
  const hosts = allowedPrivateHosts(env)
  const guard = () => createUrlGuard({ allowedPrivateHosts: hosts })
  const apiKey = env.GROQ_API_KEY ?? ''
  const model = env.GROQ_MODEL || DEFAULT_MODEL

  if (!apiKey) console.error('[evidence] GROQ_API_KEY is not set: suggestions can be read but runs cannot start.')

  const queue = createRunQueue((runId) =>
    runEvidenceJob(runId, { repo, screenshots, audit, guard: guard(), apiKey, model }),
  )

  return {
    routers: [
      createAuthRouter({ verifyLogin: verifyLoginWithSupabase, sessions }),
      createEvidenceRouter({
        repo,
        screenshots,
        audit,
        queue,
        guard,
        sessions,
        aiConfigured: apiKey !== '',
        requestsPerMinute: options.requestsPerMinute,
      }),
    ],
    async start() {
      try {
        await repo.markInterruptedRuns()
      } catch (err) {
        console.error('[evidence] Could not fail the runs a restart left in progress:', reasonOf(err))
      }
    },
    async removeProjectScreenshots(projectId) {
      if (projectId.length > MAX_ROUTE_PARAM_LENGTH || !PROJECT_ID_PATTERN.test(projectId)) {
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

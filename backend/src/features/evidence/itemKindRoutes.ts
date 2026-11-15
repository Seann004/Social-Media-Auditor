/**
 * The HTTP API of item kinds: which source (the App, the Code, both or neither) can most likely answer
 * each checklist item of a project. Only high-confidence answers are given; nothing is stored.
 */
import { Router } from 'express'
import { requireSession, type Sessions } from '../auth/session.js'
import type { AuditData, ProjectAccess } from './auditData.js'
import { API_REQUESTS_PER_MINUTE } from './config.js'
import { ITEM_KINDS_MAX_ITEMS, classifyItemKinds, confidentKinds, type ClassifyOptions, type ClassifyResult, type KindItem } from './itemKinds.js'
import { createProjectQueue, jsonErrorHandler, projectGate, route, userLimiter, validParams } from './routeSupport.js'

export interface ItemKindRouterDeps {
  audit: Pick<AuditData, 'listChecklistItems' | 'getProjectAccess'>
  sessions: Sessions
  /** False when GROQ_API_KEY is missing: the route answers 503, as the run routes do. */
  aiConfigured: boolean
  apiKey: string
  model: string
  requestsPerMinute?: number
  /** For tests. Defaults to classifyItemKinds with the process's shared cache. */
  classify?: (items: KindItem[], opts: ClassifyOptions) => Promise<ClassifyResult>
}

const AI_NOT_CONFIGURED = 'AI assessment is not configured on this server: GROQ_API_KEY is missing.'
const BOTH: readonly ProjectAccess[] = ['head_auditor', 'auditor']

export function createItemKindRouter(deps: ItemKindRouterDeps): Router {
  const router = Router()
  const common = [requireSession(deps.sessions), userLimiter(deps.requestsPerMinute ?? API_REQUESTS_PER_MINUTE), validParams]
  const { onProject } = projectGate(deps.audit)
  const classify = deps.classify ?? classifyItemKinds
  // One project at a time: a second request waits, then finds the first one's answers in the cache.
  const oneAtATime = createProjectQueue()

  router.post(
    '/projects/:id/item-kinds',
    ...common,
    onProject(BOTH),
    route(async (req, res) => {
      if (!deps.aiConfigured) {
        res.status(503).json({ error: AI_NOT_CONFIGURED })
        return
      }
      const projectId = req.params.id
      const checklist = await deps.audit.listChecklistItems(projectId)
      const items: KindItem[] = checklist
        .slice(0, ITEM_KINDS_MAX_ITEMS)
        .map((i) => ({ id: i.id, text: i.text, name: i.name, category: i.category, helpText: i.helpText }))
      const result = await oneAtATime(projectId, () => classify(items, { apiKey: deps.apiKey, model: deps.model }))
      res.json({ kinds: confidentKinds(result.answers) })
    }),
  )

  router.use(jsonErrorHandler)
  return router
}

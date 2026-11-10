import { Router, type Response } from 'express'
import * as db from '../services/dbService.js'
import * as mapping from '../services/mappingService.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { requireProjectAccess, requireProjectOwner } from '../middleware/projectAccess.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ACCEPT_ITEMS = 500
const STATUSES = ['suggested', 'confirmed', 'rejected']
const RELATIONS = ['equivalent', 'partial']

interface Deps {
  /** Sends a prompt to the model and returns its parsed JSON reply. */
  ask: mapping.AskModel
}

function sendError(res: Response, error: unknown) {
  if (error instanceof db.EditLockedError) {
    return res.status(403).json({ error: error.message })
  }
  if (error instanceof mapping.SuggestionNotFoundError || error instanceof mapping.MappingNotFoundError) {
    return res.status(404).json({ error: error.message })
  }
  if (error instanceof mapping.MappingFailedError) {
    return res.status(502).json({ error: error.message })
  }
  console.error(error)
  if (error && typeof error === 'object' && 'code' in error && 'details' in error) {
    return res.status(500).json({ error: 'Something went wrong while saving. Please try again.' })
  }
  res.status(500).json({ error: error instanceof Error ? error.message : (error as any)?.message || JSON.stringify(error) })
}

/** Returns an error message for a bad review body, or null when it is fine. */
function reviewBodyProblem(body: { status?: unknown; relation?: unknown }): string | null {
  if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) {
    return 'status must be suggested, confirmed or rejected.'
  }
  if (body.relation !== undefined && (typeof body.relation !== 'string' || !RELATIONS.includes(body.relation))) {
    return 'relation must be equivalent or partial.'
  }
  return null
}

/**
 * Cross-guideline links and answer reuse. Admins manage the shared links; a project's head auditor
 * decides which links that project uses; auditors reuse answers. Needs the app's JSON body parser.
 */
export function createMappingRouter({ ask }: Deps): Router {
  const router = Router()

  // ----- shared links (admin) -----

  router.post('/guidelines/:id/mappings/generate', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Guideline not found.' })
      res.json(await mapping.generateMappingsForGuideline(req.params.id, ask))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.get('/mappings', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const guidelineId = typeof req.query.guidelineId === 'string' ? req.query.guidelineId : undefined
      res.json(await mapping.fetchMappings(guidelineId))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.get('/mappings/coverage', requireAuth, async (_req, res) => {
    try {
      res.json(await mapping.fetchCoverage())
    } catch (error) {
      sendError(res, error)
    }
  })

  router.patch('/mappings/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Mapping not found.' })
      const problem = reviewBodyProblem(req.body ?? {})
      if (problem) return res.status(400).json({ error: problem })
      await mapping.reviewMapping(req.params.id, req.body.status, req.body.relation, req.user!.userId)
      res.json({ success: true })
    } catch (error) {
      sendError(res, error)
    }
  })

  // ----- this project's links (head auditor of the project) -----

  router.get('/projects/:id/mappings', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
    try {
      res.json(await mapping.fetchProjectMappings(req.params.id))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.post('/projects/:id/mappings/generate', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
    try {
      res.json(await mapping.generateMappingsForProject(req.params.id, ask))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.patch('/projects/:id/mappings/:mappingId', requireAuth, requireRole('head_auditor'), requireProjectOwner('id'), async (req, res) => {
    try {
      if (!UUID_RE.test(req.params.mappingId)) return res.status(404).json({ error: 'Mapping not found.' })
      const problem = reviewBodyProblem(req.body ?? {})
      if (problem) return res.status(400).json({ error: problem })
      await mapping.reviewProjectMapping(req.params.id, req.params.mappingId, req.body.status, req.body.relation, req.user!.userId)
      res.json({ success: true })
    } catch (error) {
      sendError(res, error)
    }
  })

  // ----- answer reuse (auditors) -----

  router.get('/projects/:id/suggestions', requireAuth, requireProjectAccess('id'), async (req, res) => {
    try {
      res.json(await mapping.fetchProjectSuggestions(req.params.id, req.user!.userId))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.post('/projects/:id/suggestions/accept', requireAuth, requireRole('auditor'), requireProjectAccess('id'), async (req, res) => {
    try {
      const itemIds = req.body?.itemIds
      if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > MAX_ACCEPT_ITEMS
        || !itemIds.every((i) => typeof i === 'string' && UUID_RE.test(i))) {
        return res.status(400).json({ error: `itemIds must be a list of 1 to ${MAX_ACCEPT_ITEMS} item ids.` })
      }
      res.json({ accepted: await mapping.acceptSuggestions(req.params.id, req.user!.userId, itemIds) })
    } catch (error) {
      sendError(res, error)
    }
  })

  router.post('/projects/:id/suggestions/dismiss', requireAuth, requireRole('auditor'), requireProjectAccess('id'), async (req, res) => {
    try {
      const { itemId, sourceItemId } = req.body ?? {}
      if (typeof itemId !== 'string' || typeof sourceItemId !== 'string') {
        return res.status(400).json({ error: 'itemId and sourceItemId are required.' })
      }
      await mapping.dismissSuggestion(req.params.id, req.user!.userId, itemId, sourceItemId)
      res.json({ success: true })
    } catch (error) {
      sendError(res, error)
    }
  })

  return router
}

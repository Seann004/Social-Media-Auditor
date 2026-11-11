import { Router, type Response } from 'express'
import * as db from '../services/dbService.js'
import * as mapping from '../services/mappingService.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { requireProjectAccess } from '../middleware/projectAccess.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ACCEPT_ITEMS = 500
const REVIEW_STATUSES = ['confirmed', 'rejected', 'suggested']
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

/**
 * Finding similar checklist items, and reusing answers between them.
 *
 * When a guideline is uploaded the AI compares its items with all the others and saves the pairs with a
 * confidence score. An admin approves or rejects each pair. Auditors on a project only see approved pairs,
 * and can reuse answers between them. Needs the app's JSON body parser.
 */
export function createMappingRouter({ ask }: Deps): Router {
  const router = Router()
  const onProject = [requireAuth, requireRole('head_auditor', 'auditor'), requireProjectAccess('id')]
  // One check per guideline at a time: the AI call is slow and costs tokens, so a second press waits.
  const checking = new Set<string>()

  router.get('/projects/:id/similar-items', ...onProject, async (req, res) => {
    try {
      res.json(await mapping.fetchProjectSimilarItems(req.params.id))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.get('/mappings', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const guidelineId = typeof req.query.guidelineId === 'string' ? req.query.guidelineId : undefined
      if (guidelineId !== undefined && !UUID_RE.test(guidelineId)) {
        return res.status(400).json({ error: 'guidelineId must be a valid id.' })
      }
      res.json(await mapping.fetchMappings(guidelineId))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.patch('/mappings/:id', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const { status, relation } = req.body ?? {}
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid mapping id.' })
      if (!REVIEW_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'status must be confirmed, rejected or suggested.' })
      }
      if (relation !== undefined && !RELATIONS.includes(relation)) {
        return res.status(400).json({ error: 'relation must be equivalent or partial.' })
      }
      res.json(await mapping.reviewMapping(req.params.id, status, relation, req.user!.userId))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.post('/guidelines/:id/mappings/generate', requireAuth, requireRole('admin'), async (req, res) => {
    const guidelineId = req.params.id
    if (!UUID_RE.test(guidelineId)) return res.status(400).json({ error: 'Invalid guideline id.' })
    if (checking.has(guidelineId)) {
      return res.status(409).json({ error: 'This guideline is already being checked. Wait for it to finish.' })
    }
    checking.add(guidelineId)
    try {
      res.json(await mapping.generateMappingsForGuideline(guidelineId, ask))
    } catch (error) {
      sendError(res, error)
    } finally {
      checking.delete(guidelineId)
    }
  })

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

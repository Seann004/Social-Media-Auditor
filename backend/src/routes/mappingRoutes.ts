import { Router, type Response } from 'express'
import * as db from '../services/dbService.js'
import * as mapping from '../services/mappingService.js'
import * as review from '../services/mappingReview.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { requireProjectAccess } from '../middleware/projectAccess.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ACCEPT_ITEMS = 500
const REVIEW_STATUSES = ['confirmed', 'rejected', 'suggested']
const RELATIONS = ['equivalent', 'partial']
const LEVELS = ['high', 'medium', 'low']
const LIST_STATUSES = ['suggested', 'confirmed', 'rejected']

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Reads the review filters from a query string or a request body. Anything not valid is refused, not ignored. */
function parseFilter(source: Record<string, unknown>): Parsed<review.MappingFilter> {
  const { status, guidelineId, relation, inUse, level } = source
  if (status !== undefined && !LIST_STATUSES.includes(status as string)) return { ok: false, error: 'status must be suggested, confirmed or rejected.' }
  if (relation !== undefined && relation !== '' && !RELATIONS.includes(relation as string)) return { ok: false, error: 'relation must be equivalent or partial.' }
  if (level !== undefined && level !== '' && !LEVELS.includes(level as string)) return { ok: false, error: 'level must be high, medium or low.' }
  if (guidelineId !== undefined && guidelineId !== '' && !(typeof guidelineId === 'string' && UUID_RE.test(guidelineId))) {
    return { ok: false, error: 'guidelineId must be a valid id.' }
  }
  if (inUse !== undefined && inUse !== '' && !['1', 'true', '0', 'false', true, false].includes(inUse as string | boolean)) {
    return { ok: false, error: 'inUse must be true or false.' }
  }
  return {
    ok: true,
    value: {
      ...(status ? { status: status as mapping.MappingStatus } : {}),
      ...(guidelineId ? { guidelineId: guidelineId as string } : {}),
      ...(relation ? { relation: relation as mapping.MappingRelation } : {}),
      ...(level ? { level: level as review.MappingFilter['level'] } : {}),
      ...(inUse === '1' || inUse === 'true' || inUse === true ? { inUse: true } : {}),
    },
  }
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

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
  if (error instanceof review.BulkCountChangedError) {
    return res.status(409).json({ error: error.message, actual: error.actual })
  }
  if (error instanceof review.PartialDecisionError) {
    return res.status(500).json({ error: error.message, updated: error.updated })
  }
  if (error instanceof RangeError) {
    return res.status(400).json({ error: error.message })
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
      const filter = parseFilter({ status: 'suggested', ...req.query, level: undefined })
      if (!filter.ok) return res.status(400).json({ error: filter.error })
      const limit = wholeNumber(req.query.limit, review.DEFAULT_PAGE_SIZE, 1, review.MAX_PAGE_SIZE)
      const offset = wholeNumber(req.query.offset, 0, 0, 1_000_000)
      if (limit === null || offset === null) {
        return res.status(400).json({ error: `limit must be 1 to ${review.MAX_PAGE_SIZE} and offset 0 or more.` })
      }
      res.json(await review.listMappings(filter.value, offset, limit))
    } catch (error) {
      sendError(res, error)
    }
  })

  router.get('/mappings/learning', requireAuth, requireRole('admin'), async (_req, res) => {
    try {
      res.json(await review.getLearning())
    } catch (error) {
      sendError(res, error)
    }
  })

  // Several decisions at once: either a list of ids, or everything a filter matches (with the count the admin saw).
  router.post('/mappings/bulk', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const { status, relation, ids, filter, expectedCount } = req.body ?? {}
      if (!REVIEW_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'status must be confirmed, rejected or suggested.' })
      }
      if (relation !== undefined && !RELATIONS.includes(relation)) {
        return res.status(400).json({ error: 'relation must be equivalent or partial.' })
      }
      if ((ids === undefined) === (filter === undefined)) {
        return res.status(400).json({ error: 'Send either ids or filter, not both and not neither.' })
      }

      if (ids !== undefined) {
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > review.MAX_BULK_PAIRS || !ids.every((i) => typeof i === 'string' && UUID_RE.test(i))) {
          return res.status(400).json({ error: `ids must be a list of 1 to ${review.MAX_BULK_PAIRS} pair ids.` })
        }
        return res.json(await review.reviewMappingsByIds(ids, status, relation, req.user!.userId))
      }

      // Like the list, a bulk filter covers only pairs waiting for review unless it names a status.
      const parsed = parseFilter({ status: 'suggested', ...(typeof filter === 'object' && filter !== null ? filter : {}) })
      if (!parsed.ok) return res.status(400).json({ error: parsed.error })
      if (!Number.isInteger(expectedCount) || expectedCount < 0) {
        return res.status(400).json({ error: 'expectedCount (the number of pairs you saw) is required with a filter.' })
      }
      if (expectedCount > review.MAX_BULK_PAIRS) {
        return res.status(400).json({ error: `At most ${review.MAX_BULK_PAIRS} pairs can be decided at once. Narrow the filter.` })
      }
      res.json(await review.reviewMappingsByFilter(parsed.value, expectedCount, status, relation, req.user!.userId))
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

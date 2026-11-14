import { Router } from 'express'
import { getAiUsage } from '../lib/aiUsage.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

/** Token use per AI feature since the server started, for the admin to work out what testing costs. */
export function createUsageRouter(): Router {
  const router = Router()

  router.get('/admin/ai-usage', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({ since: 'server start', usage: getAiUsage() })
  })

  return router
}

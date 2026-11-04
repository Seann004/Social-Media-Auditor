import { rateLimit } from 'express-rate-limit'
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { API_RATE_WINDOW_MS, MAX_ROUTE_PARAM_LENGTH } from './config.js'
import type { ProjectAccess } from './auditData.js'

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

/** Express 4 does not catch a rejected promise, so every async handler goes through here. */
export function route(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}

const PARAM_PATTERN = /^[A-Za-z0-9-]+$/

/** Every route parameter must be a short id: letters, digits and dashes. Anything else is 400. */
export const validParams: RequestHandler = (req, res, next) => {
  for (const value of Object.values(req.params)) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ROUTE_PARAM_LENGTH || !PARAM_PATTERN.test(value)) {
      res.status(400).json({ error: 'Invalid request' })
      return
    }
  }
  next()
}

/** A limit for each signed-in user. It must come after requireSession. */
export function userLimiter(limit: number): RequestHandler {
  return rateLimit({
    windowMs: API_RATE_WINDOW_MS,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (_req, res) => String((res.locals.session as { userId: string }).userId),
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' })
    },
  })
}

/** True when `access` is exactly one of the allowed values. */
export function isAllowed(access: ProjectAccess | null, allowed: readonly ProjectAccess[]): boolean {
  return allowed.some((a) => a === access)
}

/**
 * Body-parser failures and anything a handler throws. The answer is always plain JSON: no stack, no
 * database message, no key. The cause goes to the log.
 */
export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500
  if (res.headersSent) return
  if (status === 413) {
    res.status(413).json({ error: 'Request too large' })
  } else if (status >= 400 && status < 500) {
    res.status(400).json({ error: 'Invalid request' })
  } else {
    const cause = err instanceof Error ? err.message : typeof err?.message === 'string' ? err.message : 'unknown error'
    console.error(`[evidence] ${req.method} ${req.path} failed:`, cause)
    res.status(500).json({ error: 'Something went wrong' })
  }
}

/** One request at a time per project, inside this process. Returns a release function, or null when held. */
export function createProjectLock(): (projectId: string) => (() => void) | null {
  const held = new Set<string>()
  return (projectId) => {
    if (held.has(projectId)) return null
    held.add(projectId)
    return () => void held.delete(projectId)
  }
}

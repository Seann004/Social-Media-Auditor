import express, { Router, type ErrorRequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { Sessions } from './session.js'

export interface VerifiedUser {
  userId: string
  userName: string
  role: string
}

export type VerifyLogin = (email: string, password: string) => Promise<VerifiedUser | null>

const LOGIN_ATTEMPTS = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000

/** `password` is the SHA-256 hex the browser already computes; it is passed through unchanged. */
const loginSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
})

const rowSchema = z.object({
  userId: z.string().min(1),
  userName: z.string(),
  role: z.string().min(1),
})

interface RpcClient {
  rpc(fn: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * The existing verify_user_login RPC. Null when no row matches; throws when the RPC fails,
 * so an outage is never reported as a wrong password. The client is loaded on first use so
 * that this file imports without any Supabase key set.
 */
export async function verifyLoginWithSupabase(
  email: string,
  password: string,
  client?: RpcClient,
): Promise<VerifiedUser | null> {
  const db = client ?? (await import('../../config/supabase.js')).supabase
  const { data, error } = await db.rpc('verify_user_login', { p_email: email, p_password: password })
  if (error) throw new Error(`verify_user_login failed: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) return null
  const row = rowSchema.safeParse(data[0])
  if (!row.success) throw new Error('verify_user_login returned an unexpected row')
  const { userId, userName, role } = row.data
  return { userId, userName, role }
}

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const MAX_DOMAIN_LENGTH = 64
const MAX_BODY = '4kb'

/** Only a plain domain is safe to log; anything else the user typed is not. */
function emailDomain(email: string): string {
  const domain = email.slice(email.lastIndexOf('@') + 1)
  return email.includes('@') && domain.length <= MAX_DOMAIN_LENGTH && DOMAIN_PATTERN.test(domain)
    ? domain
    : 'unknown'
}

/** Body-parser failures get a plain answer: no stack, no path, nothing from the request. */
const bodyErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500
  if (status === 413) {
    res.status(413).json({ error: 'Request too large' })
  } else if (status >= 400 && status < 500) {
    res.status(400).json({ error: 'Invalid request' })
  } else {
    console.error('Login request failed unexpectedly')
    res.status(500).json({ error: 'Something went wrong' })
  }
}

export function createAuthRouter(deps: { verifyLogin: VerifyLogin; sessions: Sessions | null }): Router {
  const router = Router()
  const limiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    // Only a wrong-credentials 401 counts, so people sharing a network address can all sign in.
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many login attempts. Try again later.' })
    },
  })

  router.post('/auth/login', limiter, express.json({ limit: MAX_BODY }), async (req, res) => {
    const { sessions, verifyLogin } = deps
    if (!sessions) {
      res.status(503).json({ error: 'Sessions are not configured on this server' })
      return
    }
    const body = loginSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: 'Invalid request' })
      return
    }
    const email = body.data.email.toLowerCase()
    let user: VerifiedUser | null
    try {
      user = await verifyLogin(email, body.data.password)
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error'
      console.error(`Login check failed (email domain ${emailDomain(email)}): ${reason}`)
      res.status(503).json({ error: 'Login is temporarily unavailable' })
      return
    }
    if (!user) {
      res.status(401).json({ error: 'Incorrect email or password.' })
      return
    }
    const token = sessions.sign({ userId: user.userId, role: user.role })
    res.json({ token, userId: user.userId, userName: user.userName, role: user.role })
  })

  router.use(bodyErrorHandler)
  return router
}

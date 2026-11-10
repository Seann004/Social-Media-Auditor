import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { SESSION_HOURS } from '../evidence/config.js'

/** The shortest JWT_SECRET the evidence routes trust. A shorter one turns the evidence feature off. */
export const MIN_SECRET_LENGTH = 32
const ALGORITHM = 'HS256'

export interface SessionUser {
  userId: string
  role: string
}

export interface Sessions {
  /** Signs a token in the same shape as the app login (`middleware/auth.ts`). Used by tests. */
  sign(user: SessionUser & { userName?: string }): string
  verify(token: string): SessionUser | null
}

/** The claims of the app login token: `{ userId, userName, role }` plus `iat` and `exp`. */
const claimsSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  exp: z.number(),
})

/**
 * Checks the app login tokens (signed with JWT_SECRET by `middleware/auth.ts`) for the evidence
 * routes. HS256 only. Throws if the secret is too short to be safe.
 */
export function createSessions(secret: string): Sessions {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
  }
  return {
    sign(user) {
      return jwt.sign({ userId: user.userId, userName: user.userName ?? '', role: user.role }, secret, {
        algorithm: ALGORITHM,
        expiresIn: `${SESSION_HOURS}h`,
      })
    },
    verify(token) {
      try {
        const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] })
        const parsed = claimsSchema.safeParse(payload)
        return parsed.success ? { userId: parsed.data.userId, role: parsed.data.role } : null
      } catch {
        return null
      }
    },
  }
}

/**
 * The evidence verifier from JWT_SECRET. Null (feature off) with one `console.error` when the secret
 * is unset or shorter than MIN_SECRET_LENGTH. Never throws, so a bad secret cannot stop the server.
 */
export function sessionsFromEnv(env: Record<string, string | undefined> = process.env): Sessions | null {
  const secret = env.JWT_SECRET
  if (!secret) {
    console.error('[evidence] JWT_SECRET is not set: the evidence routes are disabled.')
    return null
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(
      `[evidence] JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters: the evidence routes are disabled.`,
    )
    return null
  }
  return createSessions(secret)
}

/** Requires `Authorization: Bearer <token>`. Sets `res.locals.session` from the token alone. */
export function requireSession(sessions: Sessions | null): RequestHandler {
  return (req, res, next) => {
    if (!sessions) {
      res.status(503).json({ error: 'Sessions are not configured on this server' })
      return
    }
    const match = /^bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')
    const session = match ? sessions.verify(match[1]) : null
    if (!session) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    res.locals.session = session
    next()
  }
}

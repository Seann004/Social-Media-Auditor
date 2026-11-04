import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { SESSION_HOURS } from '../evidence/config.js'

const MIN_SECRET_LENGTH = 32
const ALGORITHM = 'HS256'

export interface SessionUser {
  userId: string
  role: string
}

export interface Sessions {
  sign(user: SessionUser): string
  verify(token: string): SessionUser | null
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.string().min(1),
  exp: z.number(),
})

/** Signs and checks session tokens. Throws if the secret is too short to be safe. */
export function createSessions(secret: string): Sessions {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
  }
  return {
    sign(user) {
      return jwt.sign({ role: user.role }, secret, {
        algorithm: ALGORITHM,
        subject: user.userId,
        expiresIn: `${SESSION_HOURS}h`,
      })
    },
    verify(token) {
      try {
        const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] })
        const parsed = claimsSchema.safeParse(payload)
        return parsed.success ? { userId: parsed.data.sub, role: parsed.data.role } : null
      } catch {
        return null
      }
    },
  }
}

/** Sessions from SESSION_SECRET. Null (feature off) when unset; throws when set but too short. */
export function sessionsFromEnv(env: Record<string, string | undefined> = process.env): Sessions | null {
  const secret = env.SESSION_SECRET
  if (!secret) {
    console.warn('SESSION_SECRET is not set: session login and the evidence routes are disabled')
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

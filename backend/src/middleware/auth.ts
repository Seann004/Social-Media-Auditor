import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '../types/index.js'

const JWT_SECRET = process.env.JWT_SECRET
const TOKEN_TTL = '12h'

export interface AuthUser {
  userId: string
  userName: string
  role: UserRole
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function signToken(user: AuthUser): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured on the backend server')
  }
  return jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

function verifyFromHeader(req: Request): AuthUser | null {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  if (!JWT_SECRET) return null
  try {
    return jwt.verify(header.slice('Bearer '.length), JWT_SECRET, { algorithms: ['HS256'] }) as AuthUser
  } catch {
    return null
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const user = verifyFromHeader(req)
  if (user) req.user = user
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = verifyFromHeader(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  req.user = user
  next()
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' })
    }
    next()
  }
}

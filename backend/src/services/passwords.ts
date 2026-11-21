// Password storage (NFR-05). The browser sends SHA-256(password), so the plain password never
// travels; the server then stores a salted, slow bcrypt hash of that value, so a leaked table
// cannot be replayed at the login endpoint or reversed with a precomputed table.
import bcrypt from 'bcryptjs'

const DEFAULT_COST = 12
const MIN_COST = 10
const MAX_COST = 15

function cost(): number {
  const parsed = Number.parseInt(process.env.BCRYPT_COST ?? '', 10)
  if (!Number.isFinite(parsed)) return DEFAULT_COST
  return Math.min(MAX_COST, Math.max(MIN_COST, parsed))
}

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

/** True when `stored` is a bcrypt hash; false for a legacy unsalted value or nothing. */
export function isPasswordHash(stored: string | null | undefined): stored is string {
  return typeof stored === 'string' && BCRYPT_PATTERN.test(stored)
}

/** Salted bcrypt hash of the password value the client sent. */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('A password is required.')
  return bcrypt.hash(password, cost())
}

/** Compares a password with a stored bcrypt hash. A legacy or missing value never matches here. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!password || !isPasswordHash(stored)) return false
  return bcrypt.compare(password, stored)
}

// A fixed hash to compare against when the email has no account, so a wrong email
// takes about as long as a wrong password and does not reveal which emails exist.
let dummyHash: Promise<string> | null = null
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash('no-account-placeholder', cost())
  await bcrypt.compare(password || 'x', await dummyHash)
}

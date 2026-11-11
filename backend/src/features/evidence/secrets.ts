import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { SECRET_KEY_BYTES } from './config.js'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_ERROR = 'EVIDENCE_SECRET_KEY must be 32 random bytes, base64 encoded'
const SECRET_PARAM = /pass|pwd|secret|token|otp|code|auth/i
const SECRET_PARAM_EXACT = /^(api_?key|key|sid|session|jwt|signature|pw)$/i

function isSecretParam(name: string): boolean {
  return SECRET_PARAM.test(name) || SECRET_PARAM_EXACT.test(name)
}
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export class SecretUnreadableError extends Error {
  constructor() {
    super('The saved password cannot be read with the current key.')
    this.name = 'SecretUnreadableError'
  }
}

export function parseSecretKey(value: string | undefined): Buffer | null {
  if (value === undefined || value.trim() === '') return null
  const trimmed = value.trim()
  if (!BASE64.test(trimmed)) throw new Error(KEY_ERROR)
  const key = Buffer.from(trimmed, 'base64')
  if (key.length !== SECRET_KEY_BYTES) throw new Error(KEY_ERROR)
  return key
}

export function secretAad(projectId: string, accountId: string): string {
  return `${projectId}/${accountId}`
}

export function encryptSecret(plain: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decryptSecret(blob: string, key: Buffer, aad: string): string {
  try {
    const parts = blob.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('bad blob')
    const iv = Buffer.from(parts[1], 'base64url')
    const tag = Buffer.from(parts[2], 'base64url')
    const ciphertext = Buffer.from(parts[3], 'base64url')
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('bad blob')
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretUnreadableError()
  }
}

/** For recorded, logged or AI-visible URLs only, never for navigation. */
export function redactUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '[unreadable address]'
  }
  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''
  if ([...parsed.searchParams.keys()].some(isSecretParam)) {
    const next = new URLSearchParams()
    for (const [k, v] of parsed.searchParams) next.append(k, isSecretParam(k) ? 'redacted' : v)
    parsed.search = next.toString()
  }
  return parsed.toString()
}

import { vi } from 'vitest'
import type { Express } from 'express'

// Loads src/server.ts for HTTP tests with an environment that cannot reach anything outside the machine.
// Each test file still mocks dotenv and src/config/supabase.js itself (vi.mock only hoists in the test file):
//
//   vi.mock('dotenv/config', () => ({}))
//   vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }))
//   vi.mock('../../../src/config/supabase.js', async () => ({ supabase: (await import('../../helpers/fakeSupabase.js')).supabase }))

export const TEST_SECRET = 'a-test-secret-that-is-at-least-32-chars-long'

type Role = 'admin' | 'head_auditor' | 'auditor'

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: TEST_SECRET,
  SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_ANON_KEY: 'test-anon-key',
  GROQ_API_KEY: 'test-groq-key',
  GROQ_MODEL: 'test-model',
  ALLOWED_ORIGINS: 'http://localhost:5173',
}

/** Unset: the evidence feature stays off (no service-role client) and no assignment email is sent. */
const UNSET_ENV = ['SUPABASE_SERVICE_ROLE_KEY', 'EVIDENCE_SECRET_KEY', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'EVIDENCE_ALLOWED_PRIVATE_HOSTS']

export function setTestEnv(): void {
  for (const key of UNSET_ENV) delete process.env[key]
  Object.assign(process.env, TEST_ENV)
}

/** Every outside call goes through this. By default it refuses, so a test that forgets to stub a reply fails loudly. */
export const fetchMock = vi.fn(async (url: unknown): Promise<Response> => {
  throw new Error(`network is disabled in tests (fetch ${String(url)})`)
})

export interface CoreServer {
  app: Express
  bearer: (userId: string, role: Role, userName?: string) => string
}

export async function loadCoreServer(): Promise<CoreServer> {
  setTestEnv()
  vi.stubGlobal('fetch', fetchMock)
  const { app } = await import('../../src/server.js')
  const { signToken } = await import('../../src/middleware/auth.js')
  return {
    app,
    bearer: (userId, role, userName = role) => `Bearer ${signToken({ userId, userName, role })}`,
  }
}

/** A Groq chat completion reply whose message content is `content` as JSON. */
export function groqReply(content: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = status === 200
    ? JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
    : String(content)
  return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Silences the console for a test that drives error paths on purpose, and returns the spies. */
export function quietConsole() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  }
}

import express, { type Express } from 'express'
import { createSessions, type Sessions } from '../auth/session.js'
import type { AppliedAnswer, AuditData, ProjectAccess } from './auditData.js'
import { createMemoryRepository } from './memoryRepository.js'
import type { RunQueue } from './queue.js'
import type { EvidenceRepository, ScreenshotStore } from './repository.js'
import { createEvidenceRouter, type EvidenceRouterDeps } from './routes.js'
import { createUrlGuard } from './urlGuard.js'
import type { EvidenceRun, Suggestion } from './types.js'
import type { SubmissionStatus } from '../../types/index.js'

export const SECRET = 'a-test-secret-that-is-at-least-32-chars-long'
export const P1 = 'p-1'
export const P2 = 'p-2'

export interface TestUser {
  userId: string
  role: string
}

export const USERS = {
  head: { userId: 'u-head', role: 'head_auditor' },
  auditor: { userId: 'u-aud', role: 'auditor' },
  auditorP2: { userId: 'u-aud2', role: 'auditor' },
  headP2: { userId: 'u-head2', role: 'head_auditor' },
  admin: { userId: 'u-admin', role: 'admin' },
  stranger: { userId: 'u-stranger', role: 'auditor' },
} as const satisfies Record<string, TestUser>

const ACCESS = new Map<string, ProjectAccess>([
  [`u-head|${P1}`, 'head_auditor'],
  [`u-aud|${P1}`, 'auditor'],
  [`u-aud2|${P2}`, 'auditor'],
  [`u-head2|${P2}`, 'head_auditor'],
])

export interface FakeAudit extends AuditData {
  submission: Map<string, SubmissionStatus | null>
  applied: unknown[]
}

export function makeAudit(): FakeAudit {
  const submission = new Map<string, SubmissionStatus | null>([
    [P1, 'not_submitted'],
    [P2, 'not_submitted'],
  ])
  const applied: unknown[] = []
  return {
    submission,
    applied,
    async listChecklistItems() {
      return [
        { id: 'item-1', guidelineId: 'g-1', category: 'Privacy', name: 'Item 1', text: 'Is it private?', helpText: '' },
        { id: 'item-2', guidelineId: 'g-1', category: 'Privacy', name: 'Item 2', text: 'Is it safe?', helpText: '' },
      ]
    },
    async listAnswers() {
      return []
    },
    async getPlatform() {
      return 'Example'
    },
    async getProjectAccess(projectId, userId, role) {
      // As in production: the role decides which table is asked, so a wrong role finds nothing.
      const access = ACCESS.get(`${userId}|${projectId}`)
      return access !== undefined && access === role ? access : null
    },
    async getSubmissionStatus(projectId) {
      return submission.has(projectId) ? (submission.get(projectId) ?? null) : null
    },
    async applyAnswer(input): Promise<AppliedAnswer> {
      applied.push(input)
      return { itemId: input.itemId, status: input.result, findings: input.findingsIfEmpty ?? null, evidenceImages: input.addImages ?? [] }
    },
  }
}

export interface World {
  app: Express
  repo: EvidenceRepository & ScreenshotStore
  audit: FakeAudit
  enqueued: string[]
  queue: RunQueue
  sessions: Sessions
  guardsMade: { count: number }
  token(user: TestUser): string
  auth(user: TestUser): { Authorization: string }
}

export interface WorldOptions {
  aiConfigured?: boolean
  requestsPerMinute?: number
  repo?: EvidenceRepository & ScreenshotStore
  deps?: Partial<EvidenceRouterDeps>
}

export function makeWorld(opts: WorldOptions = {}): World {
  const repo = opts.repo ?? createMemoryRepository()
  const audit = makeAudit()
  const sessions = createSessions(SECRET)
  const enqueued: string[] = []
  const queue: RunQueue = { enqueue: (id) => void enqueued.push(id), idle: async () => undefined }
  const guardsMade = { count: 0 }
  const lookup = async (host: string) => [{ address: host === 'example.com' || host === 'www.example.com' ? '93.184.216.34' : '10.0.0.1' }]
  const guard = () => {
    guardsMade.count += 1
    return createUrlGuard({ lookup })
  }
  const app = express()
  app.use(
    '/api',
    createEvidenceRouter({
      repo,
      screenshots: repo,
      audit,
      queue,
      guard,
      sessions,
      aiConfigured: opts.aiConfigured ?? true,
      requestsPerMinute: opts.requestsPerMinute,
      ...opts.deps,
    }),
  )
  const token = (user: TestUser) => sessions.sign(user)
  return { app, repo, audit, enqueued, queue, sessions, guardsMade, token, auth: (u) => ({ Authorization: `Bearer ${token(u)}` }) }
}

/** A finished run with one page and one suggestion carrying one quote. */
export async function seedResult(
  repo: EvidenceRepository,
  projectId: string,
  status: 'completed' | 'partial' = 'completed',
  finalUrl: string | null = null,
): Promise<{ run: EvidenceRun; suggestion: Suggestion; pageId: string; quoteId: string }> {
  const run = await repo.createRun({ projectId, startedBy: 'u-aud', scope: 'all' })
  const page = await repo.addPage(run.id, {
    url: 'https://example.com/privacy',
    finalUrl,
    httpStatus: 200,
    accessStatus: 'ok',
    accessDetail: null,
    title: 'Privacy',
    text: 'We keep data private.',
    accessibilitySnapshot: null,
    screenshotPath: `${projectId}/${run.id}/page.jpg`,
    contentHash: 'h',
  })
  const [passage] = await repo.addPassages(page.id, [{ position: 0, kind: 'text', text: 'We keep data private.' }])
  const suggestion = await repo.addSuggestion({
    runId: run.id,
    projectId,
    itemId: 'item-1',
    suggestedResult: 'yes',
    reason: 'The page says data is private.',
    confidence: 'high',
    flags: [],
    passageIdsSent: [passage.id],
    quotes: [
      {
        passageId: passage.id,
        pageId: page.id,
        quoteText: 'We keep data private.',
        verified: true,
        highlightScreenshotPath: `${projectId}/${run.id}/quote.jpg`,
      },
    ],
  })
  const done = await repo.updateRun(run.id, { status, unassessedCategories: status === 'partial' ? ['g-1__Privacy'] : [] })
  return { run: done, suggestion, pageId: page.id, quoteId: suggestion.quotes[0].id }
}

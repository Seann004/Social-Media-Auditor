import { vi } from 'vitest'
import type { AssessedItem, AssessInput, AssessItem, AssessOutput } from '../assess.js'
import type { AnswerRow, AuditData } from '../auditData.js'
import type { CaptureOptions, CapturedPageData } from '../capture.js'
import type { HighlightOptions } from '../highlight.js'
import { createMemoryRepository } from '../memoryRepository.js'
import type { EvidenceRepository, ScreenshotStore } from '../repository.js'
import { runEvidenceJob } from '../runner.js'
import type { RunnerDeps } from '../runnerShared.js'
import type { EvidenceRun, RunScope, Suggestion } from '../types.js'

export const PROJECT = 'proj-1'
export const SENTENCE = 'Teen accounts are private by default.'
export const OK_TEXT = `${SENTENCE} Reporting tools let users report abuse quickly.\n\nUsers can report abuse with one tap from every post.`

export const item = (id: string, category: string, text: string, guidelineId = 'g1'): AssessItem => ({
  id,
  guidelineId,
  category,
  name: null,
  text,
  helpText: null,
})

export const DEFAULT_ITEMS: AssessItem[] = [
  item('i1', 'Privacy', 'Are teen accounts private by default?'),
  item('i2', 'Privacy', 'Is the default for teen accounts private?'),
  item('i3', 'Reporting', 'Can users report abuse from posts?'),
]

export const THREE_CATEGORIES: AssessItem[] = [
  ...DEFAULT_ITEMS,
  item('i4', 'Safety', 'Are teen accounts private by default for safety?'),
]

export const categoryKey = (i: AssessItem): string => `${i.guidelineId}__${i.category}`

export function page(url: string, text: string, extra: Partial<CapturedPageData> = {}): CapturedPageData {
  return {
    url,
    finalUrl: url,
    httpStatus: 200,
    accessStatus: 'ok',
    accessDetail: null,
    title: 'Page',
    text,
    accessibilitySnapshot: null,
    screenshot: Buffer.from('page-jpeg'),
    contentHash: 'h',
    capturedAt: new Date().toISOString(),
    ...extra,
  }
}

export const okPage = (extra: Partial<CapturedPageData> = {}) => page('https://p.test/privacy', OK_TEXT, extra)
export const loginPage = () =>
  page('https://p.test/account', 'Log in to see teen accounts private default settings and report abuse tools.', {
    accessStatus: 'login_required',
    accessDetail: 'The page is a login form.',
  })

export interface FakeAudit extends AuditData {
  items: AssessItem[]
  answers: AnswerRow[]
  applyAnswer: ReturnType<typeof vi.fn> & AuditData['applyAnswer']
}

export function fakeAudit(items: AssessItem[] = DEFAULT_ITEMS, answers: AnswerRow[] = []): FakeAudit {
  const audit = {
    items,
    answers,
    listChecklistItems: async () => [...audit.items],
    listAnswers: async () => [...audit.answers],
    getPlatform: async () => 'TikTok',
    getProjectAccess: async () => null,
    getSubmissionStatus: async () => 'not_submitted' as const,
    applyAnswer: vi.fn(async () => {
      throw new Error('a run must never apply an answer')
    }),
  }
  return audit as unknown as FakeAudit
}

export const answer = (itemId: string, result: AnswerRow['result'], userId = 'u1'): AnswerRow => ({
  itemId,
  userId,
  guidelineId: 'g1',
  result,
  notes: null,
  findings: null,
  evidenceImages: [],
})

/** Quotes the first sentence of the first passage sent, which is verbatim, so it verifies. */
export function quoteFirstPassage(input: AssessInput, tokensUsed = 100): AssessOutput {
  const first = input.passages[0]
  const quote = first.text.split(/(?<=\.)\s/)[0]
  const results: AssessedItem[] = input.items.map((it) => ({
    itemId: it.id,
    suggestedResult: 'yes',
    reason: `Reason for ${it.id}`,
    quotes: [{ passageId: first.id, text: quote }],
    evidenceSufficient: true,
    conflicting: false,
    webAssessable: true,
    confidence: 'high',
  }))
  return { results, missingItemIds: [], tokensUsed }
}

export interface World {
  repo: EvidenceRepository & ScreenshotStore
  audit: FakeAudit
  deps: RunnerDeps
  calls: { assess: AssessInput[]; capture: CaptureOptions[]; highlights: HighlightOptions[]; browsers: number }
  /** Creates a run, and runs it. */
  run(opts?: { scope?: RunScope; capturedInRunId?: string }): Promise<EvidenceRun>
  suggestions(runId: string): Promise<Suggestion[]>
}

export interface WorldOptions {
  items?: AssessItem[]
  answers?: AnswerRow[]
  pages?: CapturedPageData[]
  startUrls?: string[] | null
  assess?: (input: AssessInput, call: number) => Promise<AssessOutput> | AssessOutput
  highlights?: (opts: HighlightOptions) => Promise<Map<string, Buffer>>
  capture?: (opts: CaptureOptions) => Promise<void>
  repo?: EvidenceRepository & ScreenshotStore
  audit?: FakeAudit
  runTimeoutMs?: number
  retryDelaysMs?: number[]
  browserProvider?: RunnerDeps['browserProvider']
}

export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const repo = options.repo ?? createMemoryRepository()
  const audit = options.audit ?? fakeAudit(options.items, options.answers)
  const pages = options.pages ?? [okPage()]
  const calls: World['calls'] = { assess: [], capture: [], highlights: [], browsers: 0 }

  if (options.startUrls !== null) await repo.saveSource(PROJECT, options.startUrls ?? ['https://p.test/privacy'], 'u1')

  const deps: RunnerDeps = {
    repo,
    screenshots: repo,
    audit,
    guard: { check: async () => ({ allowed: true }) },
    apiKey: 'gsk_test_secret_key',
    model: 'test-model',
    runTimeoutMs: options.runTimeoutMs,
    // No waiting between retries in a test.
    retryDelaysMs: options.retryDelaysMs ?? [0, 0, 0],
    browserProvider:
      options.browserProvider ??
      (async () => {
        calls.browsers += 1
        return {} as never
      }),
    capture: async (opts) => {
      calls.capture.push(opts)
      if (options.capture) return options.capture(opts)
      for (const p of pages) {
        if (opts.signal.aborted) return
        await opts.onPage(p)
      }
    },
    assessBatch: async (input) => {
      calls.assess.push(input)
      return options.assess ? options.assess(input, calls.assess.length) : quoteFirstPassage(input)
    },
    highlights: async (opts) => {
      calls.highlights.push(opts)
      return options.highlights ? options.highlights(opts) : new Map()
    },
  }

  return {
    repo,
    audit,
    deps,
    calls,
    async run(opts = {}) {
      const created = await repo.createRun({
        projectId: PROJECT,
        startedBy: 'u1',
        scope: opts.scope ?? 'all',
        capturedInRunId: opts.capturedInRunId,
      })
      await runEvidenceJob(created.id, deps)
      const done = await repo.getRun(created.id)
      if (!done) throw new Error('the run disappeared')
      return done
    },
    suggestions: (runId) => repo.listSuggestions(runId),
  }
}

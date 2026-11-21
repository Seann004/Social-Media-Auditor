import { vi } from 'vitest'
import type { DecideStep, StepPrompt } from '../../src/features/evidence/appAgent.js'
import type { AppAction } from '../../src/features/evidence/appTypes.js'
import type { AssessedItem, AssessInput, AssessItem, AssessOutput } from '../../src/features/evidence/assess.js'
import { createMemoryAppRepository } from '../../src/features/evidence/memoryAppRepository.js'
import { createMemoryRepository } from '../../src/features/evidence/memoryRepository.js'
import { runEvidenceJob } from '../../src/features/evidence/runner.js'
import type { RunnerDeps } from '../../src/features/evidence/runnerShared.js'
import type { EvidenceRun, RunScope, Suggestion } from '../../src/features/evidence/types.js'
import { PROJECT_ID, type AppWorld } from './appWorld.js'
import type { ScriptEntry } from './fakeAgent.js'
import { fakeAudit, item, type FakeAudit } from './runnerWorld.js'

/** Shared setup for the app-run tests: the social app, memory repositories, a per-item scripted agent and a fake judge. */
export const APP_ITEMS: AssessItem[] = [
  item('i1', 'Privacy', 'Are teen accounts private by default?'),
  item('i2', 'Privacy', 'Can teens hide their activity status?'),
  item('i3', 'Messaging', 'Can an adult stranger message a teen account?'),
]

const FINISH: AppAction = { type: 'finish', observations: '', evidenceSteps: [] }

export interface AiCall {
  kind: 'step' | 'judge'
  itemId: string
  tokens: number
}

export interface AppRunKit {
  world: AppWorld
  repo: ReturnType<typeof createMemoryRepository>
  appRepo: ReturnType<typeof createMemoryAppRepository>
  audit: FakeAudit
  deps: RunnerDeps
  /** The script of each item's check, by item id; an item with none finishes at once. */
  scripts: Record<string, ScriptEntry[]>
  /** Tokens each step call reports. */
  stepTokens: { current: number }
  /** Tokens each judge call reports. */
  judgeTokens: { current: number }
  /** The judge's answer for one item; may throw, as a failing AI would. */
  judge: { current: (input: AssessInput) => AssessOutput }
  prompts: StepPrompt[]
  judged: AssessInput[]
  aiCalls: AiCall[]
  browserProvider: ReturnType<typeof vi.fn>
  /** Creates an app run and runs it. */
  run(opts?: { checkedItemIds?: string[]; capturedInRunId?: string; scope?: RunScope }): Promise<EvidenceRun>
  suggestions(runId: string): Promise<Suggestion[]>
  /** A finished pages run with one suggestion per item, as an earlier result. */
  seedPagesResult(itemIds: string[]): Promise<EvidenceRun>
}

export function judged(itemId: string, over: Partial<AssessedItem> = {}): AssessedItem {
  return {
    itemId,
    suggestedResult: 'yes',
    reason: `Judged ${itemId} from the steps.`,
    quotes: [],
    evidenceSufficient: true,
    conflicting: false,
    webAssessable: true,
    confidence: 'high',
    ...over,
  }
}

export async function createAppRunKit(world: AppWorld, items: AssessItem[] = APP_ITEMS): Promise<AppRunKit> {
  const repo = createMemoryRepository()
  const appRepo = createMemoryAppRepository()
  const audit = fakeAudit(items)
  await appRepo.saveAppSource(PROJECT_ID, { appUrl: world.app.appUrl, loginDomains: world.app.loginDomains }, null)
  await appRepo.addTestAccount(world.teen)
  await appRepo.addTestAccount(world.adult)

  const prompts: StepPrompt[] = []
  const judgedCalls: AssessInput[] = []
  const aiCalls: AiCall[] = []
  const scripts: Record<string, ScriptEntry[]> = {}
  const stepTokens = { current: 100 }
  const judgeTokens = { current: 100 }
  const judge: AppRunKit['judge'] = { current: (input) => ({ results: input.items.map((i) => judged(i.id)), missingItemIds: [], tokensUsed: judgeTokens.current }) }
  let nextOf = new Map<string, number>()

  const decideStep: DecideStep = async ({ prompt }) => {
    prompts.push(structuredClone(prompt))
    const id = prompt.item.id
    const n = nextOf.get(id) ?? 0
    nextOf = new Map(nextOf).set(id, n + 1)
    aiCalls.push({ kind: 'step', itemId: id, tokens: stepTokens.current })
    const script = scripts[id] ?? []
    const entry = n < script.length ? script[n] : FINISH
    const action = typeof entry === 'function' ? entry(prompt) : entry
    return { action, note: '', tokensUsed: stepTokens.current }
  }

  const browserProvider = vi.fn(async () => world.browser)
  const deps: RunnerDeps = {
    repo,
    screenshots: repo,
    audit,
    guard: world.baseGuard,
    apiKey: 'gsk_test_secret_key',
    model: 'test-model',
    retryDelaysMs: [0, 0, 0],
    browserProvider,
    capture: async () => {
      throw new Error('an app run must never capture pages')
    },
    highlights: async () => new Map(),
    assessBatch: async (input) => {
      judgedCalls.push(input)
      aiCalls.push({ kind: 'judge', itemId: input.items[0]?.id ?? '', tokens: judgeTokens.current })
      return judge.current(input)
    },
    app: { appRepo, secretKey: world.secretKey, decideStep },
  }

  return {
    world,
    repo,
    appRepo,
    audit,
    deps,
    scripts,
    stepTokens,
    judgeTokens,
    judge,
    prompts,
    judged: judgedCalls,
    aiCalls,
    browserProvider,
    async run(opts = {}) {
      nextOf = new Map()
      const created = await repo.createRun({
        projectId: PROJECT_ID,
        startedBy: 'u1',
        scope: opts.scope ?? 'all',
        capturedInRunId: opts.capturedInRunId,
        source: 'app',
        checkedItemIds: opts.checkedItemIds ?? items.map((i) => i.id),
      })
      await runEvidenceJob(created.id, deps)
      const done = await repo.getRun(created.id)
      if (!done) throw new Error('the run disappeared')
      return done
    },
    suggestions: (runId) => repo.listSuggestions(runId),
    async seedPagesResult(itemIds) {
      const run = await repo.createRun({ projectId: PROJECT_ID, startedBy: 'u1', scope: 'all' })
      for (const itemId of itemIds) {
        await repo.addSuggestion({
          runId: run.id,
          projectId: PROJECT_ID,
          itemId,
          suggestedResult: 'no',
          reason: `From the pages: ${itemId}`,
          confidence: 'medium',
          flags: [],
          passageIdsSent: [],
          source: 'pages',
          quotes: [],
        })
      }
      return repo.updateRun(run.id, { status: 'completed', finishedAt: new Date().toISOString() })
    },
  }
}

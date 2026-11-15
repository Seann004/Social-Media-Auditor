/**
 * One repeat of an app case: a fresh practice app in the case's state on a free local port, the two
 * test accounts, in-memory repositories and the real run pipeline (runEvidenceJob), with the given
 * AI metered by the budget and the real shared browser.
 */
import { randomBytes } from 'node:crypto'
import type { NewTestAccount } from '../src/features/evidence/appTypes.js'
import { APP_PROMPT_VERSION } from '../src/features/evidence/config.js'
import { createMemoryAppRepository } from '../src/features/evidence/memoryAppRepository.js'
import { createMemoryRepository } from '../src/features/evidence/memoryRepository.js'
import { runEvidenceJob } from '../src/features/evidence/runner.js'
import type { RunnerDeps } from '../src/features/evidence/runnerShared.js'
import { encryptSecret, secretAad } from '../src/features/evidence/secrets.js'
import { createUrlGuard } from '../src/features/evidence/urlGuard.js'
import { LOGIN_NAMES, PASSWORDS, startSocialApp } from '../src/features/evidence/__fixtures__/socialApp.js'
import { BASE_APP_MODE } from './cases.js'
import type { BenchmarkCase, RepeatRecord } from './types.js'
import {
  benchmarkAudit,
  createRun,
  finishedRun,
  itemOf,
  meteredAssess,
  meteredDecideStep,
  PROJECT_ID,
  recordOf,
  type RepeatContext,
} from './world.js'

/** The practice app's test accounts, as an auditor would set them up. Their passwords are the app's fake ones. */
const ACCOUNTS = [
  { id: 'acc-teen', label: 'Teen 15', ageGroup: 'under_18', age: 15, handle: 'teen15' },
  { id: 'acc-adult', label: 'Adult 30', ageGroup: 'adult', age: 30, handle: 'adult30' },
] as const

const loginOf = (handle: string): string => {
  const login = Object.keys(LOGIN_NAMES).find((name) => LOGIN_NAMES[name] === handle)
  if (login === undefined) throw new Error(`The practice app has no login for ${handle}`)
  return login
}

function testAccount(a: (typeof ACCOUNTS)[number], key: Buffer): NewTestAccount {
  return {
    id: a.id,
    projectId: PROJECT_ID,
    label: a.label,
    ageGroup: a.ageGroup,
    age: a.age,
    loginName: loginOf(a.handle),
    handles: [a.handle],
    passwordCiphertext: encryptSecret(PASSWORDS[a.handle], key, secretAad(PROJECT_ID, a.id)),
    createdBy: null,
  }
}

export async function runAppRepeat(c: BenchmarkCase, repeat: number, ctx: RepeatContext): Promise<RepeatRecord> {
  const social = await startSocialApp({ state: c.app?.state, mode: { ...BASE_APP_MODE, ...c.app?.mode } })
  try {
    const secretKey = randomBytes(32)
    const repo = createMemoryRepository()
    const appRepo = createMemoryAppRepository()
    const item = itemOf(c)
    await appRepo.saveAppSource(PROJECT_ID, { appUrl: `${social.url}/login`, loginDomains: [] }, null)
    for (const account of ACCOUNTS) await appRepo.addTestAccount(testAccount(account, secretKey))

    const deps: RunnerDeps = {
      repo,
      screenshots: repo,
      audit: benchmarkAudit(item),
      // Only the practice app on its own port is let through as a private address, as the integration tests do.
      guard: createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${social.port}`] }),
      apiKey: ctx.apiKey,
      model: ctx.model,
      capture: async () => {
        throw new Error('an app run never captures pages')
      },
      assessBatch: meteredAssess(ctx.ai.assessBatch, ctx.budget),
      app: { appRepo, secretKey, decideStep: meteredDecideStep(ctx.ai.decideStep, ctx.budget) },
    }
    const created = await createRun(repo, c, APP_PROMPT_VERSION)
    const started = Date.now()
    await runEvidenceJob(created.id, deps)
    const seconds = (Date.now() - started) / 1000
    const { run, suggestion } = await finishedRun(repo, created.id, item.id)
    const steps = await appRepo.listSteps(created.id, item.id)
    return recordOf(c, repeat, { run, suggestion, steps: steps.length, lines: steps.map((s) => s.line), seconds })
  } finally {
    await social.close()
  }
}

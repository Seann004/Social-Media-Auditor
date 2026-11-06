import type { Browser } from 'playwright'
import type { StepPrompt } from '../appAgent.js'
import { runCheck, type CheckDeps, type CheckInput, type CheckOutcome } from '../appCheck.js'
import type { SafetyContext } from '../appSafety.js'
import { createSessionPool, type AppSessionPool } from '../appSession.js'
import type { AgentAccount, AppAction, TestAccount } from '../appTypes.js'
import type { AssessItem } from '../assess.js'
import { createMemoryAppRepository } from '../memoryAppRepository.js'
import { createMemoryRepository } from '../memoryRepository.js'
import type { ScreenshotStore } from '../repository.js'
import type { TokenMeter } from '../runnerAssess.js'
import type { AppWorld } from './appWorld.js'
import { refOf, scriptedAgent, type ScriptEntry, type ScriptedAgentOptions } from './fakeAgent.js'

/** Shared setup for the check-loop and restore tests: memory repositories, a pool and a scripted agent. */
export const RUN = { id: 'run-1', projectId: 'project-1' }
export const ITEM: AssessItem = {
  id: 'item-1',
  guidelineId: 'g1',
  category: 'Privacy',
  name: 'Private by default',
  text: 'Are teen accounts private by default?',
  helpText: null,
}

export function agentOf(account: TestAccount): AgentAccount {
  return { id: account.id, label: account.label, ageGroup: account.ageGroup, age: account.age, handles: [...account.handles] }
}

export function createMeter(start = 0): TokenMeter {
  let used = start
  return {
    used: () => used,
    add(tokens) {
      used += tokens
    },
  }
}

export interface Upload {
  path: string
  jpeg: Buffer
}

export interface CheckKit {
  repo: ReturnType<typeof createMemoryRepository>
  appRepo: ReturnType<typeof createMemoryAppRepository>
  screenshots: ScreenshotStore
  uploads: Upload[]
  pool: AppSessionPool
  accounts: TestAccount[]
  safety: SafetyContext
  check(script: ScriptEntry[], over?: Partial<CheckInput>, deps?: Partial<CheckDeps>, opts?: ScriptedAgentOptions): Promise<CheckRun>
}

export interface CheckRun {
  agent: ReturnType<typeof scriptedAgent>
  outcome: CheckOutcome
}

export function createCheckKit(world: AppWorld, accounts: TestAccount[] = [world.teen, world.adult]): CheckKit {
  const repo = createMemoryRepository()
  const appRepo = createMemoryAppRepository()
  const uploads: Upload[] = []
  const screenshots: ScreenshotStore = {
    upload: async (path, jpeg) => {
      uploads.push({ path, jpeg: Buffer.from(jpeg) })
      await repo.upload(path, jpeg)
    },
    signedUrl: (path, seconds) => repo.signedUrl(path, seconds),
    removeProject: (projectId) => repo.removeProject(projectId),
  }
  const pool = createSessionPool({
    browser: world.browser,
    baseGuard: world.baseGuard,
    app: world.app,
    accounts,
    secretKey: world.secretKey,
    signal: world.abort.signal,
    aborted: world.aborted,
  })
  const agents = accounts.map(agentOf)
  const safety: SafetyContext = { accounts: agents, currentAccount: null, appUrl: world.app.appUrl, loginDomains: world.app.loginDomains }
  return {
    repo,
    appRepo,
    screenshots,
    uploads,
    pool,
    accounts,
    safety,
    async check(script, over = {}, deps = {}, opts = {}) {
      const agent = scriptedAgent(script, opts)
      const outcome = await runCheck(
        {
          run: RUN,
          item: ITEM,
          platform: 'FixtureSocial',
          accounts: agents,
          app: world.app,
          pool,
          leftChanged: [],
          meter: createMeter(),
          signal: world.abort.signal,
          ...over,
        },
        { repo, screenshots, appRepo, decideStep: agent, apiKey: 'KEY', model: 'test-model', ...deps },
      )
      return { agent, outcome }
    },
  }
}

/** Switch to the account and sign in with fill_credential and a click on Sign in: four steps. */
export function signIn(label: string): ScriptEntry[] {
  return [
    { type: 'switch_account', account: label },
    (p) => ({ type: 'fill_credential', ref: refOf(p, 'textbox', 'Username'), account: label, field: 'login' }),
    (p) => ({ type: 'fill_credential', ref: refOf(p, 'textbox', 'Password'), account: label, field: 'password' }),
    (p) => ({ type: 'click', ref: refOf(p, 'button', 'Sign in') }),
  ]
}

export const openPath = (path: string): AppAction => ({ type: 'open_link', url: path })
export const on = (role: string, name: string, type: 'click' | 'toggle' = 'click'): ScriptEntry => (p: StepPrompt) => ({
  type,
  ref: refOf(p, role, name),
})

/** The colour of the picture at each point, decoded on a blank page. */
export async function pixelsAt(browser: Browser, jpeg: Buffer, points: { x: number; y: number }[]): Promise<number[][]> {
  const blank = await browser.newPage()
  try {
    return await blank.evaluate(
      async ({ base64, points }) => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return points.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)))
      },
      { base64: jpeg.toString('base64'), points },
    )
  } finally {
    await blank.close()
  }
}

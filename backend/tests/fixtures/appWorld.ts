import { randomBytes } from 'node:crypto'
import type { Browser } from 'playwright'
import { createAppGuard } from '../../src/features/evidence/appGuard.js'
import type { AppSource, TestAccount } from '../../src/features/evidence/appTypes.js'
import { getBrowser } from '../../src/features/evidence/browser.js'
import { encryptSecret, secretAad } from '../../src/features/evidence/secrets.js'
import { createUrlGuard, type UrlGuard } from '../../src/features/evidence/urlGuard.js'
import { quietLogUnlessTestFails } from './pages.js'
import { startSocialApp, type SocialApp } from './socialApp.js'

export const PROJECT_ID = 'project-1'
export const TEEN_PASSWORD = 'Teen-Pass-111'
export const ADULT_PASSWORD = 'Adult-Pass-222'

/** Shared setup for tests that use the social app with test accounts: browser, app, guard and accounts encrypted with a test key. */
export interface AppWorld {
  browser: Browser
  social: SocialApp
  /** What the sessions are given as their base guard: the social app, and any extra host, may be reached. */
  baseGuard: UrlGuard
  /** The app's guard as the sessions build it. */
  appGuard: UrlGuard
  app: AppSource
  teen: TestAccount
  adult: TestAccount
  secretKey: Buffer
  abort: AbortController
  aborted: Promise<null>
  close(): Promise<void>
}

export interface AppWorldOptions {
  /** Hosts other than the social app that the base guard lets through, such as a server that must stay unreached. */
  extraPrivateHosts?: string[]
}

export function makeAccount(
  fields: Pick<TestAccount, 'id' | 'label' | 'ageGroup' | 'age' | 'loginName' | 'handles'>,
  password: string,
  key: Buffer,
): TestAccount {
  return {
    ...fields,
    projectId: PROJECT_ID,
    passwordCiphertext: encryptSecret(password, key, secretAad(PROJECT_ID, fields.id)),
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Call from a beforeEach and close from an afterEach. The shared browser stays open: the test file closes it with closeBrowser. */
export async function startAppWorld(opts: AppWorldOptions = {}): Promise<AppWorld> {
  quietLogUnlessTestFails()
  const browser = await getBrowser()
  const social = await startSocialApp()
  const secretKey = randomBytes(32)
  const baseGuard = createUrlGuard({ allowedPrivateHosts: [`127.0.0.1:${social.port}`, ...(opts.extraPrivateHosts ?? [])] })
  const app: AppSource = {
    id: 'app-1',
    projectId: PROJECT_ID,
    appUrl: `${social.url}/login`,
    loginDomains: [],
    updatedBy: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const abort = new AbortController()
  const aborted = new Promise<null>((resolve) => abort.signal.addEventListener('abort', () => resolve(null), { once: true }))
  return {
    browser,
    social,
    baseGuard,
    appGuard: createAppGuard(baseGuard, app.appUrl, app.loginDomains),
    app,
    teen: makeAccount(
      { id: 'acc-teen', label: 'Teen 15', ageGroup: 'under_18', age: 15, loginName: 'teen.login@example.test', handles: ['teen15'] },
      TEEN_PASSWORD,
      secretKey,
    ),
    adult: makeAccount(
      { id: 'acc-adult', label: 'Adult 30', ageGroup: 'adult', age: 30, loginName: 'adult.login@example.test', handles: ['adult30'] },
      ADULT_PASSWORD,
      secretKey,
    ),
    secretKey,
    abort,
    aborted,
    close: async () => {
      abort.abort()
      await social.close()
    },
  }
}

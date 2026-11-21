import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAppWorld, type AppWorld } from '../../../fixtures/appWorld.js'
import { TEST_TIMEOUT_MS } from '../../../fixtures/pages.js'
import { outlineLines } from '../../../../src/features/evidence/appRead.js'
import { createSessionPool, type AppSessionPool } from '../../../../src/features/evidence/appSession.js'
import type { AppView } from '../../../../src/features/evidence/appTypes.js'
import { closeBrowser } from '../../../../src/features/evidence/browser.js'

/** A short action limit, so that a stall shows in seconds. */
vi.mock('../../../../src/features/evidence/config.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../src/features/evidence/config.js')>()), APP_ACTION_TIMEOUT_MS: 1_500 }))
vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })

let world: AppWorld
let pool: AppSessionPool

beforeEach(async () => {
  world = await startAppWorld()
  pool = createSessionPool({
    browser: world.browser,
    baseGuard: world.baseGuard,
    app: world.app,
    accounts: [world.teen],
    secretKey: world.secretKey,
    signal: world.abort.signal,
    aborted: world.aborted,
  })
})

afterEach(async () => {
  await pool.closeAll()
  await world.close()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeBrowser()
})

function find(view: AppView, role: string, name: string): string {
  const found = view.elements.find((el) => el.role === role && el.name === name)
  if (!found) throw new Error(`No ${role} "${name}" in:\n${outlineLines(view)}`)
  return found.ref
}

/** Keeps the page's main thread busy for a while, so that nothing evaluated in it can answer. */
async function stall(page: import('playwright').Page, ms: number): Promise<void> {
  await page.evaluate((duration) => {
    setTimeout(() => {
      const end = Date.now() + duration
      while (Date.now() < end) {
        /* busy */
      }
    }, 0)
  }, ms)
}

describe('bounded by the action limit', () => {
  it('screenshot and photographQuote give null instead of waiting for a busy page', async () => {
    const session = await pool.open(world.teen.id)
    await session.read()
    await stall(session.page, 5_000)

    const started = Date.now()
    expect(await session.screenshot()).toBeNull()
    expect(await session.photographQuote('Password')).toBeNull()

    expect(Date.now() - started).toBeLessThan(4_500)
  })

  it('a click that happened but whose page loads slowly reports ok and says the page was still loading', async () => {
    const session = await pool.open(world.teen.id)
    await session.page.evaluate((href) => {
      const link = document.createElement('a')
      link.href = href
      link.textContent = 'Slow page'
      document.body.append(link)
    }, `${world.social.url}/slow`)
    const view = await session.read()

    const result = await session.execute({ type: 'click', ref: find(view, 'link', 'Slow page') })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('still loading')
  })
})

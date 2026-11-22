import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAppWorld, type AppWorld } from '../../../fixtures/appWorld.js'
import { TEST_TIMEOUT_MS } from '../../../fixtures/pages.js'
import { outlineLines } from '../../../../src/features/evidence/appRead.js'
import { createSessionPool, type AppSessionPool } from '../../../../src/features/evidence/appSession.js'
import type { AppView } from '../../../../src/features/evidence/appTypes.js'
import { closeBrowser } from '../../../../src/features/evidence/browser.js'

/** A link that opens a new tab (Mastodon's "Settings" in its account menu): new tabs are closed, so it is opened in this one. */
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
})

afterAll(async () => {
  await closeBrowser()
})

function ref(view: AppView, role: string, name: string): string {
  const found = view.elements.find((el) => el.role === role && el.name === name)
  if (!found) throw new Error(`No ${role} "${name}" in:\n${outlineLines(view)}`)
  return found.ref
}

describe('links that open a new tab', () => {
  it('a click on one opens its page in this tab and says so', async () => {
    const session = await pool.open(world.teen.id)
    await session.gotoInApp(`${world.social.url}/icons`)

    const result = await session.execute({ type: 'click', ref: ref(await session.read(), 'link', 'Welcome page') })
    const view = await session.read()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('new tab')
    expect(new URL(view.url).pathname).toBe('/welcome')
    expect(session.page.context().pages()).toHaveLength(1)
  })

  it('a click on an ordinary link is a plain click, as before', async () => {
    const session = await pool.open(world.teen.id)
    await session.gotoInApp(`${world.social.url}/icons`)

    const result = await session.execute({ type: 'click', ref: ref(await session.read(), 'link', 'Home') })

    expect(result).toEqual({ ok: true, detail: 'Clicked.' })
  })
})

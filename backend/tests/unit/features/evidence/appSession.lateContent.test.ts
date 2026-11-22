import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAppWorld, type AppWorld } from '../../../fixtures/appWorld.js'
import { TEST_TIMEOUT_MS } from '../../../fixtures/pages.js'
import { outlineLines } from '../../../../src/features/evidence/appRead.js'
import { createSessionPool, type AppSessionPool } from '../../../../src/features/evidence/appSession.js'
import type { AppView } from '../../../../src/features/evidence/appTypes.js'
import { closeBrowser } from '../../../../src/features/evidence/browser.js'
import { APP_ACTION_TIMEOUT_MS } from '../../../../src/features/evidence/config.js'

/** Pages drawn by a script after they load, as Mastodon's web app is: the read must wait for what they draw. */
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

function addLink(page: import('playwright').Page, href: string, text: string): Promise<void> {
  return page.evaluate(
    ([address, label]) => {
      const link = document.createElement('a')
      link.href = address
      link.textContent = label
      document.body.append(link)
    },
    [href, text] as const,
  )
}

function linkRef(view: AppView, name: string): string {
  const found = view.elements.find((el) => el.role === 'link' && el.name === name)
  if (!found) throw new Error(`No link "${name}" in:\n${outlineLines(view)}`)
  return found.ref
}

describe('pages drawn after they load', () => {
  it('after a click, the read shows what the page draws late, not the blank or half-drawn page', async () => {
    const session = await pool.open(world.teen.id)
    await addLink(session.page, `${world.social.url}/late`, 'Late page')

    const result = await session.execute({ type: 'click', ref: linkRef(await session.read(), 'Late page') })
    const view = await session.read()

    expect(result.ok).toBe(true)
    expect(outlineLines(view)).toContain('checkbox "Hide your social graph" [on]')
  })

  it('open_link waits for the late content as well', async () => {
    const session = await pool.open(world.teen.id)

    const result = await session.execute({ type: 'open_link', url: `${world.social.url}/late` })
    const view = await session.read()

    expect(result.ok).toBe(true)
    expect(view.text).toContain('Hide your social graph')
  })

  it('a page that never draws anything is read once the wait runs out, within the action limit', async () => {
    const session = await pool.open(world.teen.id)

    const started = Date.now()
    const result = await session.execute({ type: 'open_link', url: `${world.social.url}/blank` })
    const view = await session.read()

    expect(result.ok).toBe(true)
    expect(view.text.trim()).toBe('')
    expect(Date.now() - started).toBeLessThan(APP_ACTION_TIMEOUT_MS)
  })
})

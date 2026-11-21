import { describe, it } from 'vitest'
import { allowed, CLICK, el, refused, view } from '../../../../src/features/evidence/appSafetyTestKit.js'

const link = (name: string, href: string) => el('e1', name, { role: 'link', tag: 'a', href })
const settingsPage = (name: string, href: string, url = 'https://app.test/settings') => view([link(name, href)], { url })

describe('links between settings pages', () => {
  it.each([
    ['Messaging', '/settings/messaging'],
    ['Sharing', '/settings/sharing'],
    ['Post privacy', '/settings/privacy'],
    ['Contact', '/settings/contact'],
  ])('lets a click on "%s" open its settings page', (name, href) => {
    allowed(CLICK, settingsPage(name, href))
  })

  it('still refuses the same label outside the settings area', () => {
    refused(CLICK, settingsPage('Messaging', '/inbox/new', 'https://app.test/home'), 'own_accounts')
  })

  it('still refuses a settings-looking label that links to another site', () => {
    refused(CLICK, settingsPage('Messaging', 'https://other.test/settings/messaging'), 'own_accounts')
  })

  it('still refuses a link whose address acts when opened', () => {
    refused(CLICK, settingsPage('Sharing', '/settings/share/now'), 'destructive')
  })

  it('does not extend to buttons', () => {
    refused(CLICK, view([el('e1', 'Messaging', { href: null })], { url: 'https://app.test/settings' }), 'own_accounts')
  })

  it('tells the AI to choose a different link when a link is refused', () => {
    const verdict = refusedReason(settingsPage('Messaging', '/inbox/new', 'https://app.test/home'))
    if (!/Choose a different link\./.test(verdict)) throw new Error(`hint missing: ${verdict}`)
  })
})

import { checkAction } from '../../../../src/features/evidence/appSafety.js'
import { CTX } from '../../../../src/features/evidence/appSafetyTestKit.js'
import type { AppView } from '../../../../src/features/evidence/appTypes.js'

function refusedReason(v: AppView): string {
  const verdict = checkAction(CLICK, v, CTX)
  return verdict.allowed ? '' : verdict.reason
}

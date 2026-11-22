import { describe, expect, it } from 'vitest'
import { checkAction } from '../../../../src/features/evidence/appSafety.js'
import { allowed, CLICK, CTX, el, refused, view } from '../../../../src/features/evidence/appSafetyTestKit.js'
import type { AppAction } from '../../../../src/features/evidence/appTypes.js'

/**
 * A settings menu entry whose label holds a destructive word ("Automated post deletion") but whose address only
 * shows a page. It is never clicked (a click could run the app's own script); its page may be opened with open_link
 * by its ref, which loads the address and nothing else, and only when the address itself is safe.
 */
const OPEN: AppAction = { type: 'open_link', ref: 'e1' }
const link = (name: string, href: string) => el('e1', name, { role: 'link', tag: 'a', href })
const onSettings = (name: string, href: string, url = 'https://app.test/settings/privacy') => view([link(name, href)], { url })

describe('settings menu entries with a destructive word in their label', () => {
  it('lets open_link by ref open the page of "Automated post deletion"', () => {
    allowed(OPEN, onSettings('Automated post deletion', '/statuses_cleanup'))
  })

  it('still refuses a click on it, and the reason says how its page can be opened', () => {
    const verdict = checkAction(CLICK, onSettings('Automated post deletion', '/statuses_cleanup'), CTX)

    expect(verdict).toMatchObject({ allowed: false, rule: 'destructive' })
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('open_link')
      expect(verdict.reason).not.toContain('Choose a different link')
    }
  })

  it.each([
    ['Delete account', '/settings/delete'],
    ['Log out', '/auth/sign_out'],
    ['Remove follower', '/relationships/remove'],
    ['Billing', '/settings/billing'],
  ])('still refuses "%s", whose address says what it does', (name, href) => {
    refused(OPEN, onSettings(name, href), 'destructive')
  })

  it.each([
    ['Change password', '/settings/password'],
    ['Delete account', '/settings/danger_zone'],
    ['Delete your profile data', '/settings/data'],
    ['Billing and payments', '/settings/plan'],
    ['Log out of other sessions', '/settings/sessions'],
  ])('still refuses "%s", whose label is about the account, a password, money or signing out, whatever its address', (name, href) => {
    refused(OPEN, onSettings(name, href), 'destructive')
  })

  it('still refuses an address that acts when opened', () => {
    refused(OPEN, onSettings('Remove blocks', '/settings/block/all'), 'destructive')
  })

  it('still refuses the entry outside the settings area', () => {
    refused(OPEN, onSettings('Automated post deletion', '/statuses_cleanup', 'https://app.test/home'), 'destructive')
  })

  it('still refuses the entry when it leads to another site', () => {
    refused(OPEN, onSettings('Automated post deletion', 'https://other.test/statuses_cleanup'), 'destructive')
  })

  it('does not extend to buttons', () => {
    refused(CLICK, view([el('e1', 'Delete posts automatically')], { url: 'https://app.test/settings/privacy' }), 'destructive')
  })

  it('does not extend to open_link by a written address: the label is not known there', () => {
    allowed({ type: 'open_link', url: 'https://app.test/statuses_cleanup' }, onSettings('Other', '/x'))
    refused({ type: 'open_link', url: 'https://app.test/settings/delete' }, onSettings('Other', '/x'), 'destructive')
  })
})

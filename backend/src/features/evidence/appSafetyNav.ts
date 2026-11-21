/** Rule helper: a link between settings pages only opens a page, whatever words its label holds. */
import type { AppElement, AppView } from './appTypes.js'
import { parseUrl, pathSegments } from './appSafetyText.js'

/** Path parts that mark the settings area of an app. */
const SETTINGS_SEGMENT = /^(?:settings|preferences|privacy|account|accounts)$/

/** An address that does something when it is opened, instead of showing a page. */
const ACTING_ADDRESS = /(?:^|\/)(?:api|graphql|intent|follow|unfollow|send|share|publish|compose|tweet|repost|retweet|poke|wave|invite|connect|add-?friend|friend-?request|block|report)(?:[/_-]|$)|[?&](?:action|text|status|message|follow)=/i

function inSettings(address: string): boolean {
  return pathSegments(address).some((segment) => SETTINGS_SEGMENT.test(segment))
}

/**
 * A link on a settings page that goes to another page of the same app's settings area.
 * "Messaging", "Sharing" or "Post privacy" are menu entries there, not a message or a post.
 * The address must be on the same site as the page, must not be an acting address, and the page itself must be in settings.
 */
export function isSettingsLink(element: AppElement, view: AppView): boolean {
  if (element.role !== 'link' || element.href === null) return false
  const target = parseUrl(element.href, view.url)
  const here = parseUrl(view.url)
  if (target === null || here === null || target.origin !== here.origin) return false
  if (ACTING_ADDRESS.test(`${target.pathname}${target.search}`)) return false
  return inSettings(view.url) && inSettings(target.href)
}

/**
 * A plain "Settings" link on any page of the app, to an address that is not an acting address. It is only used to find
 * the settings area, never to allow a click: the click is judged by the usual rules.
 */
export function isSettingsEntryLink(element: AppElement, view: AppView): boolean {
  if (element.role !== 'link' || element.href === null || !/^\s*settings\s*$/i.test(element.name)) return false
  const target = parseUrl(element.href, view.url)
  const here = parseUrl(view.url)
  if (target === null || here === null || target.origin !== here.origin) return false
  return !ACTING_ADDRESS.test(`${target.pathname}${target.search}`)
}

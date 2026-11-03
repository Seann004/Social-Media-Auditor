import robotsParserModule from 'robots-parser'
import { logCaptureFailure } from './captureLog.js'
import { PAGE_TIMEOUT_MS, USER_AGENT } from './config.js'
import type { UrlGuard } from './urlGuard.js'

export interface RobotsDecision {
  allowed: boolean
  reason: string | null
}

export interface RobotsChecker {
  isAllowed(url: string): Promise<RobotsDecision>
}

type ParseRobots = (url: string, contents: string) => { isAllowed(url: string, userAgent: string): boolean | undefined }

/** The package is `module.exports = fn`, but its types declare an ES default export, which NodeNext resolves wrongly. */
const parseRobots = robotsParserModule as unknown as ParseRobots

type RuleSet = { kind: 'rules'; isAllowed(url: string): boolean } | { kind: 'fixed'; decision: RobotsDecision }

const ALLOW_ALL: RuleSet = { kind: 'fixed', decision: { allowed: true, reason: null } }
export const ROBOTS_DISALLOWED_REASON = 'robots.txt does not allow this page.'

function unreadable(why: string): RuleSet {
  return { kind: 'fixed', decision: { allowed: false, reason: `robots.txt could not be read (${why}), so the page was skipped.` } }
}

function getRobotsFile(url: string): Promise<Response> {
  return fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  })
}

function redirectLocation(response: Response, from: string): string | null {
  const location = response.headers.get('location')
  if (response.status < 300 || response.status >= 400 || !location) return null
  try {
    return new URL(location, from).href
  } catch {
    // The guard refuses a url it cannot parse.
    return location
  }
}

/** Fetches robots.txt, following one redirect if the guard allows the target. */
async function fetchRobotsFile(robotsUrl: string, guard: UrlGuard): Promise<Response | RuleSet> {
  const first = await guard.check(robotsUrl)
  if (!first.allowed) return unreadable(first.reason)

  const response = await getRobotsFile(robotsUrl)
  const target = redirectLocation(response, robotsUrl)
  if (target === null) return response
  await response.body?.cancel()

  const verdict = await guard.check(target)
  if (!verdict.allowed) return unreadable(`it redirects to a refused address: ${verdict.reason}`)

  const landed = await getRobotsFile(target)
  if (redirectLocation(landed, target) === null) return landed
  await landed.body?.cancel()
  return unreadable('it redirects more than once')
}

async function loadRules(origin: string, guard: UrlGuard): Promise<RuleSet> {
  // Rules are matched against this url's origin, even when the file came from a redirect target.
  const robotsUrl = `${origin}/robots.txt`
  try {
    const result = await fetchRobotsFile(robotsUrl, guard)
    if (!(result instanceof Response)) return result

    if (result.status === 404 || result.status === 410) {
      await result.body?.cancel()
      return ALLOW_ALL
    }
    if (!result.ok) {
      await result.body?.cancel()
      return unreadable(`HTTP ${result.status}`)
    }
    const rules = parseRobots(robotsUrl, await result.text())
    return { kind: 'rules', isAllowed: (url) => rules.isAllowed(url, USER_AGENT) === true }
  } catch (err) {
    logCaptureFailure('Could not read robots.txt', robotsUrl, err)
    return unreadable('it could not be fetched')
  }
}

/**
 * Reads a site's robots.txt once and applies it to each url. A missing file allows
 * everything. Any other failure disallows, so that a broken or unreachable robots.txt
 * can never be mistaken for permission. Keep one checker per run: rules are cached.
 */
export function createRobotsChecker(guard: UrlGuard): RobotsChecker {
  const rulesByOrigin = new Map<string, Promise<RuleSet>>()

  const rulesFor = (origin: string): Promise<RuleSet> => {
    const known = rulesByOrigin.get(origin)
    if (known) return known
    const pending = loadRules(origin, guard)
    rulesByOrigin.set(origin, pending)
    return pending
  }

  return {
    async isAllowed(url: string): Promise<RobotsDecision> {
      let origin: string
      try {
        origin = new URL(url).origin
      } catch {
        return { allowed: false, reason: 'robots.txt could not be checked for an invalid URL.' }
      }
      const rules = await rulesFor(origin)
      if (rules.kind === 'fixed') return rules.decision
      return rules.isAllowed(url) ? { allowed: true, reason: null } : { allowed: false, reason: ROBOTS_DISALLOWED_REASON }
    },
  }
}

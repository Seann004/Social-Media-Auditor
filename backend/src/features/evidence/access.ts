import type { AccessStatus } from './types.js'

export interface AccessInput {
  httpStatus: number | null
  finalUrl: string
  title: string
  text: string
  hasPasswordField: boolean
  timedOut: boolean
  navigationError: boolean
}

export interface AccessResult {
  status: AccessStatus
  detail: string | null
}

/** A page with at least this many words is content, even if it also has a login box. */
const CONTENT_WORDS = 150

const LOGIN_URL_PATTERN = /\/(log-?in|sign-?in|signin|sso|auth)(\/|\?|$)/i
const BLOCK_TITLE_PATTERN = /just a moment|attention required|access denied|are you a robot|security check/i
const BLOCK_TEXT_PATTERN = /verify you are human|checking your browser|unusual traffic|enable javascript and cookies|captcha/i

function pathOf(url: string): string {
  try {
    return new URL(url).pathname + new URL(url).search
  } catch {
    return url
  }
}

/** Classifies how reachable a captured page was. Never tries to get around blocks. */
export function classifyAccess(input: AccessInput): AccessResult {
  const { httpStatus, finalUrl, title, text, hasPasswordField, timedOut, navigationError } = input
  const words = text.split(/\s+/).filter(Boolean).length

  if (timedOut) return { status: 'timeout', detail: 'The page did not finish loading in time.' }
  if (navigationError) return { status: 'error', detail: 'The page could not be opened.' }
  if (httpStatus === 401) return { status: 'login_required', detail: 'The site asked for authentication (HTTP 401).' }
  if (httpStatus === 403 || httpStatus === 429) {
    return { status: 'blocked', detail: `The site refused automated access (HTTP ${httpStatus}).` }
  }
  if (httpStatus !== null && httpStatus >= 400) {
    return { status: 'error', detail: `The page returned HTTP ${httpStatus}.` }
  }
  if (BLOCK_TITLE_PATTERN.test(title) || (words < CONTENT_WORDS && BLOCK_TEXT_PATTERN.test(text))) {
    return { status: 'blocked', detail: 'The site showed a bot check instead of the page.' }
  }
  if (LOGIN_URL_PATTERN.test(pathOf(finalUrl))) {
    return { status: 'login_required', detail: 'The page redirected to a login screen.' }
  }
  if (hasPasswordField && words < CONTENT_WORDS) {
    return { status: 'login_required', detail: 'The page is a login form.' }
  }
  return { status: 'ok', detail: null }
}

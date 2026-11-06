import ipaddr from 'ipaddr.js'
import type { UrlGuard } from './urlGuard.js'

const OUTSIDE_SCOPE = 'This address is outside the app and its login domains.'
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

/** A host the scope matches: a domain with its subdomains, or an IP address with its port. */
type ScopeHost = { kind: 'domain'; name: string } | { kind: 'ip'; address: string; port: string }

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function bareHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function scopeHostOf(url: URL): ScopeHost {
  const host = bareHostname(url)
  if (ipaddr.isValid(host)) {
    return { kind: 'ip', address: ipaddr.parse(host).toNormalizedString(), port: url.port || DEFAULT_PORTS[url.protocol] }
  }
  return { kind: 'domain', name: host.replace(/^www\./, '') }
}

/** A login domain as the auditor typed it: a bare host, a host with a port, or a whole address. */
function loginScopeHost(entry: string): ScopeHost | null {
  const trimmed = entry.trim()
  if (trimmed === '') return null
  const url = parseHttpUrl(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  return url && bareHostname(url) !== '' ? scopeHostOf(url) : null
}

function matches(target: ScopeHost, scope: ScopeHost): boolean {
  if (target.kind === 'ip' || scope.kind === 'ip') {
    return target.kind === 'ip' && scope.kind === 'ip' && target.address === scope.address && target.port === scope.port
  }
  return target.name === scope.name || target.name.endsWith(`.${scope.name}`)
}

/**
 * True for an http(s) address on the app's host (with `www.` stripped) or one of its subdomains,
 * or on a login domain or one of its subdomains. An IP host matches only exactly, port included.
 */
export function isInAppScope(url: string, appUrl: string, loginDomains: string[]): boolean {
  const target = parseHttpUrl(url)
  const app = parseHttpUrl(appUrl)
  if (!target || !app) return false
  const scopes = [scopeHostOf(app), ...loginDomains.map(loginScopeHost).filter((host) => host !== null)]
  const targetHost = scopeHostOf(target)
  return scopes.some((scope) => matches(targetHost, scope))
}

/** The scope first, then everything the base guard checks, private addresses included. */
export function createAppGuard(base: UrlGuard, appUrl: string, loginDomains: string[]): UrlGuard {
  const domains = [...loginDomains]
  return {
    async check(url) {
      if (!isInAppScope(url, appUrl, domains)) return { allowed: false, reason: OUTSIDE_SCOPE }
      return base.check(url)
    },
  }
}

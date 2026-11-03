import { promises as dns } from 'node:dns'
import ipaddr from 'ipaddr.js'

export type LookupFn = (host: string) => Promise<{ address: string }[]>

export type UrlCheckResult = { allowed: true } | { allowed: false; reason: string }

export interface UrlGuard {
  check(url: string): Promise<UrlCheckResult>
}

export interface UrlGuardOptions {
  /** Exact `host:port` entries that may resolve to private addresses. */
  allowedPrivateHosts?: string[]
  lookup?: LookupFn
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

const defaultLookup: LookupFn = (host) => dns.lookup(host, { all: true })

const blocked = (reason: string): UrlCheckResult => ({ allowed: false, reason })

function isPublicAddress(ip: string): boolean {
  try {
    return ipaddr.process(ip).range() === 'unicast'
  } catch {
    return false
  }
}

export function createUrlGuard(opts: UrlGuardOptions = {}): UrlGuard {
  const allowedPrivate = new Set((opts.allowedPrivateHosts ?? []).map((h) => h.toLowerCase()))
  const lookup = opts.lookup ?? defaultLookup
  const cache = new Map<string, Promise<{ address: string }[]>>()

  const resolve = (host: string) => {
    const hit = cache.get(host)
    if (hit) return hit
    const pending = lookup(host)
    cache.set(host, pending)
    // Do not cache failures, so a transient DNS error can be retried.
    pending.catch(() => cache.delete(host))
    return pending
  }

  return {
    async check(rawUrl: string): Promise<UrlCheckResult> {
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        return blocked('Not a valid URL')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return blocked(`Scheme ${url.protocol} is not allowed`)
      }
      if (url.username || url.password) return blocked('URLs with credentials are not allowed')

      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      const port = url.port || DEFAULT_PORTS[url.protocol]
      const hostPort = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
      if (allowedPrivate.has(hostPort) || allowedPrivate.has(`${host}:${port}`)) {
        return { allowed: true }
      }

      if (host === 'localhost' || host.endsWith('.localhost')) {
        return blocked('Host resolves to a non-public address')
      }

      if (ipaddr.isValid(host)) {
        return isPublicAddress(host) ? { allowed: true } : blocked('Host is a non-public address')
      }

      let addresses: { address: string }[]
      try {
        addresses = await resolve(host)
      } catch {
        return blocked('Host could not be resolved')
      }
      if (addresses.length === 0) return blocked('Host could not be resolved')
      if (!addresses.every((a) => isPublicAddress(a.address))) {
        return blocked('Host resolves to a non-public address')
      }
      return { allowed: true }
    },
  }
}

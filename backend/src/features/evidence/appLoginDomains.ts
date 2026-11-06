/**
 * The login domains an auditor lists for an app: the sign-in sites (SSO, accounts.*) the app sends its
 * users to. Each one widens where the browser may go, so a shared ending (co.uk, github.io), a reserved
 * or local name (x.localhost, x.internal) or an IP address is refused.
 */
import { isIP } from 'node:net'
import { APP_MAX_LOGIN_DOMAINS } from './config.js'

const HOST_NAME = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]+$/i
const NUMERIC_LABEL = /^(0x[0-9a-f]*|[0-9]+)$/i

/**
 * Common public suffixes with more than one label: anyone can register a site under them. Single
 * labels (com, org, my, io) are already refused, since a login domain needs at least one dot. A small
 * built-in list on purpose, not the whole Public Suffix List.
 */
const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'sch.uk',
  // Malaysia and Singapore
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my', 'mil.my', 'name.my', 'biz.my',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
  // Australia and New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  // East and South Asia
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'gov.in', 'edu.in',
  'co.id', 'or.id', 'web.id', 'ac.id', 'go.id',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk',
  'com.tw', 'net.tw', 'org.tw', 'edu.tw', 'gov.tw',
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph',
  'co.th', 'in.th', 'or.th', 'ac.th', 'go.th',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'com.pk', 'com.bd',
  // The Americas, Africa, the Middle East and Europe
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'com.ar',
  'co.za', 'org.za', 'gov.za', 'com.ng', 'com.eg', 'co.ke',
  'com.sa', 'co.il', 'org.il', 'ac.il', 'com.tr', 'com.ua',
  'com.np', 'com.lk', 'com.kh', 'com.mm', 'com.qa', 'com.kw', 'com.om', 'com.bh', 'co.ae', 'com.jo', 'com.lb',
  'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.ec', 'com.gt', 'net.ar', 'org.ar', 'gob.ar',
  'co.tz', 'co.ug', 'com.gh', 'co.zw', 'com.es', 'co.at', 'or.at', 'gv.at', 'ac.at', 'com.pl', 'org.ru', 'com.ru',
  // Hosting where every customer gets a subdomain
  'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'appspot.com', 'blogspot.com', 'azurewebsites.net', 'azurestaticapps.net',
  'cloudfront.net', 's3.amazonaws.com', 'amplifyapp.com', 'onrender.com', 'fly.dev', 'glitch.me',
  'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'wordpress.com', 'wixsite.com', 'myshopify.com',
  'supabase.co', 'amazonaws.com', 'compute.amazonaws.com', 'elasticbeanstalk.com', 'googleusercontent.com',
  'azureedge.net', 'cloudapp.net', 'run.app', 'r2.dev',
])

/**
 * Special-use and local-only top-level names: no public sign-in site lives under them, and some
 * (localhost) reach this machine without asking DNS.
 */
const RESERVED_TLDS: ReadonlySet<string> = new Set([
  'localhost', 'local', 'internal', 'test', 'example', 'invalid', 'onion', 'arpa', 'lan', 'home', 'corp', 'localdomain',
])

export type LoginDomainsResult = { ok: true; domains: string[] } | { ok: false; error: string }

const refuse = (error: string): LoginDomainsResult => ({ ok: false, error })

/** True when `host` is itself a shared ending such as co.uk or github.io; a tenant under one (user.github.io) is not. */
export function isPublicSuffix(host: string): boolean {
  return PUBLIC_SUFFIXES.has(host.toLowerCase().replace(/\.$/, ''))
}

/** True when the last label is a special-use or local-only name, at any depth (a.b.localhost, nas.home.arpa). */
export function isReservedName(host: string): boolean {
  const labels = host.toLowerCase().split('.')
  return RESERVED_TLDS.has(labels[labels.length - 1])
}

/** True for an IP literal, including the short and hex forms a browser still reads as one (127.1, 0x7f.1). */
function isIpLiteral(host: string): boolean {
  const labels = host.split('.')
  return isIP(host) !== 0 || NUMERIC_LABEL.test(labels[labels.length - 1])
}

/** The reason one domain is refused, or null when it is a usable host name. `n` counts from 1. */
function refusalOf(host: string, n: number): string | null {
  if (!HOST_NAME.test(host)) return `Login domain ${n} is not a host name such as accounts.example.com.`
  if (isIpLiteral(host)) return `Login domain ${n} is an IP address: enter the sign-in site's host name.`
  if (isReservedName(host)) return `Login domain ${n} is a reserved or local name: enter the sign-in site's public host name.`
  if (isPublicSuffix(host)) {
    return `Login domain ${n} is a shared ending such as co.uk or github.io: enter the sign-in site's own host name.`
  }
  return null
}

/**
 * Checks what the auditor typed: at most APP_MAX_LOGIN_DOMAINS entries, each a host name that is
 * not a public suffix, a reserved name or an IP address. Returns them lower-cased and without repeats, in the
 * order typed. A refusal is one sentence and names the entry by its position, never by its text.
 */
export function checkLoginDomains(raw: readonly string[]): LoginDomainsResult {
  if (raw.length > APP_MAX_LOGIN_DOMAINS) return refuse(`Enter at most ${APP_MAX_LOGIN_DOMAINS} login domains.`)
  const hosts = raw.map((d) => d.trim().toLowerCase())
  for (const [i, host] of hosts.entries()) {
    const refusal = refusalOf(host, i + 1)
    if (refusal) return refuse(refusal)
  }
  return { ok: true, domains: [...new Set(hosts)] }
}


import { gzipSync } from 'node:zlib'

export interface ExtraTarEntry {
  name: string
  /** The tar type flag, such as '0' for a file, '2' for a symlink or '5' for a folder. */
  type: string
  body?: Buffer
}

export interface BuildTarOptions {
  topFolder?: string
  extraEntries?: ExtraTarEntry[]
}

const BLOCK = 512

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0'
}

function header(name: string, type: string, size: number): Buffer {
  const h = Buffer.alloc(BLOCK)
  h.write(name.slice(0, 100), 0, 100, 'utf8')
  h.write(octal(0o644, 8), 100, 8)
  h.write(octal(0, 8), 108, 8)
  h.write(octal(0, 8), 116, 8)
  h.write(octal(size, 12), 124, 12)
  h.write(octal(0, 12), 136, 12)
  h.fill(0x20, 148, 156)
  h.write(type, 156, 1)
  h.write('ustar\0', 257, 6)
  h.write('00', 263, 2)
  const sum = h.reduce((total, byte) => total + byte, 0)
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

function padded(body: Buffer): Buffer {
  const rest = body.length % BLOCK
  return rest === 0 ? body : Buffer.concat([body, Buffer.alloc(BLOCK - rest)])
}

/** One pax record: "<length> <key>=<value>\n", where length counts the whole record. */
function paxRecord(key: string, value: string): Buffer {
  const rest = Buffer.byteLength(` ${key}=${value}\n`)
  let length = rest + 1
  while (String(length).length + rest !== length) length = String(length).length + rest
  return Buffer.from(`${length} ${key}=${value}\n`)
}

function entry(name: string, type: string, body: Buffer): Buffer[] {
  const parts: Buffer[] = []
  if (Buffer.byteLength(name) > 100) {
    const pax = paxRecord('path', name)
    parts.push(header('PaxHeader', 'x', pax.length), padded(pax))
  }
  parts.push(header(name, type, body.length), padded(body))
  return parts
}

/** Builds a tar.gz in memory: ustar headers, plus pax `x` headers for long paths. */
export function buildTarGz(files: Record<string, string | Buffer>, opts: BuildTarOptions = {}): Buffer {
  const top = opts.topFolder ?? 'repo-main'
  const parts: Buffer[] = [...entry(`${top}/`, '5', Buffer.alloc(0))]
  for (const [path, content] of Object.entries(files)) {
    parts.push(...entry(`${top}/${path}`, '0', Buffer.isBuffer(content) ? content : Buffer.from(content)))
  }
  for (const extra of opts.extraEntries ?? []) parts.push(...entry(extra.name, extra.type, extra.body ?? Buffer.alloc(0)))
  parts.push(Buffer.alloc(BLOCK * 2))
  return gzipSync(Buffer.concat(parts))
}

/** A fetch that serves only the listed urls; any other url fails the test. */
export function fakeGithubFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const route = routes[url]
    if (!route) throw new Error(`Unexpected request in a test: ${url}`)
    return route()
  }) as typeof fetch
}

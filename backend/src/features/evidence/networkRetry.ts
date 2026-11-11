import { wait } from '../../lib/groq.js'

/**
 * Error codes of a connection that failed or broke: set by Node on the error or on its cause. Shared by
 * the Groq and Supabase retries, so both sides agree on what a network failure is.
 */
export const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown }

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === 'object' && value !== null ? (value as ErrorLike) : null
}

function isAbort(err: ErrorLike): boolean {
  return err.name === 'AbortError' || err.code === 'ABORT_ERR'
}

/** A message that on its own means the connection failed. */
export const NETWORK_MESSAGE = /^(?:TypeError: )?fetch failed$|socket hang up/i

/**
 * The error code in a text: Node's E... codes and undici's UND_ERR_... codes. A code in brackets, as
 * postgrest-js appends the cause's code ("(ECONNRESET)"), wins over one in the running text.
 */
export function codeIn(text: string): string | null {
  const bracketed = /\((E[A-Z]{3,}|UND_ERR_[A-Z_]+)\)/.exec(text)
  if (bracketed) return bracketed[1]
  return /\b(E[A-Z]{3,}|UND_ERR_[A-Z_]+)\b/.exec(text)?.[1] ?? null
}

/**
 * True for an error thrown by fetch itself, before any HTTP status: a reset or refused connection, a
 * timeout, a socket hang-up, or a "fetch failed" with no other cause. When the error or its cause has a
 * code, the code decides: "fetch failed" caused by headers too large (UND_ERR_HEADERS_OVERFLOW) is not
 * a network failure. Never true for an abort.
 */
export function isNetworkError(value: unknown): boolean {
  const err = asErrorLike(value)
  if (!err || isAbort(err)) return false
  const cause = asErrorLike(err.cause)
  const code = typeof err.code === 'string' && err.code ? err.code : cause && typeof cause.code === 'string' ? cause.code : ''
  if (code) return NETWORK_CODES.has(code)
  const message = typeof err.message === 'string' ? err.message : ''
  if (err instanceof TypeError && message === 'fetch failed') return true
  return /socket hang up/i.test(message)
}

/** A short description for the log: name, message and the cause's code. Never request headers. */
export function describeFailure(value: unknown): string {
  const err = asErrorLike(value)
  if (!err) return String(value)
  const cause = asErrorLike(err.cause)
  const code = typeof err.code === 'string' && err.code ? err.code : cause && typeof cause.code === 'string' ? cause.code : ''
  const name = typeof err.name === 'string' && err.name ? `${err.name}: ` : ''
  return `${name}${String(err.message ?? '')}${code ? ` (${code})` : ''}`
}

export interface NetworkRetryOptions<T> {
  /** Names the call in the log. */
  label: string
  /** One wait per extra try. */
  delaysMs: readonly number[]
  /** An abort ends any wait at once with the signal's reason. */
  signal?: AbortSignal
  /** For clients that return failures instead of throwing: the failure to log when a result is a network failure, else null. */
  failureOf?: (result: T) => unknown | null
}

/**
 * Runs `attempt`, and runs it again after each wait while it fails on the network. Any other error
 * is thrown at once. After the last try, a network error is thrown and a failed result is returned.
 */
export async function retryOnNetworkFailure<T>(attempt: () => Promise<T>, opts: NetworkRetryOptions<T>): Promise<T> {
  const tries = opts.delaysMs.length + 1
  for (let i = 0; ; i++) {
    let failure: unknown
    try {
      const result = await attempt()
      failure = opts.failureOf?.(result) ?? null
      if (failure === null || i + 1 >= tries || opts.signal?.aborted) return result
    } catch (err) {
      if (!isNetworkError(err) || i + 1 >= tries || opts.signal?.aborted) throw err
      failure = err
    }
    const delay = opts.delaysMs[i]
    console.error(
      `[evidence] ${opts.label}: network failure (${describeFailure(failure)}); try ${i + 2} of ${tries} in ${delay} ms`,
    )
    await wait(delay, opts.signal)
  }
}

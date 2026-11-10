import { wait } from '../../lib/groq.js'

/** Error codes of a connection that failed or broke: set by Node on the error or on its cause. */
const NETWORK_CODES = new Set([
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

/**
 * True for an error thrown by fetch itself, before any HTTP status: "fetch failed", a reset or
 * refused connection, a timeout, a socket hang-up. Never true for an abort.
 */
export function isNetworkError(value: unknown): boolean {
  const err = asErrorLike(value)
  if (!err || isAbort(err)) return false
  const cause = asErrorLike(err.cause)
  if (typeof err.code === 'string' && NETWORK_CODES.has(err.code)) return true
  if (cause && typeof cause.code === 'string' && NETWORK_CODES.has(cause.code)) return true
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

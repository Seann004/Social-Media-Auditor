import { SUPABASE_NETWORK_RETRY_DELAYS_MS } from './config.js'
import { codeIn, isNetworkError, NETWORK_CODES, NETWORK_MESSAGE, retryOnNetworkFailure } from './networkRetry.js'

/** The shape every supabase-js call resolves to. */
export interface DbOutcome {
  data: unknown
  error: { message: string; code?: string; details?: string; hint?: string; originalError?: unknown } | null
  status?: number
}

/** Postgres: unique violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * True when supabase-js reports that the connection itself failed. postgrest-js turns ANY thrown error
 * into status 0 with an empty code (a circular-JSON TypeError, an invalid URL, headers too large), so
 * status 0 alone is not enough. A cause code decides when there is one (postgrest-js appends it to
 * `details` as "(ECONNRESET)"); without one, only "fetch failed" or a socket hang-up counts.
 * Storage wraps the thrown error as `originalError`. An error Postgres returned always has a status.
 */
export function isDbNetworkFailure(res: DbOutcome): boolean {
  const error = res.error
  if (!error) return false
  if (error.originalError !== undefined) return isNetworkError(error.originalError)
  if (res.status !== 0 || error.code) return false
  const causeCode = codeIn(error.details ?? '') ?? codeIn(error.message)
  if (causeCode !== null) return NETWORK_CODES.has(causeCode)
  return NETWORK_MESSAGE.test(error.message)
}

const failureOf = (res: DbOutcome): unknown | null => (isDbNetworkFailure(res) ? res.error?.message ?? 'network failure' : null)

/*
 * The Supabase waits take no abort signal, on purpose: when a run times out or stops, its final status
 * writes (updateRun) must still land, so they are retried even after the run's signal has aborted.
 */

/**
 * A Supabase call that is safe to send twice (an update, an upsert, a delete, a read or an RPC that
 * only reads), tried again while it fails on the network. Returns the last result, as supabase-js does.
 */
export function dbCall<R extends DbOutcome>(
  op: string,
  run: () => PromiseLike<R>,
  delaysMs: readonly number[] = SUPABASE_NETWORK_RETRY_DELAYS_MS,
): Promise<R> {
  return retryOnNetworkFailure(async () => run(), { label: op, delaysMs, failureOf })
}

/**
 * An insert of rows whose ids the caller chose, tried again while it fails on the network. A network
 * failure can come after Postgres saved the rows, so a retry may meet its own rows as a unique
 * violation. Then `readBack` (a read of the same ids) answers instead, and nothing is saved twice.
 */
export async function dbInsert<R extends DbOutcome>(
  op: string,
  insert: () => PromiseLike<R>,
  readBack: () => PromiseLike<R>,
  delaysMs: readonly number[] = SUPABASE_NETWORK_RETRY_DELAYS_MS,
): Promise<R> {
  let failedOnNetwork = false
  const res = await retryOnNetworkFailure(async () => insert(), {
    label: op,
    delaysMs,
    failureOf: (r) => {
      const failure = failureOf(r)
      if (failure !== null) failedOnNetwork = true
      return failure
    },
  })
  if (!failedOnNetwork || res.error?.code !== UNIQUE_VIOLATION) return res
  console.error(`[evidence] ${op}: a retry found the rows already saved; reading them back`)
  // A plain read: postgrest-js already retries GETs that fail on the network.
  const saved = await readBack()
  const found = saved.error === null && saved.data !== null && (!Array.isArray(saved.data) || saved.data.length > 0)
  return found ? saved : res
}

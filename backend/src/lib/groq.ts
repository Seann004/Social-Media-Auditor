/** Raised when Groq asks us to wait longer than the caller is willing to. */
export class GroqLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(`Groq rate limit: retry-after ${retryAfterSeconds}s exceeds the allowed wait`)
    this.name = 'GroqLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 15

/**
 * fetch with retry on HTTP 429. Waits for `retry-after` (default 15 s) between tries and
 * makes one final extra attempt. If `retry-after` exceeds `maxWaitSeconds`, throws
 * GroqLimitError at once instead of holding the caller for hours.
 */
export async function groqFetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  maxWaitSeconds = Infinity,
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, options)
    if (res.status !== 429) return res
    const retryAfter = Number(res.headers.get('retry-after') || 0) || DEFAULT_RETRY_AFTER_SECONDS
    if (retryAfter > maxWaitSeconds) throw new GroqLimitError(retryAfter)
    console.warn(`[GROQ] 429 rate limit — waiting ${retryAfter}s before retry ${attempt + 1}/${retries}`)
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
  }
  // Final attempt — return whatever we get
  return fetch(url, options)
}

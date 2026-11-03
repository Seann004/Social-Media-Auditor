/** A query string can hold a token, and a url can hold a password. Neither reaches the log. */
function withoutSecrets(text: string): string {
  return text.replace(/\?[^\s"')]*/g, '?[removed]').replace(/\/\/[^/\s@]+@/g, '//[removed]@')
}

/** The first line only: Playwright follows it with a call log. Node's fetch keeps the real reason in `cause`. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const summary = err.message.split('\n')[0] ?? err.name
  if (!(err.cause instanceof Error)) return summary
  const cause: Error & { code?: string } = err.cause
  return `${summary}: ${cause.code ?? cause.message}`
}

/** Logs why something failed during a capture, with the url it happened on. */
export function logCaptureFailure(what: string, url: string, err: unknown): void {
  console.error(`Evidence capture: ${what} (${withoutSecrets(url)}): ${withoutSecrets(describe(err))}`)
}

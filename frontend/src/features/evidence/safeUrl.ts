/** True only for http: and https: urls. Anything else (javascript:, data:, garbage) must never become a link. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

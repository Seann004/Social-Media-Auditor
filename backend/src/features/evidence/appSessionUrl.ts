import { APP_MIN_SECRET_CHARS } from './config.js'
import { SECRET_PLACEHOLDER } from './appSecrets.js'
import { redactUrl } from './secrets.js'

/** Each secret as it can be written in an address: as typed, percent-encoded, and form-encoded (with + for a space). */
function addressForms(secrets: readonly string[]): string[] {
  const forms = secrets
    .filter((secret) => Array.from(secret).length >= APP_MIN_SECRET_CHARS)
    .flatMap((secret) => [secret, encodeURIComponent(secret), new URLSearchParams({ s: secret }).toString().slice(2)])
  return [...new Set(forms)].sort((a, b) => b.length - a.length)
}

/**
 * The live address in the only form that may leave a session: redactUrl's, and then every credential
 * typed in the session (in any of its written forms) replaced by SECRET_PLACEHOLDER wherever it
 * sits, whatever the parameter is called.
 */
export function shownAddress(url: string, secrets: readonly string[]): string {
  return addressForms(secrets).reduce((shown, form) => shown.split(form).join(SECRET_PLACEHOLDER), redactUrl(url))
}

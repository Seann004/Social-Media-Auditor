/**
 * The text to save when a notes or findings box loses focus.
 * `typed` is only set once the auditor has typed; an untouched box must save what is stored, not an empty string.
 */
export function textOnBlur(typed: string | undefined, stored: string | undefined): string {
  return typed ?? stored ?? ''
}

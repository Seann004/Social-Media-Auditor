/** Pages the system never tries to get past: captcha, 2-factor, bot check, "suspicious activity". */
import { BLOCK_TEXT_PATTERN, BLOCK_TITLE_PATTERN, CONTENT_WORDS } from './access.js'
import type { AppElement, AppView } from './appTypes.js'
import {
  BLOCK_TITLE_EXTRA,
  CAPTCHA_FRAME,
  CODE_FIELD,
  NOT_A_SECURITY_CODE,
  STRONG_BLOCK,
  SUSPICIOUS,
  TWO_FACTOR,
} from './appSafetyWords.js'
import { normalised } from './appSafetyText.js'

const CODE_INPUT_TYPES = [null, 'text', 'tel', 'number', 'password', 'search']

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

function isCodeInput(element: AppElement): boolean {
  if (element.tag !== 'input' || !CODE_INPUT_TYPES.includes(element.inputType)) return false
  return CODE_FIELD.test(element.name) && !NOT_A_SECURITY_CODE.test(element.name)
}

function softReason(text: string): string | null {
  if (BLOCK_TEXT_PATTERN.test(text)) return 'The page asks to prove the visitor is human.'
  if (TWO_FACTOR.test(text)) return 'The page asks for a 2-factor or login code.'
  if (SUSPICIOUS.test(text)) return 'The page reports suspicious activity or a locked account.'
  return null
}

/** The plain reason a page cannot be used, or null. */
export function detectBlock(view: AppView): string | null {
  if (view.frameUrls.some((frame) => CAPTCHA_FRAME.test(frame))) return 'The page asks for a captcha.'
  const title = normalised(view.title)
  if (BLOCK_TITLE_PATTERN.test(title) || BLOCK_TITLE_EXTRA.test(title)) return 'The page is a bot check or an access block.'
  const text = normalised(view.text)
  if (STRONG_BLOCK.test(text)) return 'The page asks to prove the visitor is human.'
  for (const dialog of view.elements.filter((el) => el.role === 'dialog' || el.role === 'alertdialog')) {
    const reason = softReason(normalised(`${dialog.name} ${dialog.contextText}`))
    if (reason !== null) return reason
  }
  const sparse = wordCount(text) < CONTENT_WORDS || view.elements.some(isCodeInput)
  return sparse ? softReason(text) : null
}

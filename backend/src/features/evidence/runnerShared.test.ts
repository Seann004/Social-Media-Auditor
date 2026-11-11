import { describe, expect, it } from 'vitest'
import { GroqLimitError } from '../../lib/groq.js'
import { isGroqLimit, safeMessage } from './runnerShared.js'

const KEY = 'gsk_live_abc123'

describe('safeMessage', () => {
  it('reads the message of the plain objects the database service throws', () => {
    expect(safeMessage({ message: 'relation does not exist', code: '42P01' }, KEY)).toBe('relation does not exist')
    expect(safeMessage({ code: '42P01' }, KEY)).not.toBe('[object Object]')
  })

  it('takes the key, a key-shaped token and a bearer token out of anything it shows', () => {
    const text = safeMessage(new Error(`Authorization: Bearer ${KEY} failed for key ${KEY} and gsk_other_9Z`), KEY)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('gsk_other_9Z')
    expect(text).not.toMatch(/Bearer\s+gsk/)
    const fromObject = safeMessage({ message: `bad key ${KEY}` }, KEY)
    expect(fromObject).not.toContain(KEY)
  })

  it('never shows a stack', () => {
    expect(safeMessage(new Error('boom'), KEY)).toBe('boom')
  })
})

describe('isGroqLimit', () => {
  it('knows the limit error and the final 429 that came out as a plain error', () => {
    expect(isGroqLimit(new GroqLimitError(7200))).toBe(true)
    expect(isGroqLimit(new Error('Groq request failed with status 429'))).toBe(true)
    expect(isGroqLimit(new Error('Groq request failed with status 500'))).toBe(false)
  })
})

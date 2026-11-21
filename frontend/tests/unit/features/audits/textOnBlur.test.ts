import { describe, expect, it } from 'vitest'
import { textOnBlur } from '../../../../src/features/audits/textOnBlur'

describe('textOnBlur', () => {
  it('keeps the stored text when the box was only clicked in and out of (never typed in)', () => {
    expect(textOnBlur(undefined, 'AI-filled findings')).toBe('AI-filled findings')
  })

  it('uses what the auditor typed, including a deliberate clear', () => {
    expect(textOnBlur('typed', 'stored')).toBe('typed')
    expect(textOnBlur('', 'stored')).toBe('')
  })

  it('is empty when there is nothing typed or stored', () => {
    expect(textOnBlur(undefined, undefined)).toBe('')
  })
})

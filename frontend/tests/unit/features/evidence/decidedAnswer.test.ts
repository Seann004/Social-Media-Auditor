import { describe, expect, it } from 'vitest'
import { pageUpdateAfterDecision } from '../../../../src/features/evidence/decidedAnswer'
import type { AppliedAnswer } from '../../../../src/features/evidence/types'

const img = { url: 'https://files.example/a.jpg', name: 'a.jpg' }
const answer = (over: Partial<AppliedAnswer> = {}): AppliedAnswer => ({ itemId: 'i', status: 'compliant', findings: 'f', evidenceImages: [img], ...over })

describe('pageUpdateAfterDecision', () => {
  it('an accept sets findings and the returned images', () => {
    expect(pageUpdateAfterDecision(answer(), 'accepted')).toEqual({ findings: 'f', images: [img] })
  })

  it('an accept with an empty list sets the empty list', () => {
    expect(pageUpdateAfterDecision(answer({ evidenceImages: [] }), 'accepted')).toEqual({ findings: 'f', images: [] })
  })

  it('null findings leave the findings box alone', () => {
    expect(pageUpdateAfterDecision(answer({ findings: null }), 'accepted').findings).toBeUndefined()
  })

  it('an override with an empty list keeps the photos on the page', () => {
    expect(pageUpdateAfterDecision(answer({ evidenceImages: [] }), 'overridden')).toEqual({ findings: 'f' })
  })

  it('an override that returns photos shows them', () => {
    expect(pageUpdateAfterDecision(answer(), 'overridden').images).toEqual([img])
  })
})

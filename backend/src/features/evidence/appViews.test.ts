import { describe, expect, it } from 'vitest'
import { REPEATED_ACTION } from './appRepeat.js'
import { FINISHED_TOO_EARLY } from './appSteps.js'
import type { AppStep } from './appTypes.js'
import { toAppStepView } from './appViews.js'

function step(over: Partial<AppStep>): AppStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    itemId: 'item-1',
    position: 5,
    accountId: 'acc-1',
    accountLabel: 'Teen 15',
    action: { type: 'finish', observations: '', evidenceSteps: [] },
    line: 'Step 5 · Teen 15 · finished the check',
    outcome: 'done',
    refusalReason: null,
    pageId: null,
    createdAt: '2026-11-11T00:00:00Z',
    ...over,
  }
}

describe('toAppStepView: the early-finish nudge', () => {
  it('marks a new nudge row as a hint and keeps its line', () => {
    const line = `Step 5 · Teen 15 · Asked to look further: finished the check. ${FINISHED_TOO_EARLY}`
    const view = toAppStepView(step({ outcome: 'refused', refusalReason: FINISHED_TOO_EARLY, line }), new Map())
    expect(view).toMatchObject({ outcome: 'refused', hint: true, line })
  })

  it('shows an old row that said "Refused:" as a hint', () => {
    const line = `Step 5 · Teen 15 · Refused: finished the check. ${FINISHED_TOO_EARLY}`
    const view = toAppStepView(step({ outcome: 'refused', refusalReason: FINISHED_TOO_EARLY, line }), new Map())
    expect(view.hint).toBe(true)
    expect(view.line).toBe(`Step 5 · Teen 15 · Asked to look further: finished the check. ${FINISHED_TOO_EARLY}`)
  })

  it('marks a refused repeat as a hint too', () => {
    const line = `Step 5 · Teen 15 · Asked to look further: clicked button "Next". ${REPEATED_ACTION}`
    const view = toAppStepView(step({ outcome: 'refused', refusalReason: REPEATED_ACTION, line }), new Map())
    expect(view).toMatchObject({ outcome: 'refused', hint: true, line })
  })

  it('keeps a real refusal a refusal', () => {
    const line = 'Step 5 · Teen 15 · Refused: clicked button "Follow". Not a test account.'
    const view = toAppStepView(step({ outcome: 'refused', refusalReason: 'Not a test account.', line }), new Map())
    expect(view).toMatchObject({ outcome: 'refused', hint: false, line })
  })

  it('a done step is not a hint', () => {
    expect(toAppStepView(step({}), new Map()).hint).toBe(false)
  })
})

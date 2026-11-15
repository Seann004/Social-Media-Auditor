// Measures the evidence-kind rules against the labelled samples. Never tune a label to the rules:
// when the number drops, improve the rules in evidenceKind.ts.
import { describe, expect, it } from 'vitest'
import { suggestEvidenceKind } from './evidenceKind'
import { HELD_OUT_SAMPLES, ROUND_THREE_SAMPLES, ROUND_TWO_SAMPLES, TUNING_SAMPLES, type KindSample } from './evidenceKind.samples'

const ALL_SAMPLES = [...TUNING_SAMPLES, ...ROUND_TWO_SAMPLES, ...ROUND_THREE_SAMPLES, ...HELD_OUT_SAMPLES]

const REQUIRED_AGREEMENT = 0.8

interface Measure {
  agreement: number
  agreed: number
  total: number
  disagreements: string[]
}

function measure(samples: readonly KindSample[]): Measure {
  const disagreements = samples.flatMap((sample) => {
    const { kind, reason } = suggestEvidenceKind({ text: sample.text })
    const fair = [sample.label, ...(sample.also ?? [])]
    return fair.includes(kind) ? [] : [`"${sample.text}": labelled ${fair.join(' or ')}, rules say ${kind} (${reason})`]
  })
  const total = samples.length
  return { agreement: (total - disagreements.length) / total, agreed: total - disagreements.length, total, disagreements }
}

const describeMeasure = (name: string, m: Measure): string =>
  `${name}: ${m.agreed} of ${m.total} agree (${(m.agreement * 100).toFixed(1)}%)${m.disagreements.length > 0 ? `\n  - ${m.disagreements.join('\n  - ')}` : ''}`

describe('agreement of the evidence-kind rules with labelled items', () => {
  it('has at least 30 labelled items spanning all four kinds, with no item twice', () => {
    expect(ALL_SAMPLES.length).toBeGreaterThanOrEqual(30)
    expect(new Set(ALL_SAMPLES.map((s) => s.label))).toEqual(new Set(['app', 'code', 'both', 'neither']))
    expect(new Set(ALL_SAMPLES.map((s) => s.text)).size).toBe(ALL_SAMPLES.length)
  })

  it(`agrees with at least ${REQUIRED_AGREEMENT * 100}% of the labels`, () => {
    const all = measure(ALL_SAMPLES)
    const report = [
      describeMeasure('All', all),
      describeMeasure('Tuning', measure(TUNING_SAMPLES)),
      describeMeasure('Round two (tuning)', measure(ROUND_TWO_SAMPLES)),
      describeMeasure('Round three (tuning)', measure(ROUND_THREE_SAMPLES)),
      describeMeasure('Held out', measure(HELD_OUT_SAMPLES)),
    ].join('\n')
    console.info(`Evidence-kind agreement\n${report}`)
    expect(all.agreement, report).toBeGreaterThanOrEqual(REQUIRED_AGREEMENT)
  })
})

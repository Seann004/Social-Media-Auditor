// The labelled checklist items, typed. Not imported by app code.
//
// The data lives in evidenceKind.samples.json, the one copy: the backend benchmark
// (npm run benchmark:classify --prefix backend) reads the same file. Its "about" and "groups" say how
// the items were labelled and how each set was used, so the numbers can be read fairly.
import data from './evidenceKind.samples.json'

export type SampleKind = 'app' | 'code' | 'both' | 'neither'
export type SampleGroup = 'tuning' | 'round_two' | 'round_three' | 'held_out'

export interface KindSample {
  group: SampleGroup
  text: string
  label: SampleKind
  /** A second answer that is just as fair for a genuinely mixed item. */
  also?: readonly SampleKind[]
}

export const KIND_SAMPLES: readonly KindSample[] = data.items as KindSample[]

const inGroup = (group: SampleGroup): readonly KindSample[] => KIND_SAMPLES.filter((s) => s.group === group)

export const TUNING_SAMPLES = inGroup('tuning')
export const ROUND_TWO_SAMPLES = inGroup('round_two')
export const ROUND_THREE_SAMPLES = inGroup('round_three')
/** Never used to change any rule. */
export const HELD_OUT_SAMPLES = inGroup('held_out')

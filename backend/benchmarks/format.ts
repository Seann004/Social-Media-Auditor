/** Numbers and counts written the same way in the report, the plan and the console. */

/** 12048 → "12,048". */
export const num = (n: number): string => n.toLocaleString('en-US')

/** (1, "repeat") → "1 repeat"; (12, "repeat") → "12 repeats". */
export const counted = (n: number, word: string): string => `${num(n)} ${word}${n === 1 ? '' : 's'}`

/** 0.756 → "76%"; null → "–". */
export const pct = (x: number | null): string => (x === null ? '–' : `${Math.round(x * 100)}%`)

/** "76% (31 of 41)". */
export const ratioText = (x: number | null, part: number, whole: number): string => `${pct(x)} (${num(part)} of ${num(whole)})`

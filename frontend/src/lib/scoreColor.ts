export interface ScoreColor {
  hex: string
  bar: string
  text: string
}

export const SCORE_PASS: ScoreColor = { hex: '#10b981', bar: 'bg-emerald-500', text: 'text-emerald-600' }
export const SCORE_WARN: ScoreColor = { hex: '#f59e0b', bar: 'bg-amber-500', text: 'text-amber-600' }
export const SCORE_FAIL: ScoreColor = { hex: '#f43f5e', bar: 'bg-rose-500', text: 'text-rose-600' }
export const SCORE_EMPTY: ScoreColor = { hex: '#cbd5e1', bar: 'bg-slate-200', text: 'text-slate-400' }

export function scoreColor(percentage: number): ScoreColor {
  if (percentage >= 80) return SCORE_PASS
  if (percentage >= 60) return SCORE_WARN
  if (percentage > 0) return SCORE_FAIL
  return SCORE_EMPTY
}

export function formatPercent(percentage: number): string {
  return percentage % 1 === 0 ? percentage.toFixed(0) : percentage.toFixed(1)
}

import { PUBLIC_PAGES_ENABLED_IN_BUILD } from '../config'
import type { RunSource } from '../types'

const OPTIONS: { value: RunSource; label: string }[] = [
  { value: 'app', label: 'App (test accounts)' },
  { value: 'pages', label: 'Public pages' },
  { value: 'repo', label: 'Code repository' },
]

interface Props {
  value: RunSource
  onChange(value: RunSource): void
  /** Offer Public pages. Defaults to the switch in config.ts; tests override it. */
  publicPagesEnabled?: boolean
}

/** Where the next run looks for evidence. The choice is per run and is not saved. */
export default function SourceChoice({ value, onChange, publicPagesEnabled = PUBLIC_PAGES_ENABLED_IN_BUILD }: Props) {
  const options = OPTIONS.filter((option) => publicPagesEnabled || option.value !== 'pages')
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-1 text-xs font-medium text-slate-700">Check</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-blue-500 ${
            value === option.value ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          <input
            type="radio"
            name="evidence-source"
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-blue-600"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}

import type { RunSource } from '../types'

const OPTIONS: { value: RunSource; label: string }[] = [
  { value: 'app', label: 'App (test accounts)' },
  { value: 'pages', label: 'Public pages' },
]

interface Props {
  value: RunSource
  onChange(value: RunSource): void
}

/** Where the next run looks for evidence. The choice is per run and is not saved. */
export default function SourceChoice({ value, onChange }: Props) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-1 text-xs font-medium text-slate-700">Check</legend>
      {OPTIONS.map((option) => (
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

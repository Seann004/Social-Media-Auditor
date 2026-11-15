import { useId } from 'react'
import { PUBLIC_PAGES_ENABLED_IN_BUILD } from '../config'
import type { RunSource } from '../types'

const OPTIONS: { value: RunSource; label: string; hint: string }[] = [
  { value: 'app', label: 'App (test accounts)', hint: 'Sign in with test accounts and use the app' },
  { value: 'pages', label: 'Public pages', hint: 'Read the public pages of a website' },
  { value: 'repo', label: 'Code repository', hint: 'Read a public GitHub repository' },
]

interface Props {
  value: RunSource
  onChange(value: RunSource): void
  /** Offer Public pages. Defaults to the switch in config.ts; tests override it. */
  publicPagesEnabled?: boolean
}

/**
 * Where the next run looks for evidence. The choice is per run and is not saved. Each option's
 * name stays its label alone; the one-line hint is its description.
 */
export default function SourceChoice({ value, onChange, publicPagesEnabled = PUBLIC_PAGES_ENABLED_IN_BUILD }: Props) {
  const options = OPTIONS.filter((option) => publicPagesEnabled || option.value !== 'pages')
  const baseId = useId()
  return (
    <fieldset>
      {/* The step heading already says "Source": the legend names the group for screen readers. */}
      <legend className="sr-only">Evidence source</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const selected = value === option.value
          const hintId = `${baseId}-${option.value}`
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-blue-500 ${
                selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="evidence-source"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                aria-describedby={hintId}
                className="mt-1 shrink-0 accent-blue-600"
              />
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${selected ? 'text-blue-700' : 'text-slate-900'}`}>{option.label}</span>
                <span id={hintId} aria-hidden="true" className="mt-0.5 block text-xs text-slate-500">
                  {option.hint}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

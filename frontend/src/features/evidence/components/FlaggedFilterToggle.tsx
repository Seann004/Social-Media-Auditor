import { RobotIcon as Robot } from '@phosphor-icons/react'

interface Props {
  active: boolean
  onToggle: () => void
}

/** Narrows the item list to suggestions the AI marked "Needs human review". Display only. */
export default function FlaggedFilterToggle({ active, onToggle }: Props) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
        active ? 'bg-blue-600 text-white ring-blue-600' : 'bg-blue-50 text-blue-700 ring-blue-100 hover:bg-blue-100',
      ].join(' ')}
    >
      <Robot size={12} weight="fill" aria-hidden="true" /> Flagged by AI only
    </button>
  )
}

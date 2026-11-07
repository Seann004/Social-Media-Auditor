import { groupPickItems } from '../appState'
import type { PickItem } from '../appState'

interface Props {
  items: PickItem[]
  picked: ReadonlySet<string>
  onChange(next: Set<string>): void
  max?: number
}

/** Grouped tickboxes. Once `max` are picked the rest are disabled. */
export default function AppItemPicker({ items, picked, onChange, max = 10 }: Props) {
  const full = picked.size >= max
  const toggle = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-700">Items to check ({picked.size} picked)</p>
      {groupPickItems(items).map((group) => (
        <fieldset key={group.key} className="space-y-1">
          <legend className="text-xs font-semibold text-slate-900">{group.category}</legend>
          {group.items.map((item) => {
            const checked = picked.has(item.id)
            return (
              <label key={item.id} className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={full && !checked}
                  onChange={() => toggle(item.id)}
                  className="mt-0.5 accent-blue-600"
                />
                <span>{item.label}</span>
              </label>
            )
          })}
        </fieldset>
      ))}
      {full ? <p className="text-xs text-slate-500">Up to {max} items per app run.</p> : null}
    </div>
  )
}

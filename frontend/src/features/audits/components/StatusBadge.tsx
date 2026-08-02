import type { ChecklistItemStatus, AuditStatus, SubmissionStatus } from '../../../types'
import { statusColor } from '../../../lib/statusColors'

type Props =
  | { type: 'checklist'; status: ChecklistItemStatus }
  | { type: 'audit'; status: AuditStatus }
  | { type: 'submission'; status: SubmissionStatus }

export default function StatusBadge(props: Props) {
  const cfg =
    props.type === 'checklist'
      ? statusColor('checklist', props.status)
      : props.type === 'audit'
      ? statusColor('audit', props.status)
      : statusColor('submission', props.status)

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-medium ${cfg.badge}`}>
      {cfg.label}
    </span>
  )
}

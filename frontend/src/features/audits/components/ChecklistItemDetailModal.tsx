import { XIcon } from '@phosphor-icons/react'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import type { ChecklistItem } from '../../../types'

export interface ChecklistItemDetailModalProps {
  item: ChecklistItem | null
  tab: 'help' | 'traceability'
  onClose: () => void
  parseLegacyFeature?: boolean
}

function splitLegacyFeature(feature: string | undefined) {
  const text = feature ?? ''
  const idx = text.indexOf('[TRACEABILITY]')
  return {
    help: idx !== -1 ? text.substring(0, idx).trim() : text,
    trace: idx !== -1 ? text.substring(idx + '[TRACEABILITY]'.length).trim() : '',
  }
}

export default function ChecklistItemDetailModal({
  item,
  tab,
  onClose,
  parseLegacyFeature = false,
}: ChecklistItemDetailModalProps) {
  const legacy = parseLegacyFeature ? splitLegacyFeature(item?.feature) : { help: '', trace: '' }
  const helpText = item?.helpText || legacy.help
  const traceText = item?.verbatimClauseText || legacy.trace
  const titleId = 'checklist-item-detail-title'

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      size="md"
      labelledBy={titleId}
      panelClassName="overflow-hidden max-h-[90vh] flex flex-col"
    >
      {item && (
        <>
          <div className="flex items-center justify-between gap-4 px-6 py-4 bg-slate-50 border-b border-slate-100 rounded-t-2xl shrink-0">
            <h3 id={titleId} className="text-base font-bold text-slate-900">
              {tab === 'help' ? 'Help & Audit Guidance' : 'Traceability Details'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <XIcon size={16} weight="bold" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto flex-1 px-6 py-5">
            {tab === 'help' ? (
              <>
                <div>
                  <h4 className="text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">Checklist Question</h4>
                  <p className="text-sm font-semibold text-slate-800 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3.5">
                    {item.text}
                  </p>
                </div>
                <div>
                  <h4 className="text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">Help & Audit Guidance</h4>
                  <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/30 border border-blue-100/50 rounded-xl p-3.5 whitespace-pre-wrap">
                    {helpText || 'No additional audit instructions provided for this item.'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h4 className="text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">Clause Reference</h4>
                  <span className="inline-block font-mono text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
                    {item.reference || 'N/A'}
                  </span>
                </div>
                {traceText ? (
                  <div>
                    <h4 className="text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">Verbatim Clause Text</h4>
                    <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5 whitespace-pre-wrap font-mono">
                      {traceText}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic mt-4">No verbatim clause text available.</p>
                )}
              </>
            )}
          </div>

          <div className="border-t border-slate-100 px-6 py-4 flex justify-end shrink-0">
            <Button variant="neutral" size="xs" onClick={onClose}>
              Dismiss
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

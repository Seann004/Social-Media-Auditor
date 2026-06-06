import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CaretDownIcon as CaretDown,
  UploadSimpleIcon as UploadSimple,
  BookOpenIcon as BookOpen,
  TrashIcon as Trash,
  WarningIcon as Warning,
  XIcon,
} from '@phosphor-icons/react'
import type { ChecklistItem } from '../../../types'
import { useStore } from '../../../store/useStore'
import SeverityBadge from '../../audits/components/SeverityBadge'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}
const cardVar = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

export default function GuidelinesPage() {
  const navigate = useNavigate()
  const { guidelines, checklistItems, users, currentUserId, deleteGuideline } = useStore()
  const activeGuidelines = guidelines.filter((g) => !g.isDeleted && !g.projectId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedItemForModal, setSelectedItemForModal] = useState<ChecklistItem | null>(null)
  const [itemModalTab, setItemModalTab] = useState<'help' | 'traceability'>('help')

  

  const currentUser = users.find((u) => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'admin'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'


  function toggleGuideline(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCat(key: string) {
    setExpandedCat((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleDeleteGuideline(id: string) {
    deleteGuideline(id)
    setConfirmDeleteId(null)
    setExpanded((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        className="flex items-center justify-between mb-7"
      >
        <div>
          {isAdmin ? (
            <>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
                {greeting}, {currentUser?.name?.split(' ')[0]}.
              </h1>
              <p className="text-slate-500 text-base mt-1.5">You have Admin access — manage compliance guidelines below.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Guidelines</h1>
              <p className="text-slate-500 text-base mt-1">
                {activeGuidelines.length} frameworks ·{' '}
                {checklistItems.filter((ci) => activeGuidelines.some((g) => g.id === ci.guidelineId)).length} total checklist items
              </p>
            </>
          )}
        </div>

        {/* Upload button — admin only */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate('/generator')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1"
          >
            <UploadSimple size={14} weight="bold" />
            Upload Guideline
          </button>
        )}
      </motion.div>

      {/* Admin cards */}
      {isAdmin && (
        <motion.div variants={cardVar} className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl mb-7">
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-sm text-slate-500 font-medium mb-2">Guidelines</p>
            <p className="text-3xl font-semibold text-slate-900 tabular-nums">{activeGuidelines.length}</p>
            <p className="text-sm text-slate-400 mt-1">Regulatory frameworks loaded</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-sm text-slate-500 font-medium mb-2">Checklist Items</p>
            <p className="text-3xl font-semibold text-slate-900 tabular-nums">
              {checklistItems.filter((ci) => activeGuidelines.some((g) => g.id === ci.guidelineId)).length}
            </p>
            <p className="text-sm text-slate-400 mt-1">Total across all frameworks</p>
          </div>
        </motion.div>
      )}

      {/* Guidelines list */}
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
        {activeGuidelines.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-sm">No guidelines available. Upload a guideline to get started.</p>
          </div>
        )}
        {activeGuidelines.map((guideline) => {
          const isOpen = expanded.has(guideline.id)
          const items = checklistItems.filter((ci) => ci.guidelineId === guideline.id)
          const criticalCount = items.filter((ci) => ci.severity === 'critical').length
          const isConfirmingDelete = confirmDeleteId === guideline.id

          return (
            <motion.div
              key={guideline.id}
              variants={cardVar}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              {/* Guideline header */}
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleGuideline(guideline.id)}
                  className="flex-1 flex items-center gap-4 px-6 py-5 hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-inset text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                    <BookOpen size={16} className="text-blue-600" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold text-slate-800 break-all">{guideline.name}</p>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                        v{guideline.version}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-[65ch] truncate">
                      {guideline.description}
                    </p>
                  </div>

                  <div className="hidden sm:flex items-center gap-4 shrink-0 text-right">
                    <div>
                      <p className="font-mono text-sm font-semibold text-slate-700 tabular-nums">{items.length}</p>
                      <p className="text-[10px] text-slate-400">items</p>
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold text-rose-600 tabular-nums">{criticalCount}</p>
                      <p className="text-[10px] text-slate-400">critical</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">{guideline.categories.length} categories</p>
                      <p className="text-[10px] text-slate-400">{guideline.source}</p>
                    </div>
                  </div>

                  <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                    className="shrink-0"
                  >
                    <CaretDown size={15} className="text-slate-400" />
                  </motion.div>
                </button>

                {/* Admin delete button */}
                {isAdmin && (
                  <div className="px-4 border-l border-slate-100 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(guideline.id)}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Delete guideline"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                )}
              </div>

              {/* Delete confirmation */}
              <AnimatePresence>
                {isConfirmingDelete && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mx-6 mb-4 flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
                      <p className="text-xs text-rose-700 flex-1">
                        Permanently delete <strong>{guideline.name}</strong> and all its checklist items? This cannot be undone.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDeleteGuideline(guideline.id)}
                        className="px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-lg hover:bg-rose-700 transition-colors shrink-0"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Expanded content */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 28 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-slate-100 px-5 py-4">
                      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                        {guideline.description} Source:{' '}
                        <span className="text-slate-600 font-medium">{guideline.source}</span>
                        {guideline.lastUpdated && <>{' ·'} Last updated: <span className="font-mono text-slate-600">{guideline.lastUpdated}</span></>}
                      </p>

                      <div className="space-y-6">
                        {Object.entries(
                          guideline.categories.reduce<Record<string, string[]>>((acc, cat) => {
                            const section = cat.split(' > ')[0]
                            if (!acc[section]) acc[section] = []
                            acc[section].push(cat)
                            return acc
                          }, {})
                        ).map(([section, cats]) => (
                          <div key={section} className="space-y-2">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-4 mb-2 px-1">
                              {section}
                            </h4>
                            <div className="space-y-2 pl-3 border-l border-slate-100">
                              {cats.map((cat) => {
                                const catItems = items.filter((ci) => ci.category === cat)
                                const catKey = `${guideline.id}_${cat}`
                                const catOpen = expandedCat.has(catKey)
                                const displayName = cat.includes(' > ') ? cat.split(' > ').slice(1).join(' → ') : cat

                                return (
                                  <div key={cat} className="border border-slate-100 rounded-lg overflow-hidden bg-white">
                                    <button
                                      type="button"
                                      onClick={() => toggleCat(catKey)}
                                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-inset"
                                    >
                                      <p className="flex-1 text-xs font-semibold text-slate-700">{displayName}</p>
                                      <div className="flex items-center gap-3">
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          {catItems.length} item{catItems.length !== 1 ? 's' : ''}
                                        </span>
                                        <span className="text-[10px] text-rose-500 font-mono">
                                          {catItems.filter((ci) => ci.severity === 'critical').length} crit
                                        </span>
                                        <motion.div
                                          animate={{ rotate: catOpen ? 180 : 0 }}
                                          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                                        >
                                          <CaretDown size={12} className="text-slate-400" />
                                        </motion.div>
                                      </div>
                                    </button>

                                    <AnimatePresence>
                                      {catOpen && (
                                        <motion.div
                                          initial={{ height: 0 }}
                                          animate={{ height: 'auto' }}
                                          exit={{ height: 0 }}
                                          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
                                          className="overflow-hidden"
                                        >
                                          <div className="divide-y divide-slate-50 border-t border-slate-100">
                                            {catItems.map((ci) => (
                                              <div key={ci.id} className="flex items-start gap-3 px-4 py-3 bg-slate-50/50">
                                                <SeverityBadge severity={ci.severity} />
                                                <p className="flex-1 text-xs text-slate-700 leading-relaxed">{ci.text}</p>
                                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => { setSelectedItemForModal(ci); setItemModalTab('help'); }}
                                                    className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 font-medium px-2 py-0.5 rounded transition-colors cursor-pointer font-semibold"
                                                  >
                                                    Help
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => { setSelectedItemForModal(ci); setItemModalTab('traceability'); }}
                                                    className="text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 border border-slate-200/60 font-mono px-2 py-0.5 rounded transition-colors cursor-pointer shadow-sm"
                                                  >
                                                    {ci.reference || 'N/A'}
                                                  </button>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </motion.div>

      {/* Reference & Help Text Modal */}
      <AnimatePresence>
        {selectedItemForModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForModal(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="flex flex-col border-b border-slate-100 mb-4 bg-slate-50">
                <div className="flex items-center justify-between p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    {itemModalTab === 'help' ? 'Help & Audit Guidance' : 'Traceability Details'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemForModal(null)
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <XIcon size={16} weight="bold" />
                  </button>
                </div>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1 px-4 pb-4">
                {itemModalTab === 'help' ? (
                  <>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">CHECKLIST QUESTION</h4>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3.5">
                        {selectedItemForModal!.text}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">SEVERITY</h4>
                      <SeverityBadge severity={selectedItemForModal!.severity} />
                    </div>

                    {(() => {
                      const featureText = selectedItemForModal!.feature || '';
                      const splitIdx = featureText.indexOf('[TRACEABILITY]');
                      let helpText = splitIdx !== -1 ? featureText.substring(0, splitIdx).trim() : featureText;
                      return (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">HELP & AUDIT GUIDANCE</h4>
                          <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/30 border border-blue-100/50 rounded-xl p-3.5 whitespace-pre-wrap">
                            {helpText || 'No additional audit instructions provided for this item.'}
                          </p>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">CLAUSE REFERENCE</h4>
                      <span className="inline-block font-mono text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded">
                        {selectedItemForModal!.reference || 'N/A'}
                      </span>
                    </div>

                    {(() => {
                      const featureText = selectedItemForModal!.feature || '';
                      const splitIdx = featureText.indexOf('[TRACEABILITY]');
                      let traceText = splitIdx !== -1 ? featureText.substring(splitIdx + '[TRACEABILITY]'.length).trim() : '';
                      return traceText ? (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">TRACEABILITY MAPPING</h4>
                          <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5 whitespace-pre-wrap font-mono">
                            {traceText}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic mt-4">No traceability mapping available.</p>
                      );
                    })()}
                  </>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedItemForModal(null)}
                  className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

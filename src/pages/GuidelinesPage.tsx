import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CaretDownIcon as CaretDown,
  UploadSimpleIcon as UploadSimple,
  BookOpenIcon as BookOpen,
  TrashIcon as Trash,
  WarningIcon as Warning,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import SeverityBadge from '../components/ui/SeverityBadge'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}
const cardVar = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

export default function GuidelinesPage() {
  const { guidelines, checklistItems, users, currentUserId, deleteGuideline } = useStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentUser = users.find((u) => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'admin'

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

  function handleUploadClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    if (!isExcel) {
      alert('Only .xlsx or .xls files are supported.')
      return
    }
    setUploadSuccess(true)
    setTimeout(() => setUploadSuccess(false), 3000)
    if (fileInputRef.current) fileInputRef.current.value = ''
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
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Guidelines</h1>
          <p className="text-slate-500 text-base mt-1">
            {guidelines.length} frameworks ·{' '}
            {guidelines.reduce((s, g) => s + g.itemCount, 0)} total checklist items
          </p>
        </div>

        {/* Upload button — admin only */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            {uploadSuccess && (
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                Guideline uploaded successfully
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="sr-only"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={handleUploadClick}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1"
            >
              <UploadSimple size={14} weight="bold" />
              Upload Guideline
            </button>
          </div>
        )}
      </motion.div>

      {/* Admin notice */}
      {isAdmin && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 mb-5 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700"
        >
          <Warning size={14} />
          You are managing guidelines as Admin. Upload .xlsx/.xls files or delete existing guidelines.
        </motion.div>
      )}

      {/* Guidelines list */}
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
        {guidelines.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-slate-400 text-sm">No guidelines available. Upload a guideline to get started.</p>
          </div>
        )}
        {guidelines.map((guideline) => {
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
                      <p className="text-base font-semibold text-slate-800">{guideline.name}</p>
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
                      <p className="font-mono text-sm font-semibold text-slate-700 tabular-nums">{guideline.itemCount}</p>
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

                      <div className="space-y-2">
                        {guideline.categories.map((cat) => {
                          const catItems = items.filter((ci) => ci.category === cat)
                          const catKey = `${guideline.id}_${cat}`
                          const catOpen = expandedCat.has(catKey)

                          return (
                            <div key={cat} className="border border-slate-100 rounded-lg overflow-hidden">
                              <button
                                type="button"
                                onClick={() => toggleCat(catKey)}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-inset"
                              >
                                <p className="flex-1 text-xs font-semibold text-slate-700">{cat}</p>
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
                                          {ci.reference && (
                                            <span className="text-[10px] text-slate-400 font-mono shrink-0">{ci.reference}</span>
                                          )}
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
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}

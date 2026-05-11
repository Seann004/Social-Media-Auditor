import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeftIcon as ArrowLeft,
  CheckCircleIcon as CheckCircle,
  XCircleIcon as XCircle,
  MinusCircleIcon as MinusCircle,
  NotePencilIcon as NotePencil,
  CaretRightIcon as CaretRight,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import type { ChecklistItemStatus } from '../types'
import SeverityBadge from '../components/ui/SeverityBadge'
import StatusBadge from '../components/ui/StatusBadge'
import AuditorAvatar from '../components/ui/AuditorAvatar'
import ScoreRing from '../components/ui/ScoreRing'

const RESPONSE_OPTIONS: { value: ChecklistItemStatus; label: string; icon: typeof CheckCircle; active: string; inactive: string }[] = [
  {
    value: 'compliant',
    label: 'Pass',
    icon: CheckCircle,
    active: 'bg-emerald-600 text-white ring-emerald-600',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-emerald-300 hover:text-emerald-600',
  },
  {
    value: 'non_compliant',
    label: 'Fail',
    icon: XCircle,
    active: 'bg-rose-600 text-white ring-rose-600',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-rose-300 hover:text-rose-600',
  },
  {
    value: 'not_applicable',
    label: 'N/A',
    icon: MinusCircle,
    active: 'bg-slate-500 text-white ring-slate-500',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-400 hover:text-slate-600',
  },
]

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
}
const rowVar = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 22 } },
}

export default function AuditPage() {
  const { id } = useParams<{ id: string }>()
  const { projects, guidelines, checklistItems, users, responses, setResponse, getProjectScore, getCategoryScore } = useStore()

  const project = projects.find((p) => p.id === id)
  const score = getProjectScore(id ?? '')

  const projectGuidelines = useMemo(
    () => guidelines.filter((g) => project?.guidelineIds.includes(g.id)),
    [guidelines, project],
  )

  const projectItems = useMemo(
    () => checklistItems.filter((ci) => project?.guidelineIds.includes(ci.guidelineId)),
    [checklistItems, project],
  )

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of projectItems) {
      if (!seen.has(item.category)) {
        seen.add(item.category)
        result.push(item.category)
      }
    }
    return result
  }, [projectItems])

  const [selectedCategory, setSelectedCategory] = useState<string>(() => categories[0] ?? '')
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <div className="text-center">
          <p className="text-slate-500 text-sm font-medium">Audit project not found.</p>
          <Link to="/projects" className="text-blue-600 text-sm mt-1 inline-block hover:text-blue-700">
            Back to projects
          </Link>
        </div>
      </div>
    )
  }

  const headAuditor = users.find((u) => u.id === project.headAuditorId)
  const auditors = project.auditorIds.map((uid) => users.find((u) => u.id === uid)).filter(Boolean) as typeof users

  const categoryItems = projectItems.filter((ci) => ci.category === selectedCategory)

  function getResponse(itemId: string) {
    return responses[`${id}__${itemId}`]
  }

  function handleResponseClick(itemId: string, status: ChecklistItemStatus) {
    const current = getResponse(itemId)
    const notes = noteValues[itemId] ?? current?.notes ?? ''
    setResponse(id!, itemId, status, notes)
  }

  function toggleNotes(itemId: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function handleNotesBlur(itemId: string) {
    const current = getResponse(itemId)
    const notes = noteValues[itemId] ?? ''
    if (current && current.status !== 'not_started') {
      setResponse(id!, itemId, current.status, notes)
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Top header */}
      <div className="border-b border-slate-200 bg-white px-6 md:px-8 pt-4 pb-4">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-3 group"
        >
          <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Audits
        </Link>

        {/* Title + badges */}
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
            {project.platform}
          </h1>
          {projectGuidelines.map((g) => (
            <span
              key={g.id}
              className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-[6px] font-medium"
            >
              {g.shortName}
            </span>
          ))}
          <StatusBadge type="audit" status={project.status} />
        </div>

        {project.notes && (
          <p className="text-xs text-slate-400 mb-3 max-w-xl leading-relaxed">
            {project.notes}
          </p>
        )}

        {/* Metrics strip — compact, left-aligned */}
        <div className="flex items-center gap-5 mt-3 flex-wrap">
          {/* Score ring (smaller) */}
          <div className="flex items-center gap-2">
            <ScoreRing percentage={score.percentage} size={44} strokeWidth={4} showLabel={false} />
            <div>
              <p className="font-mono text-sm font-semibold text-slate-800 tabular-nums leading-none">
                {score.percentage.toFixed(1)}%
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Compliance</p>
            </div>
          </div>

          <div className="w-px h-8 bg-slate-200 hidden sm:block" />

          {/* Stats */}
          {[
            { value: score.answered, label: 'Answered', color: 'text-slate-700' },
            { value: score.compliant, label: 'Passing', color: 'text-emerald-600' },
            { value: score.nonCompliant, label: 'Failing', color: 'text-rose-500' },
          ].map(({ value, label, color }) => (
            <div key={label} className="text-center hidden sm:block">
              <p className={`font-mono text-sm font-semibold tabular-nums leading-none ${color}`}>
                {value}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
            </div>
          ))}

          <div className="w-px h-8 bg-slate-200 hidden md:block" />

          {/* Auditors */}
          {auditors.length > 0 && (
            <div className="hidden md:flex items-center gap-2">
              <div className="flex items-center gap-1">
                {auditors.map((u) => (
                  <AuditorAvatar key={u.id} user={u} size="sm" />
                ))}
              </div>
              {headAuditor && (
                <p className="text-[11px] text-slate-400">
                  Lead: {headAuditor.name.split(' ')[0]}
                </p>
              )}
            </div>
          )}

          {/* Progress pill — far right within the strip */}
          <div className="ml-auto hidden sm:flex items-center gap-2">
            <div className="relative h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-blue-500 rounded-full origin-left"
                style={{
                  transform: `scaleX(${score.progress / 100})`,
                  transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)',
                }}
              />
            </div>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums whitespace-nowrap">
              {score.answered}/{score.total} items
            </p>
          </div>
        </div>
      </div>

      {/* Body: category nav + checklist */}
      <div className="flex flex-1 min-h-0">
        {/* Left: categories */}
        <nav className="w-64 shrink-0 border-r border-slate-200 bg-slate-50/50 overflow-y-auto py-5 px-3">
          <p className="text-xs text-slate-400 font-mono tracking-widest uppercase px-2 mb-3">
            Categories
          </p>
          <ul className="space-y-0.5 list-none m-0 p-0">
            {categories.map((cat) => {
              const catScore = getCategoryScore(id!, cat)
              const active = cat === selectedCategory
              const barColor =
                catScore.percentage >= 80
                  ? 'bg-emerald-500'
                  : catScore.percentage >= 60
                  ? 'bg-amber-400'
                  : catScore.percentage > 0
                  ? 'bg-rose-400'
                  : 'bg-slate-300'

              return (
                <li key={cat}>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={[
                      'w-full text-left px-3 py-3 rounded-[8px] transition-colors focus-visible:outline-2 focus-visible:outline-blue-400',
                      active ? 'bg-white shadow-sm border border-slate-200' : 'hover:bg-white/70',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-sm font-medium leading-tight ${active ? 'text-slate-800' : 'text-slate-600'}`}
                      >
                        {cat}
                      </span>
                      {active && <CaretRight size={11} className="text-slate-400 shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="relative h-1 flex-1 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full origin-left ${barColor}`}
                          style={{
                            transform: `scaleX(${Math.min(catScore.percentage, 100) / 100})`,
                            transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)',
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 tabular-nums w-8 text-right shrink-0">
                        {catScore.applicable > 0 ? `${catScore.percentage.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {catScore.answered}/{catScore.total}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Right: checklist items */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedCategory}
              variants={container}
              initial="hidden"
              animate="show"
              className="px-8 py-8 max-w-4xl"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-slate-800 tracking-tight">
                  {selectedCategory}
                </h2>
                <p className="text-sm text-slate-400 font-mono">
                  {categoryItems.length} item{categoryItems.length !== 1 ? 's' : ''}
                </p>
              </div>

              {categoryItems.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-slate-400 text-sm">No checklist items in this category.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-[14px] bg-white overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.05)]">
                  {categoryItems.map((ci) => {
                    const resp = getResponse(ci.id)
                    const currentStatus = resp?.status ?? 'not_started'
                    const notesOpen = expandedNotes.has(ci.id)
                    const currentNotes = noteValues[ci.id] ?? resp?.notes ?? ''

                    return (
                      <motion.div key={ci.id} variants={rowVar} className="px-6 py-5">
                        {/* Item header */}
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <SeverityBadge severity={ci.severity} />
                              {ci.reference && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {ci.reference}
                                </span>
                              )}
                            </div>
                            <p className="text-base text-slate-800 leading-relaxed">{ci.text}</p>
                          </div>
                        </div>

                        {/* Response controls */}
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          {RESPONSE_OPTIONS.map(({ value, label, icon: Icon, active, inactive }) => {
                            const isActive = currentStatus === value
                            return (
                              <motion.button
                                key={value}
                                type="button"
                                onClick={() => handleResponseClick(ci.id, value)}
                                whileTap={{ scale: 0.97 }}
                                className={[
                                  'flex items-center gap-2 px-4 py-2 rounded-[8px] text-sm font-medium ring-1 transition-all',
                                  'focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1',
                                  isActive ? active : inactive,
                                ].join(' ')}
                              >
                                <Icon size={15} weight={isActive ? 'fill' : 'regular'} />
                                {label}
                              </motion.button>
                            )
                          })}

                          {/* Notes toggle */}
                          <button
                            type="button"
                            onClick={() => toggleNotes(ci.id)}
                            className={[
                              'flex items-center gap-2 px-3 py-2 rounded-[8px] text-sm font-medium ring-1 transition-colors ml-auto',
                              'focus-visible:outline-2 focus-visible:outline-blue-400',
                              notesOpen || currentNotes
                                ? 'ring-blue-200 text-blue-600 bg-blue-50'
                                : 'ring-slate-200 text-slate-400 hover:text-slate-600 bg-white',
                            ].join(' ')}
                          >
                            <NotePencil size={12} weight={currentNotes ? 'fill' : 'regular'} />
                            {currentNotes ? 'Notes' : 'Add note'}
                          </button>
                        </div>

                        {/* Inline notes */}
                        <AnimatePresence>
                          {notesOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ type: 'spring', stiffness: 200, damping: 28 }}
                              className="overflow-hidden"
                            >
                              <textarea
                                value={currentNotes}
                                onChange={(e) =>
                                  setNoteValues((prev) => ({ ...prev, [ci.id]: e.target.value }))
                                }
                                onBlur={() => handleNotesBlur(ci.id)}
                                placeholder="Record observations, evidence references, or remediation notes…"
                                rows={3}
                                className="mt-3 w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-[8px] px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed"
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Show saved notes if not in edit mode */}
                        {!notesOpen && currentNotes && (
                          <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-[6px] px-3 py-2 border border-slate-100 leading-relaxed max-w-[65ch]">
                            {currentNotes}
                          </p>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
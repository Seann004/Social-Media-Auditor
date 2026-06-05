import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRightIcon as ArrowRight,
  PlusIcon as Plus,
  FolderOpenIcon as FolderOpen,
  LockIcon as Lock,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import type { AuditStatus } from '../../../types'
import StatusBadge from '../../audits/components/StatusBadge'
import AuditorAvatar from '../../../components/ui/AuditorAvatar'

type Filter = 'all' | AuditStatus

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'draft', label: 'Draft' },
]

const PLATFORM_COLOR: Record<string, string> = {
  TikTok: 'bg-slate-800',
  Instagram: 'bg-pink-500',
  Facebook: 'bg-blue-600',
  Snapchat: 'bg-yellow-400',
  YouTube: 'bg-red-600',
  Discord: 'bg-indigo-500',
  BeReal: 'bg-slate-700',
  'X (Twitter)': 'bg-slate-900',
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
}
const rowVar = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 22 } },
}

function ScoreBar({ pct }: { pct: number }) {
  const color =
    pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : pct > 0 ? 'bg-rose-400' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-28 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full origin-left ${color}`}
          style={{
            transform: `scaleX(${Math.min(pct, 100) / 100})`,
            transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      </div>
      <span className="font-mono text-xs text-slate-500 tabular-nums w-12 text-right">
        {pct > 0 ? `${pct.toFixed(1)}%` : '—'}
      </span>
    </div>
  )
}

export default function ProjectsPage() {
  const { projects, users, guidelines, getProjectScore, currentUserId, initFromDb, loading } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const currentUser = users.find((u) => u.id === currentUserId)
  const isHeadAuditor = currentUser?.role === 'head_auditor'
  const location = useLocation()

  // Re-fetch from DB on every navigation to this page so the list stays current
  useEffect(() => { initFromDb() }, [location.key])

  if (currentUser?.role === 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Lock size={20} className="text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Access Restricted</h2>
        <p className="text-slate-500 text-sm max-w-xs">Admins manage guidelines only and do not have access to audit projects.</p>
      </div>
    )
  }

  const isAuditor = currentUser?.role === 'auditor'

  // Auditors only see projects that are ready for or past auditing (no draft)
  const visibleProjects = isAuditor
    ? projects.filter((p) => p.status !== 'draft')
    : projects

  const filtered = visibleProjects.filter((p) => filter === 'all' || p.status === filter)
  const sorted = [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  // Auditors don't see the Draft filter tab
  const visibleFilters = isAuditor
    ? FILTERS.filter((f) => f.value !== 'draft')
    : FILTERS

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
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Audit Projects</h1>
          <p className="text-slate-500 text-base mt-1">
            {visibleProjects.length} total · {visibleProjects.filter((p) => p.status === 'in_progress').length}{' '}
            active
          </p>
        </div>
        {isHeadAuditor && (
          <Link
            to="/projects/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1"
          >
            <Plus size={14} weight="bold" />
            New Audit
          </Link>
        )}
      </motion.div>

      {/* Filter tabs */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-1 mb-5 border-b border-slate-200 pb-0"
      >
        {visibleFilters.map(({ value, label }) => {
          const count = value === 'all' ? visibleProjects.length : visibleProjects.filter((p) => p.status === value).length
          const active = filter === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={[
                'px-3 py-2 text-sm font-medium rounded-t-[8px] border-b-2 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500',
                active
                  ? 'text-blue-700 border-blue-600 bg-blue-50/50'
                  : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              {label}
              <span
                className={`ml-1.5 text-[10px] px-1 py-0.5 rounded font-mono ${
                  active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </motion.div>

      {/* Project list */}
      <AnimatePresence mode="wait">
        {sorted.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <FolderOpen size={36} className="text-slate-300 mb-3" />
            <p className="text-slate-500 text-sm font-medium">No audits match this filter.</p>
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="text-blue-600 text-sm mt-1 hover:text-blue-700 transition-colors"
            >
              Clear filter
            </button>
          </motion.div>
        ) : (
          <motion.div
            key={filter}
            variants={container}
            initial="hidden"
            animate="show"
            className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden"
          >
            {sorted.map((project) => {
              const score = getProjectScore(project.id)
              const guidelineNames = project.guidelineIds
                .map((gid) => guidelines.find((g) => g.id === gid)?.shortName)
                .filter(Boolean) as string[]
              const auditors = project.auditorIds
                .map((uid) => users.find((u) => u.id === uid))
                .filter(Boolean) as typeof users
              const headAuditor = users.find((u) => u.id === project.headAuditorId)

              return (
                <motion.div key={project.id} variants={rowVar}>
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-5 px-6 py-5 hover:bg-slate-50 transition-colors group"
                  >
                    {/* Platform icon */}
                    <div
                      className={`w-9 h-9 rounded-lg ${PLATFORM_COLOR[project.platform] ?? 'bg-slate-700'} flex items-center justify-center shrink-0`}
                    >
                      <span className="text-white text-[10px] font-bold">
                        {project.platform.slice(0, 2).toUpperCase()}
                      </span>
                    </div>

                    {/* Project name + platform + guidelines */}
                    <div className="w-52 shrink-0">
                      <p className="text-base font-semibold text-slate-800 leading-tight">{project.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium">
                          {project.platform}
                        </span>
                        {guidelineNames.map((name) => (
                          <span
                            key={name}
                            className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Compliance */}
                    <div className="flex-1 min-w-0 hidden sm:block">
                      <p className="text-xs text-slate-400 mb-1">Compliance</p>
                      <ScoreBar pct={score.percentage} />
                    </div>

                    {/* Progress */}
                    <div className="hidden md:block w-28 shrink-0">
                      <p className="text-xs text-slate-400 mb-0.5">Progress</p>
                      <p className="text-xs text-slate-700 font-mono tabular-nums">
                        {score.answered}/{score.total} items
                      </p>
                    </div>

                    {/* Auditors */}
                    <div className="hidden lg:flex items-center gap-1 w-20 shrink-0">
                      {headAuditor && <AuditorAvatar user={headAuditor} size="sm" />}
                      {auditors
                        .filter((u) => u.id !== project.headAuditorId)
                        .slice(0, 2)
                        .map((u) => (
                          <AuditorAvatar key={u.id} user={u} size="sm" />
                        ))}
                    </div>

                    {/* Due date */}
                    <div className="hidden md:block w-20 shrink-0 text-right">
                      {project.dueDate ? (
                        <>
                          <p className="text-[11px] text-slate-400">Due</p>
                          <p className="text-xs text-slate-600 font-medium">
                            {new Date(project.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-slate-300">—</p>
                      )}
                    </div>

                    {/* Status + arrow */}
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge type="audit" status={project.status} />
                      <ArrowRight
                        size={14}
                        className="text-slate-300 group-hover:text-slate-500 transition-colors"
                      />
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
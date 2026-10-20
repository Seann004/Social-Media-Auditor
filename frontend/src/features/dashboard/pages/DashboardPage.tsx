import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRightIcon as ArrowRight } from '@phosphor-icons/react'
import GuidelinesPage from '../../guidelines/pages/GuidelinesPage'
import { useStore } from '../../../store/useStore'
import StatusBadge from '../../audits/components/StatusBadge'
import AuditorAvatar from '../../../components/ui/AuditorAvatar'
import { buttonClasses } from '../../../components/ui/Button'
import { platformColor, platformInitial } from '../../../lib/platformColors'
import { scoreColor, formatPercent } from '../../../lib/scoreColor'
import { AUDIT_STATUS_COLOR } from '../../../lib/statusColors'

function DonutChart({ segments, size = 72, stroke = 9, center }: {
  segments: { value: number; color: string }[]
  size?: number; stroke?: number; center?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const cx = size / 2
  const circ = 2 * Math.PI * r
  const total = segments.reduce((s, g) => s + g.value, 0)
  let offset = 0
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        {segments.filter((s) => s.value > 0).map((seg, i) => {
          const len = total > 0 ? (seg.value / total) * circ : 0
          const el = (
            <circle key={i} cx={cx} cy={cx} r={r} fill="none"
              stroke={seg.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset} strokeLinecap="round" />
          )
          offset += len
          return el
        })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex items-center justify-center">{center}</div>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-10 animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-7 w-64 rounded-lg bg-slate-200" />
        <div className="h-4 w-44 rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {[0, 1].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl px-5 py-5 flex items-center gap-4">
            <div className="w-[72px] h-[72px] rounded-full bg-slate-100 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-28 rounded bg-slate-200" />
              <div className="h-2.5 w-20 rounded bg-slate-100" />
              <div className="h-2.5 w-24 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-5">
              <div className="w-8 h-8 rounded-lg bg-slate-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/5 rounded bg-slate-200" />
                <div className="h-2.5 w-1/4 rounded bg-slate-100" />
              </div>
              <div className="h-5 w-20 rounded-md bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl h-48" />
      </div>
    </div>
  )
}


const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

function ScoreBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative h-1 w-20 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 rounded-full origin-left ${color}`}
        style={{
          transform: `scaleX(${Math.min(pct, 100) / 100})`,
          transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)',
        }}
      />
    </div>
  )
}

export default function DashboardPage() {
  const { projects, users, currentUserId, guidelines, complianceMap, initFromDb, loading, dbError } = useStore()
  const currentUser = users.find((u) => u.id === currentUserId)
  const location = useLocation()

  useEffect(() => { initFromDb() }, [location.key])

  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const tick = () => setHour(new Date().getHours())
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const isHeadAuditor = currentUser?.role === 'head_auditor'
  const isAdmin = currentUser?.role === 'admin'
  const isAuditor = currentUser?.role === 'auditor'

  const visibleProjects = isAuditor ? projects.filter((p) => p.status !== 'draft') : projects
  const recentProjects = [...visibleProjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const activeProjects = visibleProjects.filter((p) => p.status === 'in_progress')
  const completedProjects = visibleProjects.filter((p) => p.status === 'completed')

  const statusCounts = {
    draft: visibleProjects.filter((p) => p.status === 'draft').length,
    in_progress: activeProjects.length,
    under_review: visibleProjects.filter((p) => p.status === 'under_review').length,
    completed: completedProjects.length,
  }

  const upcomingDeadlines = visibleProjects
    .filter((p) => p.status === 'in_progress' && p.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 3)
  const auditTeam = users.filter((u) => u.role !== 'admin')

  // Compare due dates against the user's local calendar day (not UTC).
  const now = new Date()
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const overdueCount = visibleProjects.filter(
    (p) => p.dueDate && p.dueDate.slice(0, 10) < todayLocal && p.status !== 'completed',
  ).length
  const awaitingReviewCount = statusCounts.under_review

  if (isAdmin) {
    return <GuidelinesPage />
  }

  if (loading && visibleProjects.length === 0) {
    return <DashboardSkeleton />
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-10"
    >
      <motion.div variants={item} className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {greeting}{currentUser ? `, ${currentUser.name.split(' ')[0]}` : ''}.
          </h1>
          <p className="text-slate-500 text-base mt-1.5 leading-relaxed">
            {activeProjects.length} audit{activeProjects.length !== 1 ? 's' : ''} in progress
            {completedProjects.length > 0 && `, ${completedProjects.length} completed`}.
          </p>
        </div>
        {isHeadAuditor && (
          <Link to="/projects/new" className={buttonClasses('primary', 'md', 'hidden md:inline-flex')}>
            New Audit
            <ArrowRight size={14} weight="bold" />
          </Link>
        )}
      </motion.div>

      {dbError && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>Couldn't load your audits: {dbError}</span>
          <button
            type="button"
            onClick={() => initFromDb()}
            className="shrink-0 text-xs font-semibold text-rose-700 hover:text-rose-800 underline rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          >
            Retry
          </button>
        </div>
      )}

      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">

        <div className="bg-white border border-slate-200 rounded-xl px-5 py-5 flex items-center gap-4">
          <DonutChart
            size={72} stroke={9}
            segments={[
              { value: statusCounts.draft, color: AUDIT_STATUS_COLOR.draft.hex },
              { value: statusCounts.in_progress, color: AUDIT_STATUS_COLOR.in_progress.hex },
              { value: statusCounts.under_review, color: AUDIT_STATUS_COLOR.under_review.hex },
              { value: statusCounts.completed, color: AUDIT_STATUS_COLOR.completed.hex },
            ]}
            center={
              <span className="text-base font-bold text-slate-800">{visibleProjects.length}</span>
            }
          />
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Total Audits</p>
            <div className="space-y-0.5">
              {!isAuditor && statusCounts.draft > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${AUDIT_STATUS_COLOR.draft.dot}`} />
                  {statusCounts.draft} draft
                </p>
              )}
              {statusCounts.in_progress > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${AUDIT_STATUS_COLOR.in_progress.dot}`} />
                  {statusCounts.in_progress} active
                </p>
              )}
              {statusCounts.under_review > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${AUDIT_STATUS_COLOR.under_review.dot}`} />
                  {statusCounts.under_review} in review
                </p>
              )}
              {statusCounts.completed > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${AUDIT_STATUS_COLOR.completed.dot}`} />
                  {statusCounts.completed} done
                </p>
              )}
              {visibleProjects.length === 0 && (
                <p className="text-xs text-slate-300">No audits yet</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl px-5 py-5 flex items-center gap-4">
          <DonutChart
            size={72} stroke={9}
            segments={[
              { value: activeProjects.length, color: AUDIT_STATUS_COLOR.in_progress.hex },
              { value: Math.max(visibleProjects.length - activeProjects.length, 0), color: '#e2e8f0' },
            ]}
            center={
              <span className="text-base font-bold text-blue-600">{activeProjects.length}</span>
            }
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-600 mb-1">In Progress</p>
            <p className="text-xs text-slate-400">
              {visibleProjects.length > 0
                ? `${Math.round((activeProjects.length / visibleProjects.length) * 100)}% of total`
                : 'No audits yet'}
            </p>
            <div className="flex items-center gap-4 mt-2.5">
              <Link
                to="/projects"
                className="group/stat rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <p className={`font-mono text-base font-semibold tabular-nums leading-none ${awaitingReviewCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {awaitingReviewCount}
                </p>
                <p className="text-2xs text-slate-400 mt-1 group-hover/stat:text-slate-600 transition-colors">
                  {isHeadAuditor ? 'Awaiting my review' : 'Awaiting review'}
                </p>
              </Link>
              <span className="w-px h-8 bg-slate-100" />
              <Link
                to="/projects"
                className="group/stat rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <p className={`font-mono text-base font-semibold tabular-nums leading-none ${overdueCount > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {overdueCount}
                </p>
                <p className="text-2xs text-slate-400 mt-1 group-hover/stat:text-slate-600 transition-colors">Overdue</p>
              </Link>
            </div>
          </div>
        </div>

      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div variants={item} className="md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800 tracking-tight">Recent Audits</h2>
            <Link
              to="/projects"
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight size={11} />
            </Link>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden shadow-none">
            {recentProjects.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-slate-400 text-sm">No audits yet.</p>
                {isHeadAuditor && (
                  <Link to="/projects/new" className="text-blue-600 text-sm font-medium mt-1 inline-block hover:text-blue-700">
                    Create your first audit
                  </Link>
                )}
              </div>
            ) : (
              recentProjects.map((project) => {
                const scorePct = complianceMap[project.id] ?? 0
                const projGuidelines = project.guidelineIds
                  .map((gid) => guidelines.find((g) => g.id === gid))
                  .filter(Boolean) as typeof guidelines
                const auditors = project.auditorIds
                  .map((uid) => users.find((u) => u.id === uid))
                  .filter(Boolean) as typeof users
                const barColor = scoreColor(scorePct).bar

                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-4 px-5 py-5 hover:bg-slate-50 transition-colors group focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg ${platformColor(project.platform)} flex items-center justify-center shrink-0`}
                    >
                      <span className="text-white text-2xs font-bold">
                        {platformInitial(project.platform)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium text-slate-800 truncate">{project.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-medium">
                          {project.platform}
                        </span>
                        {projGuidelines.map((g) => (
                          <span
                            key={g.id}
                            className="text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-medium"
                          >
                            {g.shortName}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="hidden sm:flex flex-col items-end gap-1">
                      <ScoreBar pct={scorePct} color={barColor} />
                      <span className="font-mono text-2xs text-slate-500 tabular-nums">
                        {scorePct > 0 ? `${formatPercent(scorePct)}%` : 'n/a'}
                      </span>
                    </div>

                    <div className="hidden md:flex items-center gap-1 shrink-0">
                      {auditors.slice(0, 3).map((u) => (
                        <AuditorAvatar key={u.id} user={u} size="xs" />
                      ))}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge type="audit" status={project.status} />
                      <ArrowRight
                        size={14}
                        className="text-slate-300 group-hover:text-slate-500 transition-colors"
                      />
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </motion.div>

        <motion.div variants={item} className="space-y-5">
          {isHeadAuditor && (
            <div>
              <h2 className="text-base font-semibold text-slate-800 tracking-tight mb-3">Team</h2>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden shadow-none">
                {auditTeam.map((u) => {
                  const projectCount = projects.filter(
                    (p) => p.auditorIds.includes(u.id) && p.status === 'in_progress',
                  ).length
                  return (
                    <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                      <AuditorAvatar user={u} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium truncate">{u.name}</p>
                        <p className="text-2xs text-slate-400 capitalize">
                          {u.role.replace('_', ' ')}
                        </p>
                      </div>
                      {projectCount > 0 && (
                        <span className="text-2xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md font-medium ring-1 ring-blue-200">
                          {projectCount} active
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-base font-semibold text-slate-800 tracking-tight mb-3">Upcoming Deadlines</h2>
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {upcomingDeadlines.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-slate-400 text-xs">No upcoming deadlines.</p>
                </div>
              ) : (
                upcomingDeadlines.map((p) => {
                  // Parse as a local calendar date and count whole days from local today,
                  // so "due today" isn't shown as overdue and agrees with the Overdue count.
                  const due = new Date(`${p.dueDate!.slice(0, 10)}T00:00:00`)
                  const daysLeft = Math.round((due.getTime() - new Date(`${todayLocal}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24))
                  const urgent = daysLeft <= 7
                  return (
                    <Link key={p.id} to={`/projects/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgent ? 'bg-rose-400' : 'bg-slate-300'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium truncate">{p.name}</p>
                        <p className="text-2xs text-slate-400">
                          {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className={`text-2xs font-mono font-medium ${urgent ? 'text-rose-500' : 'text-slate-400'}`}>
                        {daysLeft > 0 ? `${daysLeft}d` : daysLeft === 0 ? 'today' : 'overdue'}
                      </span>
                    </Link>
                  )
                })
              )}
            </div>
          </div>

        </motion.div>
      </div>
    </motion.div>
  )
}
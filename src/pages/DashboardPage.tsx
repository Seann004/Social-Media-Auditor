import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRightIcon as ArrowRight } from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import AuditorAvatar from '../components/ui/AuditorAvatar'
import ScoreRing from '../components/ui/ScoreRing'

// ── Mini SVG donut chart ────────────────────────────────────────────────────
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

// ── Vertical severity bars ──────────────────────────────────────────────────
function SeverityBars({ critical, major, minor }: { critical: number; major: number; minor: number }) {
  const max = Math.max(critical, major, minor, 1)
  const bars = [
    { label: 'Crit', count: critical, color: '#dc2626' },
    { label: 'Major', count: major, color: '#d97706' },
    { label: 'Minor', count: minor, color: '#94a3b8' },
  ]
  return (
    <div className="flex items-end gap-2.5 h-14">
      {bars.map(({ label, count, color }) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <span className="text-xs font-semibold" style={{ color: count > 0 ? color : '#cbd5e1' }}>
            {count}
          </span>
          <div className="w-6 bg-slate-100 rounded-t-sm overflow-hidden" style={{ height: 32 }}>
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: count > 0 ? count / max : 0 }}
              transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.2 }}
              style={{ backgroundColor: color, transformOrigin: 'bottom', height: '100%' }}
            />
          </div>
          <span className="text-[9px] text-slate-400 font-medium">{label}</span>
        </div>
      ))}
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

const PLATFORM_INITIAL: Record<string, string> = {
  TikTok: 'TK',
  Instagram: 'IG',
  Facebook: 'FB',
  Snapchat: 'SC',
  YouTube: 'YT',
  Discord: 'DC',
  BeReal: 'BR',
  'X (Twitter)': 'XTW',
}

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
  const { projects, users, currentUserId, checklistItems, responses, guidelines, complianceMap, initFromDb } = useStore()
  const currentUser = users.find((u) => u.id === currentUserId) ?? users[0]
  const location = useLocation()

  // Re-fetch from DB every time the user navigates to this page so counts stay current
  useEffect(() => { initFromDb() }, [location.key])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const isHeadAuditor = currentUser?.role === 'head_auditor'
  const isAdmin = currentUser?.role === 'admin'
  const isAuditor = currentUser?.role === 'auditor'

  // Auditors don't see draft projects — drafts aren't set up for audit work yet
  const visibleProjects = isAuditor ? projects.filter((p) => p.status !== 'draft') : projects
  const recentProjects = [...visibleProjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const activeProjects = visibleProjects.filter((p) => p.status === 'in_progress')
  const completedProjects = visibleProjects.filter((p) => p.status === 'completed')

  // Use DB-backed compliance scores so the average is always accurate
  const scoredProjects = visibleProjects.filter((p) => (complianceMap[p.id] ?? 0) > 0)
  const avgCompliance =
    scoredProjects.length > 0
      ? scoredProjects.reduce((sum, p) => sum + (complianceMap[p.id] ?? 0), 0) / scoredProjects.length
      : 0

  const nonCompliantResponses = Object.values(responses).filter((r) => r.status === 'non_compliant')
  const criticalIssues = nonCompliantResponses.filter((r) => checklistItems.find((c) => c.id === r.checklistItemId)?.severity === 'critical').length
  const majorIssues = nonCompliantResponses.filter((r) => checklistItems.find((c) => c.id === r.checklistItemId)?.severity === 'major').length
  const minorIssues = nonCompliantResponses.filter((r) => checklistItems.find((c) => c.id === r.checklistItemId)?.severity === 'minor').length

  const statusCounts = {
    draft: visibleProjects.filter((p) => p.status === 'draft').length,
    in_progress: activeProjects.length,
    under_review: visibleProjects.filter((p) => p.status === 'under_review').length,
    completed: completedProjects.length,
  }

  const upcomingDeadlines = projects
    .filter((p) => p.status === 'in_progress' && p.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 3)
  // Only auditors and head auditors appear in the team panel — admins are excluded
  const auditTeam = users.filter((u) => u.role !== 'admin')


  // Admin sees a simplified dashboard — guidelines management only
  if (isAdmin) {
    return (
      <motion.div variants={container} initial="hidden" animate="show"
        className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-10">
        <motion.div variants={item} className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {greeting}, {currentUser?.name.split(' ')[0]}.
          </h1>
          <p className="text-slate-500 text-base mt-1.5">You have Admin access — manage compliance guidelines below.</p>
        </motion.div>
        <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl">
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-sm text-slate-500 font-medium mb-2">Guidelines</p>
            <p className="text-3xl font-semibold text-slate-900 tabular-nums">{guidelines.length}</p>
            <p className="text-sm text-slate-400 mt-1">Regulatory frameworks loaded</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-sm text-slate-500 font-medium mb-2">Checklist Items</p>
            <p className="text-3xl font-semibold text-slate-900 tabular-nums">
              {guidelines.reduce((s, g) => s + g.itemCount, 0)}
            </p>
            <p className="text-sm text-slate-400 mt-1">Total across all frameworks</p>
          </div>
        </motion.div>
        <motion.div variants={item} className="mt-6">
          <Link to="/guidelines"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">
            Manage Guidelines
            <ArrowRight size={14} weight="bold" />
          </Link>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-10"
    >
      {/* Header */}
      <motion.div variants={item} className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {greeting}, {currentUser.name.split(' ')[0]}.
          </h1>
          <p className="text-slate-500 text-base mt-1.5 leading-relaxed">
            {activeProjects.length} audit{activeProjects.length !== 1 ? 's' : ''} in progress
            {completedProjects.length > 0 && `, ${completedProjects.length} completed`}.
          </p>
        </div>
        {isHeadAuditor && (
          <Link
            to="/projects/new"
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1"
          >
            New Audit
            <ArrowRight size={14} weight="bold" />
          </Link>
        )}
      </motion.div>

      {/* Stats strip — chart cards */}
      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">

        {/* Card 1: Total Audits — status donut */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-5 flex items-center gap-4">
          <DonutChart
            size={72} stroke={9}
            segments={[
              { value: statusCounts.draft, color: '#94a3b8' },
              { value: statusCounts.in_progress, color: '#2563eb' },
              { value: statusCounts.under_review, color: '#d97706' },
              { value: statusCounts.completed, color: '#059669' },
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
                  <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
                  {statusCounts.draft} draft
                </p>
              )}
              {statusCounts.in_progress > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                  {statusCounts.in_progress} active
                </p>
              )}
              {statusCounts.under_review > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  {statusCounts.under_review} in review
                </p>
              )}
              {statusCounts.completed > 0 && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                  {statusCounts.completed} done
                </p>
              )}
              {visibleProjects.length === 0 && (
                <p className="text-xs text-slate-300">No audits yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: In Progress — progress donut */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-5 flex items-center gap-4">
          <DonutChart
            size={72} stroke={9}
            segments={[
              { value: activeProjects.length, color: '#2563eb' },
              { value: Math.max(visibleProjects.length - activeProjects.length, 0), color: '#e2e8f0' },
            ]}
            center={
              <span className="text-base font-bold text-blue-600">{activeProjects.length}</span>
            }
          />
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">In Progress</p>
            <p className="text-xs text-slate-400">
              {visibleProjects.length > 0
                ? `${Math.round((activeProjects.length / visibleProjects.length) * 100)}% of total`
                : 'No audits yet'}
            </p>
            <p className="text-xs text-slate-300 mt-1">
              {visibleProjects.length - activeProjects.length} other status
            </p>
          </div>
        </div>

        {/* Card 3: Avg Compliance — score ring */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-5 flex items-center gap-4">
          <ScoreRing percentage={avgCompliance} size={72} strokeWidth={9} showLabel={false} />
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">Avg Compliance</p>
            <p className="font-mono text-2xl font-bold text-slate-800 tabular-nums leading-none">
              {avgCompliance.toFixed(1)}%
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {scoredProjects.length > 0
                ? `Across ${scoredProjects.length} audited`
                : 'No results yet'}
            </p>
          </div>
        </div>

        {/* Card 4: Non-Compliant Issues — severity bars */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-5">
          <p className="text-sm font-semibold text-slate-600 mb-3">Non-Compliant Issues</p>
          <div className="flex items-end gap-5">
            <SeverityBars critical={criticalIssues} major={majorIssues} minor={minorIssues} />
            <div className="pb-5">
              <p className={`font-mono text-2xl font-bold tabular-nums leading-none ${criticalIssues > 0 ? 'text-rose-600' : 'text-slate-300'}`}>
                {criticalIssues + majorIssues + minorIssues}
              </p>
              <p className="text-xs text-slate-400 mt-1">total</p>
            </div>
          </div>
        </div>

      </motion.div>

      {/* Main 2-col grid: recent audits + team panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent audits — 2/3 width */}
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
                <Link to="/projects" className="text-blue-600 text-sm font-medium mt-1 inline-block hover:text-blue-700">
                  Create your first audit
                </Link>
              </div>
            ) : (
              recentProjects.map((project) => {
                const scorePct = complianceMap[project.id] ?? 0
                const guidelineNames = project.guidelineIds
                  .map((gid) => guidelines.find((g) => g.id === gid)?.shortName)
                  .filter(Boolean)
                const auditors = project.auditorIds
                  .map((uid) => users.find((u) => u.id === uid))
                  .filter(Boolean) as typeof users
                const barColor =
                  scorePct >= 80 ? 'bg-emerald-500'
                    : scorePct >= 60 ? 'bg-amber-400'
                    : scorePct > 0 ? 'bg-rose-400'
                    : 'bg-slate-300'

                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-4 px-5 py-5 hover:bg-slate-50 transition-colors group"
                  >
                    {/* Platform dot */}
                    <div
                      className={`w-8 h-8 rounded-lg ${PLATFORM_COLOR[project.platform] ?? 'bg-slate-700'} flex items-center justify-center shrink-0`}
                    >
                      <span className="text-white text-[9px] font-bold">
                        {PLATFORM_INITIAL[project.platform]}
                      </span>
                    </div>

                    {/* Project name + platform + guidelines */}
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium text-slate-800 truncate">{project.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
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

                    {/* Score bar */}
                    <div className="hidden sm:flex flex-col items-end gap-1">
                      <ScoreBar pct={scorePct} color={barColor} />
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {scorePct > 0 ? `${scorePct.toFixed(1)}%` : '—'}
                      </span>
                    </div>

                    {/* Auditors */}
                    <div className="hidden md:flex items-center gap-1 shrink-0">
                      {auditors.slice(0, 3).map((u) => (
                        <AuditorAvatar key={u.id} user={u} size="xs" />
                      ))}
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
                )
              })
            )}
          </div>
        </motion.div>

        {/* Right panel — team + deadlines */}
        <motion.div variants={item} className="space-y-5">
          {/* Team */}
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
                      <p className="text-[11px] text-slate-400 capitalize">
                        {u.role.replace('_', ' ')}
                      </p>
                    </div>
                    {projectCount > 0 && (
                      <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium ring-1 ring-blue-200">
                        {projectCount} active
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Upcoming deadlines */}
          <div>
            <h2 className="text-base font-semibold text-slate-800 tracking-tight mb-3">Upcoming Deadlines</h2>
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {upcomingDeadlines.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-slate-400 text-xs">No upcoming deadlines.</p>
                </div>
              ) : (
                upcomingDeadlines.map((p) => {
                  const due = new Date(p.dueDate!)
                  const daysLeft = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  const urgent = daysLeft <= 7
                  return (
                    <Link key={p.id} to={`/projects/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgent ? 'bg-rose-400' : 'bg-slate-300'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className={`text-[11px] font-mono font-medium ${urgent ? 'text-rose-500' : 'text-slate-400'}`}>
                        {daysLeft > 0 ? `${daysLeft}d` : 'overdue'}
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
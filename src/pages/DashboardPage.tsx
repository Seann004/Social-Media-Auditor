import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRightIcon as ArrowRight,
  WarningIcon as Warning,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import StatusBadge from '../components/ui/StatusBadge'
import AuditorAvatar from '../components/ui/AuditorAvatar'

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
  const { projects, users, currentUserId, checklistItems, responses, getProjectScore, guidelines } = useStore()
  const currentUser = users.find((u) => u.id === currentUserId) ?? users[0]

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const activeProjects = projects.filter((p) => p.status === 'in_progress')
  const completedProjects = projects.filter((p) => p.status === 'completed')

  const scoredProjects = projects.filter((p) => getProjectScore(p.id).applicable > 0)
  const avgCompliance =
    scoredProjects.length > 0
      ? scoredProjects.reduce((sum, p) => sum + getProjectScore(p.id).percentage, 0) /
        scoredProjects.length
      : 0

  const criticalIssues = Object.values(responses).filter((r) => {
    const ci = checklistItems.find((c) => c.id === r.checklistItemId)
    return ci?.severity === 'critical' && r.status === 'non_compliant'
  }).length

  const recentProjects = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const upcomingDeadlines = projects
    .filter((p) => p.status === 'in_progress' && p.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 3)

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="max-w-[1400px] mx-auto px-6 md:px-10 py-10"
    >
      {/* Header */}
      <motion.div variants={item} className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-xs text-slate-400 font-mono tracking-widest uppercase mb-1.5">
            {new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
            {greeting}, {currentUser.name.split(' ')[0]}.
          </h1>
          <p className="text-slate-500 text-base mt-1.5 leading-relaxed">
            {activeProjects.length} audit{activeProjects.length !== 1 ? 's' : ''} in progress
            {completedProjects.length > 0 && `, ${completedProjects.length} completed`}.
          </p>
        </div>
        <Link
          to="/projects/new"
          className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-[10px] hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1"
        >
          New Audit
          <ArrowRight size={14} weight="bold" />
        </Link>
      </motion.div>

      {/* Stats strip — NOT three equal cards */}
      <motion.div
        variants={item}
        className="grid grid-cols-2 md:grid-cols-4 border border-slate-200 rounded-[14px] bg-white mb-8 overflow-hidden shadow-[0_1px_16px_-4px_oklch(0.3_0.01_250_/_0.07)]"
      >
        {[
          {
            label: 'Total Audits',
            value: projects.length,
            sub: `${projects.filter((p) => p.status === 'draft').length} draft`,
            icon: <CheckCircle size={16} className="text-slate-400" />,
          },
          {
            label: 'In Progress',
            value: activeProjects.length,
            sub: 'Active right now',
            icon: <Clock size={16} className="text-blue-400" />,
          },
          {
            label: 'Avg Compliance',
            value: `${avgCompliance.toFixed(1)}%`,
            sub: `Across ${scoredProjects.length} audited`,
            icon: null,
            mono: true,
          },
          {
            label: 'Critical Issues',
            value: criticalIssues,
            sub: 'Non-compliant critical items',
            icon: <Warning size={16} className="text-rose-400" />,
            danger: criticalIssues > 0,
          },
        ].map((stat, i) => (
          <div
            key={i}
            className={`px-7 py-6 ${i < 3 ? 'border-b md:border-b-0 md:border-r' : ''} border-slate-100`}
          >
            <div className="flex items-center gap-1.5 mb-2.5">
              {stat.icon}
              <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
            </div>
            <p
              className={`text-3xl font-semibold tracking-tight ${
                stat.danger ? 'text-rose-600' : 'text-slate-900'
              } ${stat.mono ? 'font-mono' : ''}`}
            >
              {stat.value}
            </p>
            <p className="text-sm text-slate-400 mt-1">{stat.sub}</p>
          </div>
        ))}
      </motion.div>

      {/* Main 2-col grid: recent audits + team panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div className="bg-white border border-slate-200 rounded-[14px] divide-y divide-slate-100 overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
            {recentProjects.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-slate-400 text-sm">No audits yet.</p>
                <Link to="/projects" className="text-blue-600 text-sm font-medium mt-1 inline-block hover:text-blue-700">
                  Create your first audit
                </Link>
              </div>
            ) : (
              recentProjects.map((project) => {
                const score = getProjectScore(project.id)
                const guidelineNames = project.guidelineIds
                  .map((gid) => guidelines.find((g) => g.id === gid)?.shortName)
                  .filter(Boolean)
                const auditors = project.auditorIds
                  .map((uid) => users.find((u) => u.id === uid))
                  .filter(Boolean) as typeof users
                const barColor =
                  score.percentage >= 80
                    ? 'bg-emerald-500'
                    : score.percentage >= 60
                    ? 'bg-amber-400'
                    : score.percentage > 0
                    ? 'bg-rose-400'
                    : 'bg-slate-300'

                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-4 px-5 py-5 hover:bg-slate-50 transition-colors group"
                  >
                    {/* Platform dot */}
                    <div
                      className={`w-8 h-8 rounded-[8px] ${PLATFORM_COLOR[project.platform] ?? 'bg-slate-700'} flex items-center justify-center shrink-0`}
                    >
                      <span className="text-white text-[9px] font-bold">
                        {PLATFORM_INITIAL[project.platform]}
                      </span>
                    </div>

                    {/* Platform + guidelines */}
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium text-slate-800 truncate">
                        {project.platform}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {guidelineNames.map((name) => (
                          <span
                            key={name}
                            className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-[4px] font-medium"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Score bar */}
                    <div className="hidden sm:flex flex-col items-end gap-1">
                      <ScoreBar pct={score.percentage} color={barColor} />
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {score.applicable > 0 ? `${score.percentage.toFixed(1)}%` : '—'}
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
            <div className="bg-white border border-slate-200 rounded-[14px] divide-y divide-slate-100 overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
              {users.map((u) => {
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
                      <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-[4px] font-medium ring-1 ring-blue-200">
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
            <h2 className="text-base font-semibold text-slate-800 tracking-tight mb-3">
              Upcoming Deadlines
            </h2>
            <div className="bg-white border border-slate-200 rounded-[14px] divide-y divide-slate-100 overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
              {upcomingDeadlines.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-slate-400 text-xs">No upcoming deadlines.</p>
                </div>
              ) : (
                upcomingDeadlines.map((p) => {
                  const due = new Date(p.dueDate!)
                  const daysLeft = Math.ceil(
                    (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                  )
                  const urgent = daysLeft <= 7
                  return (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group"
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${urgent ? 'bg-rose-400' : 'bg-slate-300'}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium">{p.platform}</p>
                        <p className="text-[11px] text-slate-400">
                          {due.toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </p>
                      </div>
                      <span
                        className={`text-[11px] font-mono font-medium ${
                          urgent ? 'text-rose-500' : 'text-slate-400'
                        }`}
                      >
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
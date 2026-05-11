import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChartBarIcon as ChartBar,
  DownloadIcon as Download,
  CheckCircleIcon as CheckCircle,
  XCircleIcon as XCircle,
  MinusCircleIcon as MinusCircle,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import ScoreRing from '../components/ui/ScoreRing'
import StatusBadge from '../components/ui/StatusBadge'
import SeverityBadge from '../components/ui/SeverityBadge'

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
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

function ScoreBar({ pct }: { pct: number }) {
  const color =
    pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : pct > 0 ? 'bg-rose-400' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full origin-left ${color}`}
          style={{
            transform: `scaleX(${Math.min(pct, 100) / 100})`,
            transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      </div>
      <span className="font-mono text-xs text-slate-600 tabular-nums w-12">
        {pct > 0 ? `${pct.toFixed(1)}%` : '—'}
      </span>
    </div>
  )
}

export default function ReportsPage() {
  const { projects, guidelines, checklistItems, responses, getProjectScore, getCategoryScore } = useStore()

  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    const firstWithData = projects.find((p) => getProjectScore(p.id).answered > 0)
    return firstWithData?.id ?? projects[0]?.id ?? ''
  })

  const project = projects.find((p) => p.id === selectedProjectId)
  const score = getProjectScore(selectedProjectId)

  const projectGuidelines = guidelines.filter((g) => project?.guidelineIds.includes(g.id))

  const projectItems = checklistItems.filter((ci) => project?.guidelineIds.includes(ci.guidelineId))

  const categories = (() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const ci of projectItems) {
      if (!seen.has(ci.category)) {
        seen.add(ci.category)
        result.push(ci.category)
      }
    }
    return result
  })()

  const severityBreakdown = (['critical', 'major', 'minor'] as const).map((sev) => {
    const sevItems = projectItems.filter((ci) => ci.severity === sev)
    const sevResponses = sevItems.map((ci) => responses[`${selectedProjectId}__${ci.id}`])
    const compliant = sevResponses.filter((r) => r?.status === 'compliant').length
    const nonCompliant = sevResponses.filter((r) => r?.status === 'non_compliant').length
    const notAnswered = sevItems.length - sevResponses.filter((r) => r && r.status !== 'not_started').length
    return { severity: sev, total: sevItems.length, compliant, nonCompliant, notAnswered }
  })

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <p className="text-slate-400 text-sm">No audit projects found.</p>
      </div>
    )
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="max-w-[1400px] mx-auto px-6 md:px-10 py-8"
    >
      {/* Header */}
      <motion.div variants={item} className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Reports</h1>
          <p className="text-slate-500 text-base mt-1">Compliance breakdown by project and guideline</p>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-[10px] hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1 shadow-sm"
        >
          <Download size={14} />
          Export PDF
        </button>
      </motion.div>

      {/* Project selector */}
      <motion.div variants={item} className="mb-6">
        <label className="block text-xs text-slate-500 font-medium mb-1.5" htmlFor="project-select">
          Audit project
        </label>
        <select
          id="project-select"
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="bg-white border border-slate-200 text-slate-800 text-sm rounded-[10px] px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium shadow-sm appearance-none cursor-pointer"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.platform} — {p.guidelineIds.map((gid) => guidelines.find((g) => g.id === gid)?.shortName).join(', ')}
            </option>
          ))}
        </select>
      </motion.div>

      {/* Summary row */}
      <motion.div variants={item} className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-7">
        {/* Score ring + summary */}
        <div className="md:col-span-1 bg-white border border-slate-200 rounded-[14px] p-6 flex flex-col items-center justify-center gap-3 shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
          <div
            className={`w-10 h-10 rounded-[10px] ${PLATFORM_COLOR[project.platform] ?? 'bg-slate-700'} flex items-center justify-center`}
          >
            <span className="text-white text-[10px] font-bold">
              {project.platform.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <ScoreRing percentage={score.percentage} size={112} strokeWidth={9} showLabel />
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">{project.platform}</p>
            <div className="mt-1">
              <StatusBadge type="audit" status={project.status} />
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          {[
            {
              label: 'Compliant',
              value: score.compliant,
              icon: CheckCircle,
              color: 'text-emerald-600',
              bg: 'bg-emerald-50',
              border: 'border-emerald-100',
            },
            {
              label: 'Non-Compliant',
              value: score.nonCompliant,
              icon: XCircle,
              color: 'text-rose-600',
              bg: 'bg-rose-50',
              border: 'border-rose-100',
            },
            {
              label: 'Not Applicable',
              value: score.notApplicable,
              icon: MinusCircle,
              color: 'text-slate-500',
              bg: 'bg-slate-50',
              border: 'border-slate-100',
            },
            {
              label: 'Not Answered',
              value: score.total - score.answered,
              icon: ChartBar,
              color: 'text-amber-600',
              bg: 'bg-amber-50',
              border: 'border-amber-100',
            },
          ].map(({ label, value, icon: Icon, color, bg, border }) => (
            <div
              key={label}
              className={`${bg} border ${border} rounded-[12px] px-4 py-4 flex items-center gap-3`}
            >
              <Icon size={20} className={color} weight="fill" />
              <div>
                <p className={`font-mono text-xl font-semibold ${color} tabular-nums`}>{value}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Per-guideline breakdown */}
      {projectGuidelines.length > 0 && (
        <motion.div variants={item} className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 tracking-tight">
            By Guideline
          </h2>
          <div className="bg-white border border-slate-200 rounded-[14px] divide-y divide-slate-100 overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
            {projectGuidelines.map((g) => {
              const gItems = checklistItems.filter((ci) => ci.guidelineId === g.id)
              const gResps = gItems.map((ci) => responses[`${selectedProjectId}__${ci.id}`])
              const gCompliant = gResps.filter((r) => r?.status === 'compliant').length
              const gNonCompliant = gResps.filter((r) => r?.status === 'non_compliant').length
              const gNA = gResps.filter((r) => r?.status === 'not_applicable').length
              const gAnswered = gCompliant + gNonCompliant + gNA
              const gApplicable = gAnswered - gNA
              const gPct = gApplicable > 0 ? Math.round((gCompliant / gApplicable) * 1000) / 10 : 0

              return (
                <div key={g.id} className="flex items-center gap-5 px-6 py-5">
                  <div className="w-32 shrink-0">
                    <p className="text-base font-medium text-slate-800">{g.shortName}</p>
                    <p className="text-[10px] text-slate-400 font-mono">v{g.version}</p>
                  </div>
                  <div className="flex-1">
                    <ScoreBar pct={gPct} />
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs font-mono text-slate-500 shrink-0 tabular-nums">
                    <span className="text-emerald-600">{gCompliant} pass</span>
                    <span className="text-rose-500">{gNonCompliant} fail</span>
                    <span className="text-slate-400">{gNA} n/a</span>
                    <span className="text-slate-300">|</span>
                    <span>
                      {gAnswered}/{gItems.length}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Per-category breakdown */}
      {categories.length > 0 && (
        <motion.div variants={item} className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 tracking-tight">
            By Category
          </h2>
          <div className="bg-white border border-slate-200 rounded-[14px] overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] text-[10px] text-slate-400 font-mono uppercase tracking-wide px-5 py-2 border-b border-slate-100 bg-slate-50/60">
              <span>Category</span>
              <span className="w-40 text-right hidden sm:block">Compliance</span>
              <span className="w-14 text-right">Pass</span>
              <span className="w-14 text-right">Fail</span>
              <span className="w-14 text-right">Total</span>
            </div>
            <div className="divide-y divide-slate-50">
              {categories.map((cat) => {
                const catScore = getCategoryScore(selectedProjectId, cat)
                return (
                  <div key={cat} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-6 py-4">
                    <span className="text-base text-slate-700 font-medium pr-4">{cat}</span>
                    <div className="w-40 hidden sm:block">
                      <ScoreBar pct={catScore.percentage} />
                    </div>
                    <span className="w-14 text-right font-mono text-xs text-emerald-600 tabular-nums">
                      {catScore.compliant}
                    </span>
                    <span className="w-14 text-right font-mono text-xs text-rose-500 tabular-nums">
                      {catScore.nonCompliant}
                    </span>
                    <span className="w-14 text-right font-mono text-xs text-slate-500 tabular-nums">
                      {catScore.total}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* Severity breakdown */}
      <motion.div variants={item}>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 tracking-tight">
          By Severity
        </h2>
        <div className="bg-white border border-slate-200 rounded-[14px] divide-y divide-slate-100 overflow-hidden shadow-[0_1px_8px_-2px_oklch(0.3_0.01_250_/_0.06)]">
          {severityBreakdown.map(({ severity, total, compliant, nonCompliant, notAnswered }) => {
            const answered = total - notAnswered
            const naCount = answered - compliant - nonCompliant
            const calcPct = (answered - naCount) > 0 ? Math.round(compliant / (answered - naCount) * 1000) / 10 : 0
            return (
              <div key={severity} className="flex items-center gap-5 px-6 py-5">
                <div className="w-20 shrink-0">
                  <SeverityBadge severity={severity} />
                </div>
                <div className="flex-1">
                  <ScoreBar pct={calcPct} />
                </div>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums shrink-0">
                  <span className="text-emerald-600">{compliant} pass</span>
                  <span className="text-rose-500">{nonCompliant} fail</span>
                  <span className="text-slate-400 hidden sm:block">{notAnswered} pending</span>
                  <span className="text-slate-400">{total} total</span>
                </div>
              </div>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
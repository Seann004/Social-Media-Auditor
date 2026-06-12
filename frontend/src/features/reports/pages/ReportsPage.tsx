import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MagnifyingGlassIcon as MagnifyingGlass,
  DownloadIcon as Download,
  CheckCircleIcon as CheckCircle,
  XCircleIcon as XCircle,
  MinusCircleIcon as MinusCircle,
  ClockIcon as Clock,
  ArrowRightIcon as ArrowRight,
  SpinnerIcon as Spinner,
  FileTextIcon as FileText,
  FunnelIcon as Funnel,
  LockIcon as Lock,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import * as db from '../../../lib/db'
import type { DbAuditReport, DbComplianceScore, DbAuditResult, DbChecklistItem } from '../../../lib/db'
import type { SubmissionStatus } from '../../../types'
import ScoreRing from '../../audits/components/ScoreRing'
import StatusBadge from '../../audits/components/StatusBadge'

const PLATFORM_COLOR: Record<string, string> = {
  TikTok: 'bg-slate-800', Instagram: 'bg-pink-500', Facebook: 'bg-blue-600',
  Snapchat: 'bg-yellow-400', YouTube: 'bg-red-600', Discord: 'bg-indigo-500',
  BeReal: 'bg-slate-700', 'X (Twitter)': 'bg-slate-900',
}


function StatusChip({ status }: { status: SubmissionStatus }) {
  const map: Record<SubmissionStatus, string> = {
    not_submitted: 'bg-slate-100 text-slate-500',
    pending_review: 'bg-amber-50 text-amber-700 border border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    rejected: 'bg-rose-50 text-rose-700 border border-rose-200',
  }
  const label: Record<SubmissionStatus, string> = {
    not_submitted: 'Not Submitted', pending_review: 'Pending Review',
    approved: 'Approved', rejected: 'Rejected',
  }
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${map[status]}`}>{label[status]}</span>
}

function SummaryBarChart({ pass, fail, na }: { pass: number; fail: number; na: number }) {
  const total = pass + fail + na
  const bars: { label: string; value: number; color: string }[] = [
    { label: 'Passing', value: pass, color: 'bg-emerald-500' },
    { label: 'Failing', value: fail, color: 'bg-rose-500' },
    { label: 'Not Applicable', value: na, color: 'bg-slate-400' },
  ]
  return (
    <div className="space-y-2.5">
      {bars.map(({ label, value, color }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-slate-500">{label}</span>
          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden ring-1 ring-inset ring-black/[0.03]">
            <div className={`h-full rounded-full ${color}`} style={{ width: total > 0 ? `${(value / total) * 100}%` : '0%' }} />
          </div>
          <span className="w-7 text-right text-xs font-mono text-slate-600 tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  )
}

function ScoreBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : pct > 0 ? 'bg-rose-400' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
        <div className={`absolute inset-y-0 left-0 w-full rounded-full origin-left ${color}`}
          style={{ transform: `scaleX(${Math.min(pct, 100) / 100})`, transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
      <span className="font-mono text-xs text-slate-600 tabular-nums w-12">{pct > 0 ? `${pct.toFixed(1)}%` : '—'}</span>
    </div>
  )
}

export default function ReportsPage() {
  const { currentUserId, guidelines, users } = useStore()
  const currentUser = users.find((u) => u.id === currentUserId)

  if (currentUser?.role === 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Lock size={20} className="text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Access Restricted</h2>
        <p className="text-slate-500 text-sm max-w-xs">Admins manage guidelines only and do not have access to audit reports.</p>
      </div>
    )
  }

  // Audit Submission Reports
  const [reports, setReports] = useState<DbAuditReport[]>([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Selected report for detailed view
  const [selectedReport, setSelectedReport] = useState<DbAuditReport | null>(null)
  const [complianceScores, setComplianceScores] = useState<DbComplianceScore[]>([])
  const [loadingScores, setLoadingScores] = useState(false)
  const [auditResults, setAuditResults] = useState<DbAuditResult[]>([])
  const [reportChecklistItems, setReportChecklistItems] = useState<DbChecklistItem[]>([])

  const loadReports = useCallback(async () => {
    if (!currentUserId) return
    setLoadingReports(true)
    try {
      const data = await db.fetchAuditReports(currentUserId, {
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setReports(data)
    } catch {
      setReports([])
    } finally {
      setLoadingReports(false)
    }
  }, [currentUserId, search, dateFrom, dateTo])

  useEffect(() => { loadReports() }, [loadReports])

  async function handleSelectReport(report: DbAuditReport) {
    setSelectedReport(report)
    setLoadingScores(true)
    try {
      const [scores, results, items] = await Promise.all([
        db.fetchComplianceScores(report.projectId),
        db.fetchAuditResults(report.projectId),
        db.fetchProjectChecklistItems(report.projectId),
      ])
      setComplianceScores(scores ?? [])
      setAuditResults(results ?? [])
      setReportChecklistItems(items ?? [])
    } catch {
      setComplianceScores([])
      setAuditResults([])
      setReportChecklistItems([])
    } finally {
      setLoadingScores(false)
    }
  }

  const itemById = useMemo(
    () => new Map(reportChecklistItems.map((ci) => [ci.itemId, ci])),
    [reportChecklistItems],
  )
  const passResults = useMemo(
    () => auditResults.filter((r) => r.result === 'compliant'),
    [auditResults],
  )
  const failingResults = useMemo(
    () => auditResults.filter((r) => r.result === 'non_compliant' || r.result === 'partially'),
    [auditResults],
  )
  const naResults = useMemo(
    () => auditResults.filter((r) => r.result === 'not_applicable'),
    [auditResults],
  )

  // Export Report as PDF
  function handleExportPDF() {
    window.print()
  }

  const overallScore = complianceScores.length > 0
    ? complianceScores.reduce((sum, s) => sum + (s.scorePercentage ?? 0), 0) / complianceScores.length
    : (selectedReport?.scorePercentage ?? 0)

  const totalItems = complianceScores.reduce((s, c) => s + c.totalItems, 0)
  const totalCompliant = complianceScores.reduce((s, c) => s + c.compliantItems, 0)
  const totalNonCompliant = complianceScores.reduce((s, c) => s + c.nonCompliantItems, 0)
  const totalNA = complianceScores.reduce((s, c) => s + c.notApplicableItems, 0)
  const totalAnswered = complianceScores.reduce((s, c) => s + c.answeredItems, 0)

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-8 print:px-0 print:py-0">
      {/* Print-only header */}
      <div className="hidden print:block mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold">SafetyAudit — Audit Report</h1>
        {selectedReport && (
          <p className="text-sm text-gray-600 mt-1">
            {selectedReport.projectTitle} · {selectedReport.smPlatform}
          </p>
        )}
      </div>

      <div className="print:hidden">
        {/* ── Audit Submission Reports ── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Reports</h1>
            <p className="text-slate-500 text-base mt-1">View audit submission reports and generate compliance reports.</p>
          </div>
          {selectedReport && (
            <button type="button" onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
              <Download size={14} /> Export PDF
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 xl:gap-6">
          {/* Left: Reports list */}
          <div className="xl:col-span-2">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Search + filter */}
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 relative">
                    <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by project or platform…"
                      className="w-full pl-8 pr-3 py-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder:text-slate-300" />
                  </div>
                  <button type="button" onClick={() => setShowFilters((v) => !v)}
                    className={['p-2 rounded-lg border transition-colors', showFilters ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'].join(' ')}>
                    <Funnel size={14} />
                  </button>
                </div>

                <AnimatePresence>
                  {showFilters && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="pt-2 space-y-2">
                        <div className="flex gap-2">
                          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700" />
                          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700" />
                        </div>
                        <button type="button" onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
                          className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                          Clear filters
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Report list */}
              {loadingReports ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner size={24} className="animate-spin text-slate-300" />
                </div>
              ) : reports.length === 0 ? (
                <div className="py-12 text-center px-6">
                  <FileText size={32} className="text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm font-medium">No submission reports found.</p>
                  <p className="text-slate-400 text-xs mt-1">Reports appear when audits are submitted for review.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {reports.map((r) => (
                    <button key={r.projectId} type="button" onClick={() => handleSelectReport(r)}
                      className={['w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-slate-50 transition-colors',
                        selectedReport?.projectId === r.projectId ? 'bg-blue-50/60 border-l-2 border-blue-500' : 'border-l-2 border-transparent',
                      ].join(' ')}>
                      <div className={`w-8 h-8 rounded-lg ${PLATFORM_COLOR[r.smPlatform] ?? 'bg-slate-700'} flex items-center justify-center shrink-0 mt-0.5`}>
                        <span className="text-white text-[9px] font-bold">{r.smPlatform.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{r.projectTitle}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{r.smPlatform} · {new Date(r.timeCreated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusChip status={r.submissionStatus} />
                          {r.scorePercentage != null && (
                            <span className="font-mono text-[10px] text-slate-500">{Number(r.scorePercentage).toFixed(1)}%</span>
                          )}
                        </div>
                      </div>
                      <ArrowRight size={13} className="text-slate-300 shrink-0 mt-1" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Detailed report (View Compliance Score + Generate Report) */}
          <div className="xl:col-span-3">
            {!selectedReport ? (
              <div className="bg-white border border-slate-200 rounded-xl flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                  <FileText size={40} className="text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm font-medium">Select a report to view details</p>
                  <p className="text-slate-300 text-xs mt-1">Click a submission from the list</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Header card */}
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <div className="flex items-start gap-4 mb-5">
                    <div className={`w-12 h-12 rounded-xl ${PLATFORM_COLOR[selectedReport.smPlatform] ?? 'bg-slate-700'} flex items-center justify-center shrink-0`}>
                      <span className="text-white text-xs font-bold">{selectedReport.smPlatform.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold text-slate-900 tracking-tight">{selectedReport.projectTitle}</h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">{selectedReport.smPlatform}</span>
                        <StatusBadge type="audit" status={selectedReport.projectStatus} />
                        <StatusChip status={selectedReport.submissionStatus} />
                      </div>
                    </div>
                    <Link to={`/projects/${selectedReport.projectId}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors shrink-0">
                      View Project <ArrowRight size={11} />
                    </Link>
                  </div>

                  {selectedReport.submissionRemarks && (
                    <div className={['rounded-lg px-4 py-3 text-xs mb-4',
                      selectedReport.submissionStatus === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'].join(' ')}>
                      <p className="font-semibold mb-0.5">Review Remarks:</p>
                      <p>{selectedReport.submissionRemarks}</p>
                    </div>
                  )}

                  {/* View Compliance Score — summary row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-100 rounded-xl overflow-hidden">
                    {[
                      { label: 'Compliant', value: totalCompliant, icon: CheckCircle, color: 'text-emerald-600' },
                      { label: 'Non-Compliant', value: totalNonCompliant, icon: XCircle, color: 'text-rose-600' },
                      { label: 'Not Applicable', value: totalNA, icon: MinusCircle, color: 'text-slate-500' },
                      { label: 'Pending', value: totalItems - totalAnswered, icon: Clock, color: 'text-amber-600' },
                    ].map(({ label, value, icon: Icon, color }, i) => (
                      <div key={label} className={`px-5 py-4 ${i < 3 ? 'border-r border-slate-100' : ''}`}>
                        <div className="flex items-center gap-1.5 mb-1"><Icon size={14} className={color} weight="fill" /></div>
                        <p className={`font-mono text-xl font-semibold ${color} tabular-nums`}>{loadingScores ? '—' : value}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Overall compliance score */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-6">
                  <ScoreRing percentage={overallScore} size={96} strokeWidth={8} showLabel />
                  <div>
                    <p className="text-base font-semibold text-slate-800">Overall Compliance Score</p>
                    <p className="text-sm text-slate-500 mt-0.5">Based on {totalAnswered} of {totalItems} items answered</p>
                    <p className="text-xs text-slate-400 mt-2">
                      Lead: {selectedReport.headAuditorName}
                      {selectedReport.dueDate && ` · Due ${new Date(selectedReport.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    </p>
                  </div>
                </div>

                {/* Quick summary — failing & not applicable items */}
                {!loadingScores && (failingResults.length > 0 || naResults.length > 0) && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Quick Summary — Failing &amp; Not Applicable</p>
                    </div>
                    <div className="px-5 py-4 border-b border-slate-100">
                      <SummaryBarChart pass={passResults.length} fail={failingResults.length} na={naResults.length} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      <div className="p-5">
                        <p className="text-xs font-semibold text-rose-600 mb-3 flex items-center gap-1.5">
                          <XCircle size={13} weight="fill" /> Failing ({failingResults.length})
                        </p>
                        {failingResults.length === 0 ? (
                          <p className="text-xs text-slate-400">No failing items.</p>
                        ) : (
                          <ul className="space-y-3 max-h-72 overflow-y-auto pr-1 print:max-h-none print:overflow-visible">
                            {failingResults.map((r) => {
                              const item = itemById.get(r.itemId)
                              return (
                                <li key={r.resultId} className="text-xs">
                                  <p className="font-medium text-slate-700 leading-snug">{item?.itemName || item?.itemDescription || 'Checklist item'}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    {item?.category}{r.result === 'partially' ? ' · Partially compliant' : ' · Non-compliant'}
                                  </p>
                                  {r.findings && <p className="text-[11px] text-rose-600 mt-1 leading-relaxed">{r.findings}</p>}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                      <div className="p-5">
                        <p className="text-xs font-semibold text-slate-500 mb-3 flex items-center gap-1.5">
                          <MinusCircle size={13} weight="fill" /> Not Applicable ({naResults.length})
                        </p>
                        {naResults.length === 0 ? (
                          <p className="text-xs text-slate-400">No not-applicable items.</p>
                        ) : (
                          <ul className="space-y-3 max-h-72 overflow-y-auto pr-1 print:max-h-none print:overflow-visible">
                            {naResults.map((r) => {
                              const item = itemById.get(r.itemId)
                              return (
                                <li key={r.resultId} className="text-xs">
                                  <p className="font-medium text-slate-700 leading-snug">{item?.itemName || item?.itemDescription || 'Checklist item'}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">{item?.category}</p>
                                  {r.notes && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{r.notes}</p>}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Per-guideline breakdown (category breakdown) */}
                {loadingScores ? (
                  <div className="bg-white border border-slate-200 rounded-xl flex items-center justify-center py-12">
                    <Spinner size={24} className="animate-spin text-slate-300" />
                  </div>
                ) : complianceScores.length > 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">By Guideline</p>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {complianceScores.map((s) => (
                        <div key={s.guidelineId} className="flex items-center gap-5 px-6 py-4">
                          <div className="w-28 shrink-0">
                            <p className="text-sm font-medium text-slate-800">{s.shortName}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{s.answeredItems}/{s.totalItems}</p>
                          </div>
                          <div className="flex-1"><ScoreBar pct={s.scorePercentage ?? 0} /></div>
                          <div className="hidden sm:flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
                            <span className="text-emerald-600">{s.compliantItems} pass</span>
                            <span className="text-rose-500">{s.nonCompliantItems} fail</span>
                            <span className="text-slate-400">{s.notApplicableItems} n/a</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl py-8 text-center">
                    <p className="text-slate-400 text-sm">No compliance data recorded yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Print view (Export) ── */}
      {selectedReport && (
        <div className="hidden print:block">
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Project</p>
              <p className="font-semibold">{selectedReport.projectTitle}</p>
              <p className="text-sm text-gray-600">{selectedReport.smPlatform} · {selectedReport.projectStatus}</p>
              <p className="text-sm text-gray-600 mt-1">Lead: {selectedReport.headAuditorName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Submission Status</p>
              <p className="font-semibold">{selectedReport.submissionStatus.replace('_', ' ')}</p>
              {selectedReport.submissionRemarks && <p className="text-sm text-gray-600 mt-1">{selectedReport.submissionRemarks}</p>}
            </div>
          </div>

          <div className="mb-6 p-4 border border-gray-200 rounded-lg">
            <p className="text-sm font-semibold mb-2">Overall Compliance Score: {overallScore.toFixed(1)}%</p>
            <p className="text-sm text-gray-600">{totalCompliant} compliant · {totalNonCompliant} non-compliant · {totalNA} not applicable · {totalItems - totalAnswered} pending</p>
          </div>

          {(failingResults.length > 0 || naResults.length > 0) && (
            <div className="mb-8">
              <p className="text-sm font-semibold mb-3">Quick Summary — Failing &amp; Not Applicable</p>

              <div className="mb-6 max-w-md" style={{ breakInside: 'avoid' }}>
                <SummaryBarChart pass={passResults.length} fail={failingResults.length} na={naResults.length} />
              </div>

              {/* Stacked (not side-by-side) so each section can flow and paginate naturally across PDF pages */}
              {failingResults.length > 0 && (
                <div className="mb-5" style={{ breakInside: 'avoid' }}>
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Failing ({failingResults.length})</p>
                  <ul className="space-y-2.5">
                    {failingResults.map((r) => {
                      const item = itemById.get(r.itemId)
                      return (
                        <li key={r.resultId} className="text-xs" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                          <p className="font-medium text-gray-800">{item?.itemName || item?.itemDescription || 'Checklist item'}</p>
                          <p className="text-gray-500">{item?.category}{r.result === 'partially' ? ' · Partially compliant' : ' · Non-compliant'}</p>
                          {r.findings && <p className="text-red-700 mt-0.5">{r.findings}</p>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {naResults.length > 0 && (
                <div style={{ breakInside: 'avoid' }}>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Not Applicable ({naResults.length})</p>
                  <ul className="space-y-2.5">
                    {naResults.map((r) => {
                      const item = itemById.get(r.itemId)
                      return (
                        <li key={r.resultId} className="text-xs" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                          <p className="font-medium text-gray-800">{item?.itemName || item?.itemDescription || 'Checklist item'}</p>
                          <p className="text-gray-500">{item?.category}</p>
                          {r.notes && <p className="text-gray-600 mt-0.5">{r.notes}</p>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {complianceScores.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-3">Guideline Breakdown</p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 font-semibold text-gray-600">Guideline</th>
                    <th className="text-right py-2 font-semibold text-gray-600">Score</th>
                    <th className="text-right py-2 font-semibold text-gray-600">Pass</th>
                    <th className="text-right py-2 font-semibold text-gray-600">Fail</th>
                    <th className="text-right py-2 font-semibold text-gray-600">N/A</th>
                    <th className="text-right py-2 font-semibold text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {complianceScores.map((s) => (
                    <tr key={s.guidelineId} className="border-b border-gray-100">
                      <td className="py-2">{s.guidelineName}</td>
                      <td className="text-right py-2 font-mono">{(s.scorePercentage ?? 0).toFixed(1)}%</td>
                      <td className="text-right py-2 text-green-700">{s.compliantItems}</td>
                      <td className="text-right py-2 text-red-700">{s.nonCompliantItems}</td>
                      <td className="text-right py-2 text-gray-500">{s.notApplicableItems}</td>
                      <td className="text-right py-2">{s.totalItems}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-8 text-xs text-gray-400">Generated by SafetyAudit</p>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MagnifyingGlassIcon as MagnifyingGlass,
  PrinterIcon as Printer,
  CheckCircleIcon as CheckCircle,
  XCircleIcon as XCircle,
  MinusCircleIcon as MinusCircle,
  ClockIcon as Clock,
  ArrowRightIcon as ArrowRight,
  FileTextIcon as FileText,
  FunnelIcon as Funnel,
  LockIcon as Lock,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import * as db from '../../../lib/db'
import type { DbAuditReport, DbComplianceScore, DbAuditResult, DbChecklistItem } from '../../../lib/db'
import ScoreRing from '../../audits/components/ScoreRing'
import StatusBadge from '../../audits/components/StatusBadge'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { platformColor } from '../../../lib/platformColors'
import { scoreColor, formatPercent } from '../../../lib/scoreColor'

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />
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
  const color = scoreColor(pct).bar
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
        <div className={`absolute inset-y-0 left-0 w-full rounded-full origin-left ${color}`}
          style={{ transform: `scaleX(${Math.min(pct, 100) / 100})`, transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
      <span className="font-mono text-xs text-slate-600 tabular-nums w-12">{pct > 0 ? `${formatPercent(pct)}%` : '—'}</span>
    </div>
  )
}

export default function ReportsPage() {
  const { currentUserId, users } = useStore()
  const currentUser = users.find((u) => u.id === currentUserId)

  // Audit Submission Reports
  const [reports, setReports] = useState<DbAuditReport[]>([])
  const [loadingReports, setLoadingReports] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Selected report for detailed view
  const [selectedReport, setSelectedReport] = useState<DbAuditReport | null>(null)
  const [complianceScores, setComplianceScores] = useState<DbComplianceScore[]>([])
  const [loadingScores, setLoadingScores] = useState(false)
  const [auditResults, setAuditResults] = useState<DbAuditResult[]>([])
  const [reportChecklistItems, setReportChecklistItems] = useState<DbChecklistItem[]>([])
  const [showPrintWarning, setShowPrintWarning] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadReports = useCallback(async () => {
    if (!currentUserId) return
    setLoadingReports(true)
    try {
      const data = await db.fetchAuditReports(currentUserId, {
        search: debouncedSearch || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setReports(data)
    } catch {
      setReports([])
    } finally {
      setLoadingReports(false)
    }
  }, [currentUserId, debouncedSearch, dateFrom, dateTo])

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

  // Uses the browser's native print dialog — there's no server-generated PDF here,
  // so the user needs to pick "Save as PDF" themselves. Printing freezes the tab while
  // Chrome lays out the print view, which can take a noticeable moment on a large report,
  // so we confirm first rather than triggering it the instant the button is clicked.
  function handlePrint() {
    setShowPrintWarning(false)
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

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-8 print:px-0 print:py-0">
      {/* Print-only header */}
      <div className="hidden print:block mb-6 border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold">SafetyAudit — Audit Report</h1>
        {selectedReport && (
          <p className="text-sm text-slate-600 mt-1">
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
          <Button
            variant="secondary"
            size="md"
            disabled={!selectedReport}
            onClick={() => setShowPrintWarning(true)}
            title={selectedReport ? 'Print or save this report as PDF' : 'Select a report first to print it'}
            className="shadow-sm shrink-0"
          >
            <Printer size={14} /> Print
          </Button>
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
                    <label htmlFor="report-search" className="sr-only">Search reports</label>
                    <input id="report-search" value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by project or platform…"
                      className="w-full pl-8 pr-3 py-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder:text-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                  </div>
                  <button type="button" onClick={() => setShowFilters((v) => !v)}
                    aria-expanded={showFilters}
                    aria-label="Toggle date filters"
                    className={['p-2 rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600', showFilters ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'].join(' ')}>
                    <Funnel size={14} />
                  </button>
                </div>

                {!loadingReports && reports.length > 0 && (
                  <p className="text-2xs text-slate-400 tabular-nums" role="status">
                    {reports.length} report{reports.length !== 1 ? 's' : ''}
                    {debouncedSearch && ` matching "${debouncedSearch}"`}
                  </p>
                )}

                <AnimatePresence>
                  {showFilters && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="pt-2 space-y-2">
                        <div className="flex gap-2">
                          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                        </div>
                        <button type="button" onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
                          className="text-xs text-slate-400 hover:text-slate-600 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                          Clear filters
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Report list */}
              {loadingReports ? (
                <div className="divide-y divide-slate-50">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-4">
                      <SkeletonBlock className="w-8 h-8 rounded-lg shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <SkeletonBlock className="h-3.5 w-2/3" />
                        <SkeletonBlock className="h-2.5 w-1/2 bg-slate-100" />
                        <SkeletonBlock className="h-4 w-24 rounded-md bg-slate-100" />
                      </div>
                    </div>
                  ))}
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
                      aria-current={selectedReport?.projectId === r.projectId ? 'true' : undefined}
                      className={['w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600',
                        selectedReport?.projectId === r.projectId ? 'bg-blue-50/60 border-l-2 border-blue-500' : 'border-l-2 border-transparent',
                      ].join(' ')}>
                      <div className={`w-8 h-8 rounded-lg ${platformColor(r.smPlatform)} flex items-center justify-center shrink-0 mt-0.5`}>
                        <span className="text-white text-2xs font-bold">{r.smPlatform.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{r.projectTitle}</p>
                        <p className="text-2xs text-slate-400 mt-0.5">{r.smPlatform} · {new Date(r.timeCreated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <StatusBadge type="submission" status={r.submissionStatus} />
                          {r.scorePercentage != null && (
                            <span className="font-mono text-2xs text-slate-500">{formatPercent(Number(r.scorePercentage))}%</span>
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
                    <div className={`w-12 h-12 rounded-xl ${platformColor(selectedReport.smPlatform)} flex items-center justify-center shrink-0`}>
                      <span className="text-white text-xs font-bold">{selectedReport.smPlatform.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold text-slate-900 tracking-tight">{selectedReport.projectTitle}</h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-medium">{selectedReport.smPlatform}</span>
                        <StatusBadge type="audit" status={selectedReport.projectStatus} />
                        <StatusBadge type="submission" status={selectedReport.submissionStatus} />
                      </div>
                    </div>
                    <Link to={`/projects/${selectedReport.projectId}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
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
                        {loadingScores ? (
                          <SkeletonBlock className="h-6 w-10 my-0.5" />
                        ) : (
                          <p className={`font-mono text-xl font-semibold ${color} tabular-nums`}>{value}</p>
                        )}
                        <p className="text-2xs text-slate-400 mt-0.5">{label}</p>
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
                                  <p className="text-2xs text-slate-400 mt-0.5">
                                    {item?.category}{r.result === 'partially' ? ' · Partially compliant' : ' · Non-compliant'}
                                  </p>
                                  {r.findings && <p className="text-2xs text-rose-600 mt-1 leading-relaxed">{r.findings}</p>}
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
                                  <p className="text-2xs text-slate-400 mt-0.5">{item?.category}</p>
                                  {r.notes && <p className="text-2xs text-slate-500 mt-1 leading-relaxed">{r.notes}</p>}
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
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                      <SkeletonBlock className="h-3 w-24 bg-slate-200" />
                    </div>
                    <div className="divide-y divide-slate-50">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-5 px-6 py-4">
                          <div className="w-28 shrink-0 space-y-2">
                            <SkeletonBlock className="h-3.5 w-20" />
                            <SkeletonBlock className="h-2.5 w-12 bg-slate-100" />
                          </div>
                          <SkeletonBlock className="flex-1 h-2 rounded-full bg-slate-100" />
                        </div>
                      ))}
                    </div>
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
                            <p className="text-2xs text-slate-400 font-mono">{s.answeredItems}/{s.totalItems}</p>
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
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Project</p>
              <p className="font-semibold">{selectedReport.projectTitle}</p>
              <p className="text-sm text-slate-600">{selectedReport.smPlatform} · {selectedReport.projectStatus}</p>
              <p className="text-sm text-slate-600 mt-1">Lead: {selectedReport.headAuditorName}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Submission Status</p>
              <p className="font-semibold">{selectedReport.submissionStatus.replace('_', ' ')}</p>
              {selectedReport.submissionRemarks && <p className="text-sm text-slate-600 mt-1">{selectedReport.submissionRemarks}</p>}
            </div>
          </div>

          <div className="mb-6 p-4 border border-slate-200 rounded-xl">
            <p className="text-sm font-semibold mb-2">
              Overall Compliance Score:{' '}
              <span className={scoreColor(overallScore).text}>{formatPercent(overallScore)}%</span>
            </p>
            <p className="text-sm text-slate-600">{totalCompliant} compliant · {totalNonCompliant} non-compliant · {totalNA} not applicable · {totalItems - totalAnswered} pending</p>
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
                  <p className="text-xs font-semibold text-rose-600 uppercase tracking-wide mb-2">Failing ({failingResults.length})</p>
                  <ul className="space-y-2.5">
                    {failingResults.map((r) => {
                      const item = itemById.get(r.itemId)
                      return (
                        <li key={r.resultId} className="text-xs" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                          <p className="font-medium text-slate-800">{item?.itemName || item?.itemDescription || 'Checklist item'}</p>
                          <p className="text-slate-500">{item?.category}{r.result === 'partially' ? ' · Partially compliant' : ' · Non-compliant'}</p>
                          {r.findings && <p className="text-rose-600 mt-0.5">{r.findings}</p>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {naResults.length > 0 && (
                <div style={{ breakInside: 'avoid' }}>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Not Applicable ({naResults.length})</p>
                  <ul className="space-y-2.5">
                    {naResults.map((r) => {
                      const item = itemById.get(r.itemId)
                      return (
                        <li key={r.resultId} className="text-xs" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                          <p className="font-medium text-slate-800">{item?.itemName || item?.itemDescription || 'Checklist item'}</p>
                          <p className="text-slate-500">{item?.category}</p>
                          {r.notes && <p className="text-slate-600 mt-0.5">{r.notes}</p>}
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
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 font-semibold text-slate-600">Guideline</th>
                    <th className="text-right py-2 font-semibold text-slate-600">Score</th>
                    <th className="text-right py-2 font-semibold text-slate-600">Pass</th>
                    <th className="text-right py-2 font-semibold text-slate-600">Fail</th>
                    <th className="text-right py-2 font-semibold text-slate-600">N/A</th>
                    <th className="text-right py-2 font-semibold text-slate-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {complianceScores.map((s) => (
                    <tr key={s.guidelineId} className="border-b border-slate-100">
                      <td className="py-2">{s.guidelineName}</td>
                      <td className={`text-right py-2 font-mono ${scoreColor(s.scorePercentage ?? 0).text}`}>{formatPercent(s.scorePercentage ?? 0)}%</td>
                      <td className="text-right py-2 text-emerald-600">{s.compliantItems}</td>
                      <td className="text-right py-2 text-rose-600">{s.nonCompliantItems}</td>
                      <td className="text-right py-2 text-slate-500">{s.notApplicableItems}</td>
                      <td className="text-right py-2">{s.totalItems}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-8 text-xs text-slate-400">Generated by SafetyAudit</p>
        </div>
      )}

      {/* Print Confirmation Modal */}
      <Modal
        open={showPrintWarning}
        onClose={() => setShowPrintWarning(false)}
        size="sm"
        panelClassName="p-6"
        labelledBy="print-modal-title"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mx-auto mb-4">
          <Printer size={22} className="text-slate-500" />
        </div>
        <h3 id="print-modal-title" className="text-base font-bold text-slate-900 text-center mb-1">Print this report</h3>
        <p className="text-sm text-slate-500 text-center mb-6">
          This opens your browser's print dialog — choose "Save as PDF" there if you want a PDF file.
          {totalItems > 50 && ' This report has a lot of items, so the page may freeze for a few seconds while the print view is prepared.'}
        </p>
        <div className="flex gap-3">
          <Button variant="neutral" size="md" fullWidth onClick={() => setShowPrintWarning(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={handlePrint}>
            <Printer size={13} />
            Print
          </Button>
        </div>
      </Modal>
    </div>
  )
}

import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeftIcon as ArrowLeft,
  CheckCircleIcon as CheckCircle,
  XCircleIcon as XCircle,
  MinusCircleIcon as MinusCircle,
  NotePencilIcon as NotePencil,
  CaretRightIcon as CaretRight,
  FlagIcon as Flag,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  CheckIcon,
  XIcon,
  PencilSimpleIcon as PencilSimple,
  TrashIcon as Trash,
  UserPlusIcon as UserPlus,
  UserMinusIcon as UserMinus,
  WarningCircleIcon as WarningCircle,
  BookOpenIcon as BookOpen,
  ListChecksIcon as ListChecks,
  SpinnerIcon as Spinner,
  LockIcon as Lock,
  ImageIcon as Image,
  XCircleIcon as XCircleFill,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import { useProjectData } from '../hooks/useProjectData'
import type { ChecklistItemStatus, Severity } from '../types'
import SeverityBadge from '../components/ui/SeverityBadge'
import StatusBadge from '../components/ui/StatusBadge'
import AuditorAvatar from '../components/ui/AuditorAvatar'
import ScoreRing from '../components/ui/ScoreRing'

const AUDITOR_RESPONSE_OPTIONS: {
  value: ChecklistItemStatus; label: string; icon: typeof CheckCircle
  active: string; inactive: string
}[] = [
  { value: 'compliant', label: 'Pass', icon: CheckCircle,
    active: 'bg-emerald-600 text-white ring-emerald-600',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-emerald-300 hover:text-emerald-600' },
  { value: 'non_compliant', label: 'Fail', icon: XCircle,
    active: 'bg-rose-600 text-white ring-rose-600',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-rose-300 hover:text-rose-600' },
  { value: 'not_applicable', label: 'N/A', icon: MinusCircle,
    active: 'bg-slate-500 text-white ring-slate-500',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-400 hover:text-slate-600' },
]

const SEVERITY_OPTIONS: Severity[] = ['critical', 'major', 'minor']

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }
const rowVar = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 22 } } }

export default function AuditPage() {
  const { id } = useParams<{ id: string }>()
  const {
    projects, guidelines, users, currentUserId,
    setResponse, getProjectScore, getCategoryScore,
    submitForReview, reviewSubmission,
    addAuditorToProject, removeAuditorFromProject,
    updateChecklistItem, deleteChecklistItem,
    syncProjectGuidelines, syncProjectScope,
    updateProject,
  } = useStore()

  const { checklistItems, loading, reload } = useProjectData(id)
  // Read responses directly from the store so optimistic updates re-render immediately
  const responses = useStore((s) => s.responses)

  const project = projects.find((p) => p.id === id)
  const score = getProjectScore(id ?? '')
  const currentUser = users.find((u) => u.id === currentUserId)
  const isHeadAuditor = currentUser?.role === 'head_auditor'
  const isAuditor = currentUser?.role === 'auditor'
  const isAdmin = currentUser?.role === 'admin'

  const projectGuidelines = useMemo(
    () => guidelines.filter((g) => project?.guidelineIds.includes(g.id)),
    [guidelines, project],
  )

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of checklistItems) {
      if (!seen.has(item.category)) { seen.add(item.category); result.push(item.category) }
    }
    return result
  }, [checklistItems])

  const [activeTab, setActiveTab] = useState<'checklist' | 'guidelines' | 'scope'>('checklist')
  const [selectedCategory, setSelectedCategory] = useState<string>(() => categories[0] ?? '')
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})

  // Review panel state
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [reviewRemarks, setReviewRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Manage auditors
  const [showManageAuditors, setShowManageAuditors] = useState(false)

  // Edit checklist item
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editSeverity, setEditSeverity] = useState<Severity>('minor')
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null)

  // Manage Guidelines
  const [selectedGuidelineIds, setSelectedGuidelineIds] = useState<string[]>(project?.guidelineIds ?? [])
  const [savingGuidelines, setSavingGuidelines] = useState(false)

  // Manage Scope (features)
  const [scopeInput, setScopeInput] = useState('')
  const [scopeFeatures, setScopeFeatures] = useState<string[]>(project?.scope ?? [])
  const [savingScope, setSavingScope] = useState(false)

  // Edit project status — keep local state in sync with store
  const [projectStatus, setProjectStatus] = useState(project?.status ?? 'draft')
  useEffect(() => {
    if (project?.status && project.status !== projectStatus) {
      setProjectStatus(project.status)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.status])

  // Evidence images: itemId → array of { url, name }
  const [evidence, setEvidence] = useState<Record<string, { url: string; name: string }[]>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingEvidenceItemId, setPendingEvidenceItemId] = useState<string | null>(null)

  function handleImageClick(itemId: string) {
    setPendingEvidenceItemId(itemId)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !pendingEvidenceItemId) return
    const itemId = pendingEvidenceItemId
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        setEvidence((prev) => ({
          ...prev,
          [itemId]: [...(prev[itemId] ?? []), { url, name: file.name }],
        }))
      }
      reader.readAsDataURL(file)
    })
    setPendingEvidenceItemId(null)
  }

  function removeEvidence(itemId: string, index: number) {
    setEvidence((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).filter((_, i) => i !== index),
    }))
  }

  if (isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Lock size={20} className="text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Access Restricted</h2>
        <p className="text-slate-500 text-sm max-w-xs">Admins manage guidelines only and do not have access to audit projects.</p>
        <Link to="/guidelines" className="mt-4 text-blue-600 text-sm font-medium hover:text-blue-700 transition-colors">
          Go to Guidelines
        </Link>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <div className="text-center">
          <p className="text-slate-500 text-sm font-medium">Audit project not found.</p>
          <Link to="/projects" className="text-blue-600 text-sm mt-1 inline-block hover:text-blue-700">Back to projects</Link>
        </div>
      </div>
    )
  }

  const headAuditor = users.find((u) => u.id === project.headAuditorId)
  const auditors = project.auditorIds.map((uid) => users.find((u) => u.id === uid)).filter(Boolean) as typeof users
  const categoryItems = checklistItems.filter((ci) => ci.category === selectedCategory)

  const allAnswered = checklistItems.length > 0 && checklistItems.every((ci) => {
    const resp = responses[`${id}__${ci.id}`]
    return resp && resp.status !== 'not_started' && resp.status !== 'needs_review'
  })
  const canSubmit = isAuditor && allAnswered && project.submissionStatus === 'not_submitted' && project.status === 'in_progress'

  function getResponse(itemId: string) { return responses[`${id}__${itemId}`] }

  async function handleResponseClick(itemId: string, guidelineId: string, status: ChecklistItemStatus) {
    const current = getResponse(itemId)
    const notes = noteValues[itemId] ?? current?.notes ?? ''
    await setResponse(id!, itemId, guidelineId, status, notes)
  }

  function toggleNotes(itemId: string) {
    setExpandedNotes((prev) => { const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n })
  }

  async function handleNotesBlur(itemId: string, guidelineId: string) {
    const current = getResponse(itemId)
    const notes = noteValues[itemId] ?? ''
    if (current && current.status !== 'not_started') {
      await setResponse(id!, itemId, guidelineId, current.status, notes)
    }
  }

  async function handleSubmitForReview() {
    setSubmitting(true)
    try { await submitForReview(id!) } finally { setSubmitting(false) }
  }

  async function handleApprove() {
    setSubmitting(true)
    try { await reviewSubmission(id!, true, reviewRemarks); setShowReviewPanel(false) } finally { setSubmitting(false) }
  }

  async function handleReject() {
    setSubmitting(true)
    try { await reviewSubmission(id!, false, reviewRemarks); setShowReviewPanel(false) } finally { setSubmitting(false) }
  }

  function startEditItem(itemId: string, text: string, severity: Severity) {
    setEditingItemId(itemId); setEditText(text); setEditSeverity(severity)
  }

  async function saveEditItem() {
    if (!editingItemId) return
    await updateChecklistItem(editingItemId, { text: editText, severity: editSeverity })
    setEditingItemId(null)
    reload()
  }

  async function handleDeleteItem(itemId: string) {
    await deleteChecklistItem(itemId)
    setConfirmDeleteItemId(null)
    reload()
  }

  async function handleSaveGuidelines() {
    setSavingGuidelines(true)
    try {
      await syncProjectGuidelines(id!, selectedGuidelineIds)
      reload()
    } finally { setSavingGuidelines(false) }
  }

  async function handleSaveScope() {
    setSavingScope(true)
    try { await syncProjectScope(id!, scopeFeatures) } finally { setSavingScope(false) }
  }

  async function handleStatusChange(newStatus: typeof projectStatus) {
    setProjectStatus(newStatus)
    await updateProject(id!, { status: newStatus })
  }

  const availableToAdd = users.filter(
    (u) => u.role === 'auditor' && !project.auditorIds.includes(u.id),
  )

  return (
    <div className="flex flex-col min-h-full">
      {/* Top header */}
      <div className="border-b border-slate-200 bg-white px-4 md:px-8 pt-4 pb-4">
        <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-3 group">
          <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Audits
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">{project.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-medium">{project.platform}</span>
              {projectGuidelines.map((g) => (
                <span key={g.id} className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-medium">{g.shortName}</span>
              ))}
              <StatusBadge type="audit" status={project.status} />
              {project.submissionStatus !== 'not_submitted' && (
                <span className={[
                  'text-[10px] px-2 py-0.5 rounded-md font-medium border',
                  project.submissionStatus === 'approved' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : project.submissionStatus === 'rejected' ? 'text-rose-700 bg-rose-50 border-rose-200'
                  : 'text-amber-700 bg-amber-50 border-amber-200',
                ].join(' ')}>
                  {project.submissionStatus === 'pending_review' ? 'Pending Review'
                    : project.submissionStatus === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {isHeadAuditor && (
              <>
                <select
                  value={projectStatus}
                  onChange={(e) => handleStatusChange(e.target.value as typeof projectStatus)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="in_progress">In Progress</option>
                  <option value="under_review">Under Review</option>
                  <option value="completed">Completed</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowManageAuditors((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <UserPlus size={13} /> Manage Auditors
                </button>
              </>
            )}
            {isAuditor && project.submissionStatus === 'not_submitted' && (
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={handleSubmitForReview}
                title={!canSubmit ? 'Complete all checklist items before submitting' : ''}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? <Spinner size={13} className="animate-spin" /> : <PaperPlaneTilt size={13} />}
                Submit for Review
              </button>
            )}
            {isAuditor && project.submissionStatus === 'pending_review' && (
              <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
                <WarningCircle size={13} /> Pending Review
              </span>
            )}
          </div>
        </div>

        {project.notes && <p className="text-xs text-slate-400 mt-2 mb-2 max-w-xl leading-relaxed">{project.notes}</p>}

        {/* Metrics strip */}
        <div className="flex items-center gap-5 mt-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ScoreRing percentage={score.percentage} size={44} strokeWidth={4} showLabel={false} />
            <div>
              <p className="font-mono text-sm font-semibold text-slate-800 tabular-nums leading-none">{score.percentage.toFixed(1)}%</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Compliance</p>
            </div>
          </div>
          <div className="w-px h-8 bg-slate-200 hidden sm:block" />
          {[
            { value: score.answered, label: 'Answered', color: 'text-slate-700' },
            { value: score.compliant, label: 'Passing', color: 'text-emerald-600' },
            { value: score.nonCompliant, label: 'Failing', color: 'text-rose-500' },
          ].map(({ value, label, color }) => (
            <div key={label} className="text-center hidden sm:block">
              <p className={`font-mono text-sm font-semibold tabular-nums leading-none ${color}`}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
            </div>
          ))}
          <div className="w-px h-8 bg-slate-200 hidden md:block" />
          {auditors.length > 0 && (
            <div className="hidden md:flex items-center gap-2">
              <div className="flex items-center gap-1">{auditors.map((u) => <AuditorAvatar key={u.id} user={u} size="sm" />)}</div>
              {headAuditor && <p className="text-[11px] text-slate-400">Lead: {headAuditor.name.split(' ')[0]}</p>}
            </div>
          )}
          <div className="ml-auto hidden sm:flex items-center gap-2">
            <div className="relative h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-blue-500 rounded-full origin-left"
                style={{ transform: `scaleX(${score.progress / 100})`, transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums whitespace-nowrap">{score.answered}/{score.total} items</p>
          </div>
        </div>
      </div>

      {/* Review Submission Panel (head auditor) */}
      <AnimatePresence>
        {isHeadAuditor && project.submissionStatus === 'pending_review' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-amber-50 border-b border-amber-200 px-6 md:px-8 py-4">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800 mb-0.5">Audit Submitted for Review</p>
                <p className="text-xs text-amber-700">Review the findings and approve or reject this submission.</p>
              </div>
              <button type="button" onClick={() => setShowReviewPanel((v) => !v)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 transition-colors">
                {showReviewPanel ? 'Hide Review' : 'Review Submission'}
              </button>
            </div>
            <AnimatePresence>
              {showReviewPanel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-4">
                  <div className="bg-white border border-amber-200 rounded-xl p-5">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Review Remarks</label>
                    <textarea value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)}
                      placeholder="Provide feedback or reasons for your decision…" rows={3}
                      className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent" />
                    <div className="flex items-center gap-3 mt-4">
                      <button type="button" onClick={handleApprove} disabled={submitting}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                        <CheckIcon size={14} weight="bold" /> Approve
                      </button>
                      <button type="button" onClick={handleReject} disabled={submitting}
                        className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-60 transition-colors">
                        <XIcon size={14} weight="bold" /> Reject
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Approved/Rejected banners */}
      {project.submissionStatus === 'approved' && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 md:px-8 py-3 flex items-center gap-3">
          <CheckCircle size={16} className="text-emerald-600 shrink-0" weight="fill" />
          <div><span className="text-sm font-semibold text-emerald-800">Submission Approved</span>
            {project.submissionRemarks && <p className="text-xs text-emerald-700 mt-0.5">{project.submissionRemarks}</p>}</div>
        </div>
      )}
      {project.submissionStatus === 'rejected' && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 md:px-8 py-3 flex items-center gap-3">
          <XCircle size={16} className="text-rose-600 shrink-0" weight="fill" />
          <div><span className="text-sm font-semibold text-rose-800">Submission Rejected</span>
            {project.submissionRemarks && <p className="text-xs text-rose-700 mt-0.5">{project.submissionRemarks}</p>}</div>
        </div>
      )}

      {/* Manage Auditors Panel */}
      <AnimatePresence>
        {isHeadAuditor && showManageAuditors && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-slate-50 border-b border-slate-200 px-6 md:px-8 py-5">
            <p className="text-sm font-semibold text-slate-700 mb-4">Manage Auditors</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Assigned</p>
                <div className="space-y-2">
                  {auditors.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg">
                      <AuditorAvatar user={u} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{u.name}</p>
                        <p className="text-[11px] text-slate-400 capitalize">{u.role.replace('_', ' ')}</p>
                      </div>
                      {u.id !== project.headAuditorId && (
                        <button type="button" onClick={() => removeAuditorFromProject(id!, u.id)}
                          className="text-slate-400 hover:text-rose-500 transition-colors" title="Remove">
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {availableToAdd.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">Add Auditor</p>
                  <div className="space-y-2">
                    {availableToAdd.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg">
                        <AuditorAvatar user={u} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{u.name}</p>
                        </div>
                        <button type="button" onClick={() => addAuditorToProject(id!, u.id)}
                          className="text-slate-400 hover:text-blue-600 transition-colors" title="Add">
                          <UserPlus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab bar (head auditor: Checklist / Guidelines / Scope) */}
      {isHeadAuditor && (
        <div className="flex items-center gap-0 border-b border-slate-200 bg-white px-3 md:px-8 overflow-x-auto scrollbar-none">
          {[
            { key: 'checklist', label: 'Checklist', icon: ListChecks },
            { key: 'guidelines', label: 'Guidelines', icon: BookOpen },
            { key: 'scope', label: 'Scope / Features', icon: ListChecks },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} type="button"
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={[
                'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === key
                  ? 'border-blue-600 text-blue-700 bg-blue-50/40'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
              ].join(' ')}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}

      {/* Manage Guidelines tab */}
      {isHeadAuditor && activeTab === 'guidelines' && (
        <div className="px-8 py-8 max-w-2xl">
          <h2 className="text-base font-semibold text-slate-800 mb-1">Manage Guideline Used</h2>
          <p className="text-sm text-slate-500 mb-5">Select which regulatory guidelines apply to this audit project.</p>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white mb-4">
            {guidelines.map((g) => {
              const checked = selectedGuidelineIds.includes(g.id)
              return (
                <label key={g.id} className={['flex items-start gap-4 px-5 py-4 cursor-pointer transition-colors', checked ? 'bg-blue-50/60' : 'hover:bg-slate-50'].join(' ')}>
                  <input type="checkbox" className="sr-only" checked={checked}
                    onChange={() => setSelectedGuidelineIds((prev) => checked ? prev.filter((x) => x !== g.id) : [...prev, g.id])} />
                  <div className={['w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all', checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'].join(' ')}>
                    {checked && <CheckIcon size={11} weight="bold" className="text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${checked ? 'text-blue-800' : 'text-slate-800'}`}>{g.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{g.description}</p>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">v{g.version}</span>
                </label>
              )
            })}
          </div>
          <button type="button" onClick={handleSaveGuidelines} disabled={savingGuidelines}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {savingGuidelines ? <Spinner size={14} className="animate-spin" /> : <CheckIcon size={14} weight="bold" />}
            Save Guidelines
          </button>
        </div>
      )}

      {/* Manage Scope tab */}
      {isHeadAuditor && activeTab === 'scope' && (
        <div className="px-8 py-8 max-w-2xl">
          <h2 className="text-base font-semibold text-slate-800 mb-1">Manage Audit Features / Scope</h2>
          <p className="text-sm text-slate-500 mb-5">Define which features or functions of the social media app are in scope for this audit.</p>
          <div className="flex gap-2 mb-4">
            <input value={scopeInput} onChange={(e) => setScopeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && scopeInput.trim()) { setScopeFeatures((p) => [...p, scopeInput.trim()]); setScopeInput('') } }}
              placeholder="e.g. Login, Data Sharing, Privacy Settings…"
              className="flex-1 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent" />
            <button type="button"
              onClick={() => { if (scopeInput.trim()) { setScopeFeatures((p) => [...p, scopeInput.trim()]); setScopeInput('') } }}
              className="px-4 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors">
              Add
            </button>
          </div>
          {scopeFeatures.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {scopeFeatures.map((f) => (
                <span key={f} className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg">
                  {f}
                  <button type="button" onClick={() => setScopeFeatures((p) => p.filter((x) => x !== f))}
                    className="text-slate-400 hover:text-rose-500 transition-colors"><XIcon size={11} weight="bold" /></button>
                </span>
              ))}
            </div>
          )}
          {scopeFeatures.length === 0 && <p className="text-sm text-slate-400 mb-5">No features defined yet. Add features above.</p>}
          <button type="button" onClick={handleSaveScope} disabled={savingScope}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {savingScope ? <Spinner size={14} className="animate-spin" /> : <CheckIcon size={14} weight="bold" />}
            Save Scope
          </button>
        </div>
      )}

      {/* Checklist view */}
      {(!isHeadAuditor || activeTab === 'checklist') && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Mobile: category select dropdown */}
          <div className="md:hidden px-4 py-3 bg-white border-b border-slate-200 shrink-0">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {categories.map((cat) => {
                const cs = getCategoryScore(id!, cat)
                return (
                  <option key={cat} value={cat}>
                    {cat}{cs.applicable > 0 ? ` — ${cs.percentage.toFixed(0)}%` : ''}
                  </option>
                )
              })}
            </select>
          </div>

        <div className="flex flex-1 min-h-0">
          {/* Desktop: Left category nav */}
          <nav className="hidden md:block w-64 shrink-0 border-r border-slate-200 bg-slate-50/50 overflow-y-auto py-5 px-3">
            <p className="text-xs text-slate-400 font-mono tracking-widest uppercase px-2 mb-3">Categories</p>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size={20} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <ul className="space-y-0.5 list-none m-0 p-0">
                {categories.map((cat) => {
                  const catScore = getCategoryScore(id!, cat)
                  const active = cat === selectedCategory
                  const barColor = catScore.percentage >= 80 ? 'bg-emerald-500' : catScore.percentage >= 60 ? 'bg-amber-400' : catScore.percentage > 0 ? 'bg-rose-400' : 'bg-slate-300'
                  return (
                    <li key={cat}>
                      <button type="button" onClick={() => setSelectedCategory(cat)}
                        className={['w-full text-left px-3 py-3 rounded-lg transition-colors', active ? 'bg-white shadow-sm border border-slate-200' : 'hover:bg-white/70'].join(' ')}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-medium leading-tight ${active ? 'text-slate-800' : 'text-slate-600'}`}>{cat}</span>
                          {active && <CaretRight size={11} className="text-slate-400 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="relative h-1 flex-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`absolute inset-y-0 left-0 rounded-full origin-left ${barColor}`}
                              style={{ transform: `scaleX(${Math.min(catScore.percentage, 100) / 100})`, transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums w-8 text-right shrink-0">
                            {catScore.applicable > 0 ? `${catScore.percentage.toFixed(0)}%` : '—'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">{catScore.answered}/{catScore.total}</p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </nav>

          {/* Right: items */}
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div key={selectedCategory} variants={container} initial="hidden" animate="show" className="px-8 py-8 max-w-4xl">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold text-slate-800 tracking-tight">{selectedCategory || 'Select a category'}</h2>
                  <p className="text-sm text-slate-400 font-mono">{categoryItems.length} item{categoryItems.length !== 1 ? 's' : ''}</p>
                </div>

                {isHeadAuditor && (
                  <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-5">
                    You can edit or delete checklist items. Responses are recorded by assigned auditors.
                  </p>
                )}

                {/* Hidden file input for evidence images (shared across all items) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={handleFileChange}
                />

                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <Spinner size={28} className="animate-spin text-slate-300" />
                  </div>
                ) : categoryItems.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-slate-400 text-sm">No checklist items in this category.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden">
                    {categoryItems.map((ci) => {
                      const resp = getResponse(ci.id)
                      const currentStatus = resp?.status ?? 'not_started'
                      const notesOpen = expandedNotes.has(ci.id)
                      const currentNotes = noteValues[ci.id] ?? resp?.notes ?? ''
                      const isEditing = editingItemId === ci.id
                      const isConfirmingDelete = confirmDeleteItemId === ci.id

                      return (
                        <motion.div key={ci.id} variants={rowVar} className="px-6 py-5">
                          {isEditing ? (
                            <div className="space-y-3">
                              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                                className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent" />
                              <div className="flex items-center gap-3">
                                <select value={editSeverity} onChange={(e) => setEditSeverity(e.target.value as Severity)}
                                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-slate-50">
                                  {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                                </select>
                                <button type="button" onClick={saveEditItem}
                                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                                  <CheckIcon size={12} weight="bold" /> Save
                                </button>
                                <button type="button" onClick={() => setEditingItemId(null)}
                                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors">
                                  <XIcon size={12} weight="bold" /> Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <SeverityBadge severity={ci.severity} />
                                  {ci.reference && <span className="text-[10px] text-slate-400 font-mono">{ci.reference}</span>}
                                  {currentStatus === 'needs_review' && (
                                    <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium">
                                      <Flag size={9} weight="fill" /> Flagged
                                    </span>
                                  )}
                                </div>
                                <p className="text-base text-slate-800 leading-relaxed">{ci.text}</p>
                              </div>
                              {isHeadAuditor && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button type="button" onClick={() => startEditItem(ci.id, ci.text, ci.severity)}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                                    <PencilSimple size={14} />
                                  </button>
                                  <button type="button" onClick={() => setConfirmDeleteItemId(ci.id)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                                    <Trash size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {isConfirmingDelete && (
                            <div className="mt-3 flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
                              <p className="text-xs text-rose-700 flex-1">Delete this checklist item permanently?</p>
                              <button type="button" onClick={() => handleDeleteItem(ci.id)}
                                className="px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-lg hover:bg-rose-700 transition-colors">Delete</button>
                              <button type="button" onClick={() => setConfirmDeleteItemId(null)}
                                className="px-3 py-1.5 bg-white text-slate-600 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">Cancel</button>
                            </div>
                          )}

                          {/* Auditor response controls (14.2, 14.3) */}
                          {isAuditor && !isEditing && (
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              {AUDITOR_RESPONSE_OPTIONS.map(({ value, label, icon: Icon, active, inactive }) => {
                                const isActive = currentStatus === value
                                return (
                                  <motion.button key={value} type="button" whileTap={{ scale: 0.97 }}
                                    onClick={() => handleResponseClick(ci.id, ci.guidelineId, value)}
                                    className={['flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ring-1 transition-all', isActive ? active : inactive].join(' ')}>
                                    <Icon size={15} weight={isActive ? 'fill' : 'regular'} /> {label}
                                  </motion.button>
                                )
                              })}
                              {/* Flag for Review */}
                              <motion.button type="button" whileTap={{ scale: 0.97 }}
                                onClick={() => handleResponseClick(ci.id, ci.guidelineId, 'needs_review')}
                                className={['flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ring-1 transition-all',
                                  currentStatus === 'needs_review'
                                    ? 'bg-amber-500 text-white ring-amber-500'
                                    : 'bg-white text-slate-500 ring-slate-200 hover:ring-amber-300 hover:text-amber-600',
                                ].join(' ')}>
                                <Flag size={15} weight={currentStatus === 'needs_review' ? 'fill' : 'regular'} /> Flag
                              </motion.button>
                              {/* Notes + Evidence buttons */}
                              <div className="flex items-center gap-2 ml-auto">
                                <button type="button" onClick={() => toggleNotes(ci.id)}
                                  className={['flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ring-1 transition-colors',
                                    notesOpen || currentNotes ? 'ring-blue-200 text-blue-600 bg-blue-50' : 'ring-slate-200 text-slate-400 hover:text-slate-600 bg-white',
                                  ].join(' ')}>
                                  <NotePencil size={13} weight={currentNotes ? 'fill' : 'regular'} />
                                  {currentNotes ? 'Notes' : 'Add note'}
                                </button>
                                <button type="button" onClick={() => handleImageClick(ci.id)}
                                  title="Attach image as evidence"
                                  className={['flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ring-1 transition-colors',
                                    (evidence[ci.id]?.length ?? 0) > 0 ? 'ring-violet-200 text-violet-600 bg-violet-50' : 'ring-slate-200 text-slate-400 hover:text-violet-600 hover:ring-violet-300 bg-white',
                                  ].join(' ')}>
                                  <Image size={13} weight={(evidence[ci.id]?.length ?? 0) > 0 ? 'fill' : 'regular'} />
                                  {(evidence[ci.id]?.length ?? 0) > 0 ? `${evidence[ci.id].length} photo${evidence[ci.id].length > 1 ? 's' : ''}` : 'Add photo'}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Head auditor: read-only result badge */}
                          {isHeadAuditor && !isEditing && currentStatus !== 'not_started' && (
                            <div className="mt-3 flex items-center gap-2">
                              <span className={['flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ring-1',
                                currentStatus === 'compliant' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                : currentStatus === 'non_compliant' ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                : currentStatus === 'not_applicable' ? 'bg-slate-100 text-slate-600 ring-slate-200'
                                : 'bg-amber-50 text-amber-700 ring-amber-200',
                              ].join(' ')}>
                                {currentStatus === 'compliant' && <CheckCircle size={12} weight="fill" />}
                                {currentStatus === 'non_compliant' && <XCircle size={12} weight="fill" />}
                                {currentStatus === 'not_applicable' && <MinusCircle size={12} weight="fill" />}
                                {currentStatus === 'needs_review' && <Flag size={12} weight="fill" />}
                                {currentStatus === 'compliant' ? 'Pass' : currentStatus === 'non_compliant' ? 'Fail' : currentStatus === 'not_applicable' ? 'N/A' : 'Flagged'}
                              </span>
                            </div>
                          )}

                          {/* Notes input */}
                          {isAuditor && (
                            <AnimatePresence>
                              {notesOpen && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 28 }} className="overflow-hidden">
                                  <textarea value={currentNotes}
                                    onChange={(e) => setNoteValues((prev) => ({ ...prev, [ci.id]: e.target.value }))}
                                    onBlur={() => handleNotesBlur(ci.id, ci.guidelineId)}
                                    placeholder="Record observations, evidence references, or remediation notes…" rows={3}
                                    className="mt-3 w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed" />
                                </motion.div>
                              )}
                            </AnimatePresence>
                          )}

                          {!notesOpen && currentNotes && (
                            <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-md px-3 py-2 border border-slate-100 leading-relaxed max-w-[65ch]">{currentNotes}</p>
                          )}

                          {/* Evidence image previews */}
                          {isAuditor && (evidence[ci.id]?.length ?? 0) > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {evidence[ci.id].map((img, idx) => (
                                <div key={idx} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                                  <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => removeEvidence(ci.id, idx)}
                                    className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full shadow"
                                    title="Remove"
                                  >
                                    <XCircleFill size={16} className="text-rose-500" weight="fill" />
                                  </button>
                                  <p className="absolute bottom-0 left-0 right-0 text-[9px] text-white bg-black/50 px-1 py-0.5 truncate">{img.name}</p>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => handleImageClick(ci.id)}
                                className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-violet-400 hover:text-violet-500 transition-colors shrink-0"
                              >
                                <Image size={18} />
                              </button>
                            </div>
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
      )}
    </div>
  )
}

import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeftIcon as ArrowLeft,
  CheckCircleIcon as CheckCircle,
  XCircleIcon as XCircle,
  MinusCircleIcon as MinusCircle,
  CircleHalfIcon as CircleHalf,
  NotePencilIcon as NotePencil,
  CaretRightIcon as CaretRight,
  FlagIcon as Flag,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  CheckIcon,
  XIcon,
  PencilSimpleIcon as PencilSimple,
  TrashIcon as Trash,
  UserPlusIcon as UserPlus,
  MagnifyingGlassIcon as MagnifyingGlass,
  WarningCircleIcon as WarningCircle,
  BookOpenIcon as BookOpen,
  ListChecksIcon as ListChecks,
  SpinnerIcon as Spinner,
  LockIcon as Lock,
  ImageIcon as Image,
  XCircleIcon as XCircleFill,
  PlusIcon as Plus,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import { useProjectData } from '../../../hooks/useProjectData'
import type { ChecklistItemStatus, Severity, ChecklistItem, ProjectScore } from '../../../types'
import SeverityBadge from '../../audits/components/SeverityBadge'
import StatusBadge from '../../audits/components/StatusBadge'
import AuditorAvatar from '../../../components/ui/AuditorAvatar'
import ScoreRing from '../../audits/components/ScoreRing'

const AUDITOR_RESPONSE_OPTIONS: {
  value: ChecklistItemStatus; label: string; icon: typeof CheckCircle
  active: string; inactive: string
}[] = [
  { value: 'compliant', label: 'Yes', icon: CheckCircle,
    active: 'bg-emerald-600 text-white ring-emerald-600',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-emerald-300 hover:text-emerald-600' },
  { value: 'non_compliant', label: 'No', icon: XCircle,
    active: 'bg-rose-600 text-white ring-rose-600',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-rose-300 hover:text-rose-600' },
  { value: 'partially', label: 'Partially', icon: CircleHalf,
    active: 'bg-amber-500 text-white ring-amber-500',
    inactive: 'bg-white text-slate-500 ring-slate-200 hover:ring-amber-300 hover:text-amber-600' },
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
    setResponse, saveFindings,
    submitForReview, reviewSubmission,
    addAuditorToProject, removeAuditorFromProject,
    updateChecklistItem, deleteChecklistItem,
    syncProjectGuidelines, syncProjectScope,
    updateProject, deleteProject,
    addChecklistItem, toggleProjectChecklistCategory,
  } = useStore()
  const navigate = useNavigate()

  const { checklistItems, loading, reload } = useProjectData(id)
  const storeLoading = useStore((s) => s.loading)
  // Read responses directly from the store so optimistic updates re-render immediately
  const responses = useStore((s) => s.responses)


  const project = projects.find((p) => p.id === id)

  // Compute score from project-specific items (correct IDs) + store responses (incl. optimistic)
  const score = useMemo(() => {
    const total = checklistItems.length
    let compliant = 0, nonCompliant = 0, notApplicable = 0, answered = 0, weightedCompliant = 0
    for (const item of checklistItems) {
      const resp = responses[`${id}__${item.id}`]
      if (!resp || resp.status === 'not_started' || resp.status === 'needs_review') continue
      answered++
      if (resp.status === 'compliant') { compliant++; weightedCompliant += 1 }
      else if (resp.status === 'partially') { nonCompliant++; weightedCompliant += 0.5 }
      else if (resp.status === 'non_compliant') nonCompliant++
      else if (resp.status === 'not_applicable') notApplicable++
    }
    const applicable = answered - notApplicable
    const localPct = applicable > 0 ? Math.round((weightedCompliant / applicable) * 1000) / 10 : 0
    // Use local computation — it's derived from project-specific item IDs and optimistic responses
    const percentage = localPct
    const progress = total > 0 ? Math.round((answered / total) * 100) : 0
    return { total, compliant, nonCompliant, notApplicable, answered, applicable, percentage, progress }
  }, [checklistItems, responses, id])
  const currentUser = users.find((u) => u.id === currentUserId)
  const isHeadAuditor = currentUser?.role === 'head_auditor'
  const isAuditor = currentUser?.role === 'auditor'
  const isAdmin = currentUser?.role === 'admin'

  const projectGuidelines = useMemo(
    () => guidelines.filter((g) => project?.guidelineIds.includes(g.id)),
    [guidelines, project],
  )

  const allCategories = useMemo(() => {
    const seen = new Set<string>()
    const result: { category: string; guidelineId: string; enabled: boolean }[] = []
    for (const g of projectGuidelines) {
      for (const cat of g.categories || []) {
        if (!seen.has(cat)) {
          seen.add(cat)
          const isEnabled = checklistItems.some((ci) => ci.category === cat && ci.guidelineId === g.id)
          result.push({
            category: cat,
            guidelineId: g.id,
            enabled: isEnabled
          })
        }
      }
    }
    return result
  }, [projectGuidelines, checklistItems])

  const categories = useMemo(() => {
    if (isHeadAuditor) {
      return allCategories.map((c) => c.category)
    } else {
      return allCategories.filter((c) => c.enabled).map((c) => c.category)
    }
  }, [allCategories, isHeadAuditor])

  const [selectedCategory, setSelectedCategory] = useState<string>(() => categories[0] ?? '')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  const sections = useMemo(() => {
    const map: Record<string, {
      sectionName: string
      subcategories: {
        subcategoryName: string
        originalCategory: string
        enabled: boolean
        catScore: ProjectScore
        guidelineId: string
      }[]
      enabledCount: number
    }> = {}

    for (const cat of categories) {
      const parts = cat.split(' > ')
      const sectionName = parts[0]
      const subcategoryName = parts.length > 1 ? parts.slice(1).join(' > ') : sectionName
      const catConfig = allCategories.find((c) => c.category === cat)
      const isEnabled = catConfig?.enabled ?? false
      const guidelineId = catConfig?.guidelineId ?? ''

      // Compute per-category score from project-specific items (correct IDs)
      const catItems = checklistItems.filter((ci) => ci.category === cat && ci.guidelineId === guidelineId)
      let c_comp = 0, c_nc = 0, c_na = 0, c_ans = 0, c_w = 0
      for (const item of catItems) {
        const resp = responses[`${id}__${item.id}`]
        if (!resp || resp.status === 'not_started' || resp.status === 'needs_review') continue
        c_ans++
        if (resp.status === 'compliant') { c_comp++; c_w += 1 }
        else if (resp.status === 'partially') { c_nc++; c_w += 0.5 }
        else if (resp.status === 'non_compliant') c_nc++
        else if (resp.status === 'not_applicable') c_na++
      }
      const c_app = c_ans - c_na
      const catScore: ProjectScore = {
        total: catItems.length,
        compliant: c_comp,
        nonCompliant: c_nc,
        notApplicable: c_na,
        answered: c_ans,
        applicable: c_app,
        percentage: c_app > 0 ? Math.round((c_w / c_app) * 1000) / 10 : 0,
        progress: catItems.length > 0 ? Math.round((c_ans / catItems.length) * 100) : 0,
      }

      if (!map[sectionName]) {
        map[sectionName] = {
          sectionName,
          subcategories: [],
          enabledCount: 0,
        }
      }

      if (isEnabled) {
        map[sectionName].enabledCount++
      }

      map[sectionName].subcategories.push({
        subcategoryName,
        originalCategory: cat,
        enabled: isEnabled,
        catScore,
        guidelineId,
      })
    }

    return Object.values(map)
  }, [categories, allCategories, id, checklistItems, responses])

  useEffect(() => {
    if (selectedCategory) {
      const sectionName = selectedCategory.split(' > ')[0]
      setExpandedSections((prev) => {
        const next = new Set(prev)
        next.add(sectionName)
        return next
      })
    }
  }, [selectedCategory])

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(selectedCategory)) {
      setSelectedCategory(categories[0])
    }
  }, [categories, selectedCategory])

  const [activeTab, setActiveTab] = useState<'checklist' | 'guidelines' | 'scope'>('checklist')
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [newItemText, setNewItemText] = useState('')
  const [newItemSeverity, setNewItemSeverity] = useState<Severity>('minor')
  const [newItemReference, setNewItemReference] = useState('')
  const [newItemHelp, setNewItemHelp] = useState('')
  const [newItemTrace, setNewItemTrace] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [addItemError, setAddItemError] = useState<string | null>(null)

  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [findingsValues, setFindingsValues] = useState<Record<string, string>>({})

  // Review panel state
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [reviewRemarks, setReviewRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Manage auditors
  const [showManageAuditors, setShowManageAuditors] = useState(false)
  const [auditorSearchQuery, setAuditorSearchQuery] = useState('')

  // Delete project
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Edit checklist item
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [selectedItemForModal, setSelectedItemForModal] = useState<ChecklistItem | null>(null)
  const [itemModalTab, setItemModalTab] = useState<'help' | 'traceability'>('help')

  const [editText, setEditText] = useState('')
  const [editSeverity, setEditSeverity] = useState<Severity>('minor')
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null)

  // Manage Guidelines
  const [selectedGuidelineIds, setSelectedGuidelineIds] = useState<string[]>(() => {
    return (project?.guidelineIds ?? []).map(id => {
      const g = guidelines.find(x => x.id === id)
      return g?.originalGuidelineId || id
    })
  })

  // Sync selectedGuidelineIds when project loads/updates
  useEffect(() => {
    if (project?.guidelineIds) {
      setSelectedGuidelineIds(
        project.guidelineIds.map(id => {
          const g = guidelines.find(x => x.id === id)
          return g?.originalGuidelineId || id
        })
      )
    }
  }, [project?.guidelineIds, guidelines])

  const projectManageGuidelines = useMemo(() => {
    const usedGlobalGuidelineIds = (project?.guidelineIds ?? []).map(id => {
      const g = guidelines.find(x => x.id === id)
      return g?.originalGuidelineId || id
    })
    
    return guidelines.filter(g => {
      if (g.projectId) return false
      return !g.isDeleted || usedGlobalGuidelineIds.includes(g.id)
    })
  }, [guidelines, project?.guidelineIds])

  const [savingGuidelines, setSavingGuidelines] = useState(false)
  const [showManageGuidelines, setShowManageGuidelines] = useState(false)
  const [activeGuidelineTab, setActiveGuidelineTab] = useState<string>(project?.guidelineIds[0] ?? '')

  // Manage Scope (features)
  const [scopeInput, setScopeInput] = useState('')
  const [scopeFeatures, setScopeFeatures] = useState<string[]>(project?.scope ?? [])

  useEffect(() => {
    if (project?.scope) {
      setScopeFeatures(project.scope)
    }
  }, [project?.scope])
  const [savingScope, setSavingScope] = useState(false)



  // Sync activeGuidelineTab when project loads (guidelineIds[0] may be empty on first render)
  useEffect(() => {
    if (projectGuidelines.length > 0 && !projectGuidelines.find((g) => g.id === activeGuidelineTab)) {
      setActiveGuidelineTab(projectGuidelines[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectGuidelines.length])

  // Checklist items scoped to the active guideline tab
  const guidelineItems = useMemo(
    () => activeGuidelineTab
      ? checklistItems.filter((ci) => ci.guidelineId === activeGuidelineTab)
      : checklistItems,
    [checklistItems, activeGuidelineTab],
  )

  // Sidebar sections scoped to the active guideline tab
  const guidelineSections = useMemo(
    () => sections
      .map((section) => ({
        ...section,
        subcategories: section.subcategories.filter((sub) => sub.guidelineId === activeGuidelineTab),
      }))
      .filter((section) => section.subcategories.length > 0),
    [sections, activeGuidelineTab],
  )

  // Reset selected category to first category of the new guideline tab
  useEffect(() => {
    const firstCat = guidelineSections[0]?.subcategories[0]?.originalCategory ?? ''
    setSelectedCategory(firstCat)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGuidelineTab])

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
    if (storeLoading) {
      return (
        <div className="flex items-center justify-center min-h-[100dvh]">
          <Spinner size={28} className="animate-spin text-slate-300" />
        </div>
      )
    }
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
  const categoryItems = guidelineItems.filter((ci) => ci.category === selectedCategory)

  // Map project cloned guidelineIds back to original IDs for comparison
  const projectOriginalGuidelineIds = (project.guidelineIds ?? []).map((gid) => {
    const g = guidelines.find((x) => x.id === gid)
    return g?.originalGuidelineId || gid
  })
  const guidelinesDirty =
    selectedGuidelineIds.length !== projectOriginalGuidelineIds.length ||
    selectedGuidelineIds.some((gid) => !projectOriginalGuidelineIds.includes(gid))

  // Auditors only see enabled categories — only check those items for submission readiness
  const enabledCategoryKeys = new Set(
    allCategories.filter((c) => c.enabled).map((c) => `${c.guidelineId}__${c.category}`)
  )
  const submittableItems = isAuditor
    ? checklistItems.filter((ci) => enabledCategoryKeys.has(`${ci.guidelineId}__${ci.category}`))
    : checklistItems
  const allAnswered = submittableItems.length > 0 && submittableItems.every((ci) => {
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

  async function handleFindingsBlur(itemId: string) {
    const findings = findingsValues[itemId] ?? ''
    await saveFindings(id!, itemId, findings)
  }

  async function handleAddItem() {
    if (!newItemText.trim() || !selectedCategory) return
    setAddingItem(true)
    setAddItemError(null)
    try {
      const catConfig = allCategories.find((c) => c.category === selectedCategory)
      const guidelineId = catConfig?.guidelineId || project?.guidelineIds?.[0]
      if (!guidelineId) {
        throw new Error('No guideline associated with this category or project.')
      }
      
      await addChecklistItem(id!, {
        category: selectedCategory,
        text: newItemText,
        severity: newItemSeverity,
        reference: newItemReference || undefined,
helpText: newItemHelp.trim() || undefined,
        verbatimClauseText: newItemTrace.trim() || undefined,

        guidelineId
      })
      
      setNewItemText('')
      setNewItemSeverity('minor')
      setNewItemReference('')
      setNewItemHelp('')
      setNewItemTrace('')
      setShowAddItemModal(false)
      reload()
    } catch (err) {
      setAddItemError(String(err))
    } finally {
      setAddingItem(false)
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

  async function handleDeleteProject() {
    setDeleting(true)
    try {
      await deleteProject(id!)
      navigate('/projects')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
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
                <button
                  type="button"
                  onClick={() => setShowManageAuditors((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <UserPlus size={13} /> Manage Auditors
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors"
                >
                  <Trash size={13} /> Delete Project
                </button>
              </>
            )}
            {isAuditor && project.submissionStatus === 'not_submitted' && (
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={handleSubmitForReview}
                title={!canSubmit ? `${submittableItems.filter((ci) => { const r = responses[`${id}__${ci.id}`]; return !r || r.status === 'not_started' || r.status === 'needs_review' }).length} item(s) still need a response` : ''}
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
              <p className="font-sans text-sm font-semibold text-slate-800 tabular-nums leading-none">{score.percentage.toFixed(1)}%</p>
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
              <p className={`font-sans text-sm font-semibold tabular-nums leading-none ${color}`}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
            </div>
          ))}
          <div className="ml-auto hidden sm:flex items-center gap-2">
            <div className="relative h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-blue-500 rounded-full origin-left"
                style={{ transform: `scaleX(${score.progress / 100})`, transition: 'transform 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
            </div>
            <p className="text-[11px] text-slate-400 font-sans tabular-nums whitespace-nowrap">{score.answered}/{score.total} items</p>
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

            {/* Search to add */}
            <div className="relative mb-4">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-lg">
                <MagnifyingGlass size={14} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={auditorSearchQuery}
                  onChange={(e) => setAuditorSearchQuery(e.target.value)}
                  placeholder="Search auditor to add…"
                  className="flex-1 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none bg-transparent"
                />
                {auditorSearchQuery && (
                  <button type="button" onClick={() => setAuditorSearchQuery('')}
                    className="text-slate-400 hover:text-slate-600 transition-colors">
                    <XIcon size={12} weight="bold" />
                  </button>
                )}
              </div>
              {auditorSearchQuery && (
                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                  {availableToAdd.filter((u) => u.name.toLowerCase().includes(auditorSearchQuery.toLowerCase())).length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-400">No auditors match "{auditorSearchQuery}"</p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                      {availableToAdd
                        .filter((u) => u.name.toLowerCase().includes(auditorSearchQuery.toLowerCase()))
                        .map((u) => (
                          <li key={u.id}>
                            <button type="button"
                              onClick={() => { addAuditorToProject(id!, u.id); setAuditorSearchQuery('') }}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left">
                              <AuditorAvatar user={u} size="sm" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-700 truncate">{u.name}</p>
                              </div>
                              <UserPlus size={14} className="text-blue-500 shrink-0" />
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Assigned auditors */}
            <div className="space-y-2">
              {auditors.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg">
                  <AuditorAvatar user={u} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{u.name}</p>
                    <p className="text-[11px] text-slate-400 capitalize">
                      {u.role.replace('_', ' ')}
                      {u.id === project.headAuditorId && <span className="ml-1 text-blue-500">· Head Auditor</span>}
                    </p>
                  </div>
                  {u.id !== project.headAuditorId && (
                    <button type="button" onClick={() => removeAuditorFromProject(id!, u.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors" title="Remove">
                      <Trash size={14} />
                    </button>
                  )}
                </div>
              ))}
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

        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <div className="px-8 py-8 w-full max-w-5xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-base font-semibold text-slate-800 mb-1">Guidelines in Use</h2>
                <p className="text-sm text-slate-500">Regulatory frameworks applied to this audit project.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {guidelinesDirty && (
                  <button type="button" onClick={handleSaveGuidelines} disabled={savingGuidelines}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
                    {savingGuidelines ? <Spinner size={13} className="animate-spin" /> : <CheckIcon size={13} weight="bold" />}
                    Save Changes
                  </button>
                )}
                <button type="button"
                  onClick={() => setShowManageGuidelines((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                  <Plus size={13} /> {showManageGuidelines ? 'Done' : 'Manage Guidelines'}
                </button>
              </div>
            </div>

            {/* Currently selected guidelines */}
            {selectedGuidelineIds.length === 0 ? (
              <p className="text-sm text-slate-400 py-10 text-center border border-dashed border-slate-200 rounded-xl mb-6">
                No guidelines selected. Click "Manage Guidelines" to add some.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white mb-6">
                {guidelines
                  .filter((g) => selectedGuidelineIds.includes(g.id))
                  .map((g) => (
                    <div key={g.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{g.description}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">v{g.version}</span>
                        <button type="button"
                          onClick={() => { setActiveGuidelineTab(g.id); setActiveTab('checklist') }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
                          <ListChecks size={12} /> Edit Checklist
                        </button>
                        <button type="button"
                          onClick={() => setSelectedGuidelineIds((prev) => prev.filter((x) => x !== g.id))}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors" title="Remove">
                          <XIcon size={14} weight="bold" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Add guidelines panel */}
            <AnimatePresence>
              {showManageGuidelines && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Add Guidelines</p>
                  {guidelines.filter((g) => !g.isDeleted && !selectedGuidelineIds.includes(g.id)).length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-xl">
                      All available guidelines are already selected.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                      {guidelines
                        .filter((g) => !g.isDeleted && !selectedGuidelineIds.includes(g.id))
                        .map((g) => (
                          <label key={g.id} className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors">
                            <input type="checkbox" className="sr-only"
                              onChange={() => setSelectedGuidelineIds((prev) => [...prev, g.id])} />
                            <div className="w-5 h-5 rounded border-2 border-slate-300 bg-white flex items-center justify-center shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                              <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{g.description}</p>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded shrink-0">v{g.version}</span>
                          </label>
                        ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

          </div>
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
          {/* Guideline tabs — one per selected guideline, visible to all roles */}
          {projectGuidelines.length > 0 && (
            <div className="border-b border-slate-200 bg-white px-3 md:px-8 flex items-center gap-0 overflow-x-auto scrollbar-none shrink-0">
              {projectGuidelines.map((g) => (
                <button key={g.id} type="button"
                  onClick={() => setActiveGuidelineTab(g.id)}
                  className={[
                    'px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
                    activeGuidelineTab === g.id
                      ? 'border-blue-600 text-blue-700 bg-blue-50/40'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                  ].join(' ')}>
                  {g.shortName}
                </button>
              ))}
            </div>
          )}
          {/* Mobile: category select dropdown */}
          <div className="md:hidden px-4 py-3 bg-white border-b border-slate-200 shrink-0">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {guidelineSections.map((section) => (
                <optgroup key={section.sectionName} label={section.sectionName}>
                  {section.subcategories.map((sub) => {
                    const cs = sub.catScore
                    return (
                      <option key={sub.originalCategory} value={sub.originalCategory}>
                        {sub.subcategoryName}{!sub.enabled && isHeadAuditor ? ' (Deactivated)' : cs.applicable > 0 ? ` — ${cs.percentage.toFixed(0)}%` : ''}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
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
              <ul className="space-y-3 list-none m-0 p-0">
                {guidelineSections.map((section) => {
                  const isExpanded = expandedSections.has(section.sectionName)
                  
                  return (
                    <li key={section.sectionName} className="space-y-1">
                      {/* Section Header Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedSections((prev) => {
                            const next = new Set(prev)
                            if (next.has(section.sectionName)) {
                              next.delete(section.sectionName)
                            } else {
                              next.add(section.sectionName)
                            }
                            return next
                          })
                        }}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors uppercase tracking-wider"
                      >
                        <span className="truncate pr-2">{section.sectionName}</span>
                        <CaretRight
                          size={12}
                          className={["transform transition-transform text-slate-400 shrink-0", isExpanded ? "rotate-90" : ""].join(' ')}
                        />
                      </button>

                      {/* Subcategories (Only visible if expanded) */}
                      {isExpanded && (
                        <ul className="pl-2 space-y-1 border-l border-slate-200 ml-1.5 list-none">
                          {section.subcategories.map((sub) => {
                            const active = sub.originalCategory === selectedCategory
                            const barColor = sub.catScore.percentage >= 80 ? 'bg-emerald-500' : sub.catScore.percentage >= 60 ? 'bg-amber-400' : sub.catScore.percentage > 0 ? 'bg-rose-400' : 'bg-slate-300'

                            return (
                              <li key={sub.originalCategory}>
                                <div className={['group flex items-center rounded-lg transition-colors w-full', active ? 'bg-white shadow-sm border border-slate-200' : 'hover:bg-white/70'].join(' ')}>
                                  {isHeadAuditor && (
                                    <div className="pl-2.5 pr-0.5 py-2 flex items-center">
                                      <input
                                        type="checkbox"
                                        checked={sub.enabled}
                                        onChange={async (e) => {
                                          e.stopPropagation()
                                          if (sub.guidelineId) {
                                            await toggleProjectChecklistCategory(id!, {
                                              category: sub.originalCategory,
                                              enabled: !sub.enabled,
                                              guidelineId: sub.guidelineId
                                            })
                                            reload()
                                          }
                                        }}
                                        className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  <button type="button" onClick={() => setSelectedCategory(sub.originalCategory)}
                                    className={['flex-1 text-left py-2 pr-2.5 text-slate-600 focus:outline-none', isHeadAuditor ? 'pl-1' : 'pl-2.5', !sub.enabled && isHeadAuditor ? 'opacity-50' : ''].join(' ')}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className={`text-xs font-medium leading-tight ${active ? 'text-slate-800 font-semibold' : 'text-slate-600'}`}>{sub.subcategoryName}</span>
                                      {active && <CaretRight size={10} className="text-slate-400 shrink-0" />}
                                    </div>
                                    {sub.enabled && (
                                      <>
                                        <div className="flex items-center gap-1.5">
                                          <div className="relative h-0.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                                            <div className={`absolute inset-y-0 left-0 rounded-full origin-left ${barColor}`}
                                              style={{ transform: `scaleX(${Math.min(sub.catScore.percentage, 100) / 100})`, transition: 'transform 0.8s' }} />
                                          </div>
                                          <span className="text-[9px] font-mono text-slate-400 tabular-nums w-8 text-right shrink-0">
                                            {sub.catScore.applicable > 0 ? `${sub.catScore.percentage.toFixed(0)}%` : '—'}
                                          </span>
                                        </div>
                                        <p className="text-[9px] text-slate-400 mt-0.5">{sub.catScore.answered}/{sub.catScore.total}</p>
                                      </>
                                    )}
                                    {!sub.enabled && isHeadAuditor && (
                                      <p className="text-[9px] text-slate-400 mt-0.5">Deactivated</p>
                                    )}
                                  </button>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
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
                <div className="mb-5">
                  {selectedCategory && selectedCategory.includes(' > ') && (
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">
                      {selectedCategory.split(' > ')[0]}
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-base font-semibold text-slate-800 leading-snug min-w-0 flex-1">
                      {selectedCategory
                        ? selectedCategory.includes(' > ')
                          ? selectedCategory.split(' > ').slice(1).join(' > ')
                          : selectedCategory
                        : 'Select a category'}
                    </h2>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-400 font-sans tabular-nums">{categoryItems.length} item{categoryItems.length !== 1 ? 's' : ''}</span>
                      {isHeadAuditor && selectedCategory && (
                        <button type="button" onClick={() => setShowAddItemModal(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                          <Plus size={12} weight="bold" /> Add Item
                        </button>
                      )}
                    </div>
                  </div>
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
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <SeverityBadge severity={ci.severity} />
                                  {ci.itemCode && (
                                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{ci.itemCode}</span>
                                  )}
                                  {currentStatus === 'needs_review' && (
                                    <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium">
                                      <Flag size={9} weight="fill" /> Flagged
                                    </span>
                                  )}
                                </div>
                                {ci.itemName && (
                                  <p className="text-sm font-semibold text-slate-800 mb-1">{ci.itemName}</p>
                                )}
                                <p className="text-sm text-slate-600 leading-relaxed">{ci.text}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItemForModal(ci); setItemModalTab('help'); }}
                                  className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 font-medium px-2 py-0.5 rounded transition-colors cursor-pointer font-semibold"
                                >
                                  Help
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItemForModal(ci); setItemModalTab('traceability'); }}
                                  className="text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 border border-slate-200/60 font-mono px-2 py-0.5 rounded transition-colors cursor-pointer shadow-sm"
                                >
                                  {ci.reference || 'N/A'}
                                </button>
                                {isHeadAuditor && (
                                  <div className="flex items-center gap-1 ml-0.5">
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
                                : currentStatus === 'partially' ? 'bg-amber-50 text-amber-700 ring-amber-200'
                                : currentStatus === 'not_applicable' ? 'bg-slate-100 text-slate-600 ring-slate-200'
                                : 'bg-violet-50 text-violet-700 ring-violet-200',
                              ].join(' ')}>
                                {currentStatus === 'compliant' && <CheckCircle size={12} weight="fill" />}
                                {currentStatus === 'non_compliant' && <XCircle size={12} weight="fill" />}
                                {currentStatus === 'partially' && <CircleHalf size={12} weight="fill" />}
                                {currentStatus === 'not_applicable' && <MinusCircle size={12} weight="fill" />}
                                {currentStatus === 'needs_review' && <Flag size={12} weight="fill" />}
                                {currentStatus === 'compliant' ? 'Yes'
                                  : currentStatus === 'non_compliant' ? 'No'
                                  : currentStatus === 'partially' ? 'Partially'
                                  : currentStatus === 'not_applicable' ? 'N/A'
                                  : 'Flagged'}
                              </span>
                            </div>
                          )}

                          {/* Findings input — always visible when auditor has responded */}
                          {isAuditor && currentStatus !== 'not_started' && (
                            <div className="mt-3">
                              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Findings</label>
                              <textarea
                                value={findingsValues[ci.id] ?? getResponse(ci.id)?.findings ?? ''}
                                onChange={(e) => setFindingsValues((prev) => ({ ...prev, [ci.id]: e.target.value }))}
                                onBlur={() => handleFindingsBlur(ci.id)}
                                placeholder="Describe what you observed on the platform…"
                                rows={2}
                                className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed"
                              />
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
                                    placeholder="Record evidence references or remediation notes…" rows={2}
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


      {/* Help & Traceability Details Modal */}
      <AnimatePresence>
        {selectedItemForModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForModal(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col z-10"
            >
              <div className="flex flex-col border-b border-slate-100 mb-4 bg-slate-50">
                <div className="flex items-center justify-between p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    {itemModalTab === 'help' ? 'Help & Audit Guidance' : 'Traceability Details'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemForModal(null)
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <XIcon size={16} weight="bold" />
                  </button>
                </div>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1 px-4 pb-4">
                {itemModalTab === 'help' ? (
                  <>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">CHECKLIST QUESTION</h4>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3.5">
                        {selectedItemForModal.text}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">SEVERITY</h4>
                      <SeverityBadge severity={selectedItemForModal.severity} />
                    </div>

                    {(() => {
                      if (selectedItemForModal.helpText) {
                        return (
                          <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">HELP & AUDIT GUIDANCE</h4>
                            <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/30 border border-blue-100/50 rounded-xl p-3.5 whitespace-pre-wrap">
                              {selectedItemForModal.helpText}
                            </p>
                          </div>
                        );
                      }
                      const featureText = selectedItemForModal.feature || '';
                      const splitIdx = featureText.indexOf('[TRACEABILITY]');
                      let helpText = splitIdx !== -1 ? featureText.substring(0, splitIdx).trim() : featureText;
                      return (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">HELP & AUDIT GUIDANCE</h4>
                          <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/30 border border-blue-100/50 rounded-xl p-3.5 whitespace-pre-wrap">
                            {helpText || 'No additional audit instructions provided for this item.'}
                          </p>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">CLAUSE REFERENCE</h4>
                      <span className="inline-block font-mono text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded">
                        {selectedItemForModal.reference || 'N/A'}
                      </span>
                    </div>

                    {(() => {
                      if (selectedItemForModal.verbatimClauseText) {
                        return (
                          <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">VERBATIM CLAUSE TEXT</h4>
                            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5 whitespace-pre-wrap font-mono">
                              {selectedItemForModal.verbatimClauseText}
                            </p>
                          </div>
                        );
                      }
                      const featureText = selectedItemForModal.feature || '';
                      const splitIdx = featureText.indexOf('[TRACEABILITY]');
                      let traceText = splitIdx !== -1 ? featureText.substring(splitIdx + '[TRACEABILITY]'.length).trim() : '';
                      if (traceText) {
                        return (
                          <div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">VERBATIM CLAUSE TEXT</h4>
                            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5 whitespace-pre-wrap font-mono">
                              {traceText}
                            </p>
                          </div>
                        );
                      }
                      return <p className="text-sm text-slate-400 italic mt-4">No verbatim clause text available.</p>;
                    })()}
                  </>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedItemForModal(null)}
                  className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Checklist Item Modal */}
      <AnimatePresence>
        {showAddItemModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddItemModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col z-10"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add Checklist Item</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Custom item for {selectedCategory}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <XIcon size={16} weight="bold" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1 pb-4">
                {addItemError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                    {addItemError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                    Question / Text *
                  </label>
                  <textarea
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    placeholder="e.g. Does the app provide clear options to delete user accounts?"
                    rows={3}
                    className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                      Severity
                    </label>
                    <select
                      value={newItemSeverity}
                      onChange={(e) => setNewItemSeverity(e.target.value as Severity)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      {SEVERITY_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                      Clause Reference
                    </label>
                    <input
                      type="text"
                      value={newItemReference}
                      onChange={(e) => setNewItemReference(e.target.value)}
                      placeholder="e.g. Clause 4.2"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                    Help & Audit Guidance
                  </label>
                  <textarea
                    value={newItemHelp}
                    onChange={(e) => setNewItemHelp(e.target.value)}
                    placeholder="Instructions or guidelines to help auditors verify compliance..."
                    rows={3}
                    className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                    Traceability Mapping
                  </label>
                  <textarea
                    value={newItemTrace}
                    onChange={(e) => setNewItemTrace(e.target.value)}
                    placeholder="Code files, configuration settings, or process requirements mapping..."
                    rows={3}
                    className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddItem}
                  disabled={addingItem || !newItemText.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {addingItem ? <Spinner size={12} className="animate-spin" /> : <Plus size={12} weight="bold" />}
                  Add Item
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Project Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deleting && setShowDeleteConfirm(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="relative w-full max-w-sm bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 z-10"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-50 mx-auto mb-4">
                <Trash size={22} className="text-rose-500" />
              </div>
              <h3 className="text-base font-bold text-slate-900 text-center mb-1">Delete Project</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                Are you sure you want to delete <span className="font-semibold text-slate-700">{project.name}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteProject}
                  disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 transition-colors"
                >
                  {deleting ? <Spinner size={13} className="animate-spin" /> : <Trash size={13} />}
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

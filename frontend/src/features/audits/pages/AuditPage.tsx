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
import { saveEvidenceImages } from '../../../lib/db'
import type { ChecklistItemStatus, Severity, ChecklistItem, ProjectScore } from '../../../types'
import StatusBadge from '../../audits/components/StatusBadge'
import SeverityBadge from '../../audits/components/SeverityBadge'
import AuditorAvatar from '../../../components/ui/AuditorAvatar'
import ScoreRing from '../../audits/components/ScoreRing'
import ChecklistItemDetailModal from '../../audits/components/ChecklistItemDetailModal'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { formatPercent } from '../../../lib/scoreColor'

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
]

type SaveState = 'saving' | 'saved' | 'error'

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

function SaveIndicator({ state }: { state?: SaveState }) {
  if (!state) return null
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-2xs text-slate-400" role="status">
        <Spinner size={10} className="animate-spin" /> Saving…
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-2xs text-emerald-600" role="status">
        <CheckIcon size={10} weight="bold" /> Saved
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-2xs text-rose-600" role="status">
      <WarningCircle size={10} weight="fill" /> Not saved
    </span>
  )
}

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

  const { checklistItems, loading, error: loadError, reload, evidenceMap } = useProjectData(id)
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





  const [activeGuidelineTab, setActiveGuidelineTab] = useState<string>(project?.guidelineIds[0] ?? '')

  useEffect(() => {
    if (projectGuidelines.length > 0 && !projectGuidelines.find((g) => g.id === activeGuidelineTab)) {
      setActiveGuidelineTab(projectGuidelines[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectGuidelines.length])

  const allCategories = useMemo(() => {
    const result: { category: string; guidelineId: string; enabled: boolean }[] = []
    for (const g of projectGuidelines) {
      const seen = new Set<string>()
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

  const activeGuidelineCategories = useMemo(() => {
    return allCategories.filter((c) => c.guidelineId === activeGuidelineTab)
  }, [allCategories, activeGuidelineTab])

  const categories = useMemo(() => {
    if (isHeadAuditor) {
      return activeGuidelineCategories.map((c) => c.category)
    } else {
      return activeGuidelineCategories.filter((c) => c.enabled).map((c) => c.category)
    }
  }, [activeGuidelineCategories, isHeadAuditor])

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
      const catConfig = activeGuidelineCategories.find((c) => c.category === cat)
      const isEnabled = catConfig?.enabled ?? false
      const guidelineId = catConfig?.guidelineId ?? ''

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
        map[sectionName] = { sectionName, subcategories: [], enabledCount: 0 }
      }
      if (isEnabled) map[sectionName].enabledCount++
      map[sectionName].subcategories.push({
        subcategoryName, originalCategory: cat, enabled: isEnabled, catScore, guidelineId,
      })
    }
    return Object.values(map)
  }, [categories, activeGuidelineCategories, id, checklistItems, responses])

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

  const [fieldSaveState, setFieldSaveState] = useState<Record<string, SaveState>>({})
  const [fieldSaveError, setFieldSaveError] = useState<Record<string, string>>({})
  const savedTimers = useRef<Record<string, number>>({})

  const [responseError, setResponseError] = useState<string | null>(null)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)

  // Review panel state
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [reviewRemarks, setReviewRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

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

  const [pendingCategoryToggle, setPendingCategoryToggle] = useState<
    { category: string; guidelineId: string; label: string } | null
  >(null)
  const [togglingCategory, setTogglingCategory] = useState(false)

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

  // Manage Scope (features)
  const [scopeInput, setScopeInput] = useState('')
  const [scopeFeatures, setScopeFeatures] = useState<string[]>(project?.scope ?? [])

  useEffect(() => {
    if (project?.scope) {
      setScopeFeatures(project.scope)
    }
  }, [project?.scope])
  const [savingScope, setSavingScope] = useState(false)




  // Checklist items scoped to the active guideline tab
  const guidelineItems = useMemo(
    () => activeGuidelineTab
      ? checklistItems.filter((ci) => ci.guidelineId === activeGuidelineTab)
      : checklistItems,
    [checklistItems, activeGuidelineTab],
  )

  // Reset selected category to first category of the new guideline tab
  useEffect(() => {
    const firstCat = sections[0]?.subcategories[0]?.originalCategory ?? ''
    setSelectedCategory(firstCat)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGuidelineTab])

  // Flagged items (needs_review) — clickable navigation to the flagged checklist item
  const flaggedItems = useMemo(
    () => checklistItems.filter((ci) => responses[`${id}__${ci.id}`]?.status === 'needs_review'),
    [checklistItems, responses, id],
  )
  const [showFlaggedList, setShowFlaggedList] = useState(false)
  const [flaggedNavTarget, setFlaggedNavTarget] = useState<{ itemId: string; guidelineId: string; category: string } | null>(null)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

  function goToItem(item: ChecklistItem) {
    setShowFlaggedList(false)
    setActiveTab('checklist')
    setFlaggedNavTarget({ itemId: item.id, guidelineId: item.guidelineId, category: item.category })
    if (item.guidelineId !== activeGuidelineTab) {
      setActiveGuidelineTab(item.guidelineId)
    } else if (item.category !== selectedCategory) {
      setSelectedCategory(item.category)
    }
  }

  // Step 1: once the active guideline tab matches the target, switch to its category
  useEffect(() => {
    if (flaggedNavTarget && activeGuidelineTab === flaggedNavTarget.guidelineId && selectedCategory !== flaggedNavTarget.category) {
      setSelectedCategory(flaggedNavTarget.category)
    }
  }, [flaggedNavTarget, activeGuidelineTab, selectedCategory])

  // Step 2: once the category is showing the target item, scroll to it and highlight it
  useEffect(() => {
    if (!flaggedNavTarget || selectedCategory !== flaggedNavTarget.category) return
    const target = flaggedNavTarget
    const t = setTimeout(() => {
      const el = itemRefs.current[target.itemId]
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedItemId(target.itemId)
        setTimeout(() => setHighlightedItemId(null), 2200)
      }
      setFlaggedNavTarget(null)
    }, 80)
    return () => clearTimeout(t)
  }, [flaggedNavTarget, selectedCategory])

  // Evidence images: itemId → array of { url, name }
  const [evidence, setEvidence] = useState<Record<string, { url: string; name: string }[]>>({})
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingEvidenceItemId, setPendingEvidenceItemId] = useState<string | null>(null)

  // Initialise evidence from DB on load
  useEffect(() => {
    if (Object.keys(evidenceMap).length > 0) {
      setEvidence((prev) => ({ ...evidenceMap, ...prev }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(evidenceMap)])

  function handleImageClick(itemId: string) {
    if (answersLocked) return
    setPendingEvidenceItemId(itemId)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const MAX_EVIDENCE_SIZE = 5 * 1024 * 1024 // 5 MB

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !pendingEvidenceItemId) return
    const itemId = pendingEvidenceItemId
    setPendingEvidenceItemId(null)

    const oversized = files.filter((f) => f.size > MAX_EVIDENCE_SIZE)
    if (oversized.length > 0) {
      setEvidenceError(`File${oversized.length > 1 ? 's' : ''} too large (max 5 MB): ${oversized.map((f) => f.name).join(', ')}`)
      return
    }
    const notImages = files.filter((f) => !f.type.startsWith('image/'))
    if (notImages.length > 0) {
      setEvidenceError(`Only image files can be attached as evidence: ${notImages.map((f) => f.name).join(', ')}`)
      return
    }
    setEvidenceError(null)

    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        setEvidence((prev) => {
          const updated = { ...prev, [itemId]: [...(prev[itemId] ?? []), { url, name: file.name }] }
          if (currentUserId) {
            saveEvidenceImages(id!, itemId, currentUserId, updated[itemId]).catch(() => {})
          }
          return updated
        })
      }
      reader.readAsDataURL(file)
    })
  }

  function removeEvidence(itemId: string, index: number) {
    if (answersLocked) return
    setEvidence((prev) => {
      const updated = { ...prev, [itemId]: (prev[itemId] ?? []).filter((_, i) => i !== index) }
      if (currentUserId) {
        saveEvidenceImages(id!, itemId, currentUserId, updated[itemId] ?? []).catch(() => {})
      }
      return updated
    })
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
  const incompleteItems = submittableItems.filter((ci) => {
    const resp = responses[`${id}__${ci.id}`]
    return !resp || resp.status === 'not_started' || resp.status === 'needs_review'
  })
  const allAnswered = submittableItems.length > 0 && incompleteItems.length === 0
  const canSubmit = isAuditor && allAnswered
    && (project.submissionStatus === 'not_submitted' || project.submissionStatus === 'rejected')
    && project.status === 'in_progress'

  // Once a project is awaiting review or already approved, answers are frozen —
  // editing them after submission would silently invalidate the head auditor's decision.
  const answersLocked = project.submissionStatus === 'pending_review' || project.submissionStatus === 'approved'

  function getResponse(itemId: string) { return responses[`${id}__${itemId}`] }

  async function handleResponseClick(itemId: string, guidelineId: string, status: ChecklistItemStatus) {
    if (answersLocked) return
    const current = getResponse(itemId)
    const notes = noteValues[itemId] ?? current?.notes ?? ''
    setResponseError(null)
    try {
      await setResponse(id!, itemId, guidelineId, status, notes)
    } catch {
      setResponseError('Failed to save your response. Check your connection and try again.')
    }
  }

  function toggleNotes(itemId: string) {
    setExpandedNotes((prev) => { const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n })
  }

  function markSaved(key: string) {
    setFieldSaveState((prev) => ({ ...prev, [key]: 'saved' }))
    window.clearTimeout(savedTimers.current[key])
    savedTimers.current[key] = window.setTimeout(() => {
      setFieldSaveState((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }, 2000)
  }

  async function handleNotesBlur(itemId: string, guidelineId: string) {
    if (answersLocked) return
    const current = getResponse(itemId)
    const notes = noteValues[itemId] ?? ''
    if (!current || current.status === 'not_started') return
    const key = `${itemId}__notes`
    setFieldSaveState((prev) => ({ ...prev, [key]: 'saving' }))
    setFieldSaveError((prev) => ({ ...prev, [key]: '' }))
    try {
      await setResponse(id!, itemId, guidelineId, current.status, notes)
      markSaved(key)
    } catch {
      setFieldSaveState((prev) => ({ ...prev, [key]: 'error' }))
      setFieldSaveError((prev) => ({ ...prev, [key]: "Couldn't save this note. Your text is still here — click away and back to retry." }))
    }
  }

  async function handleFindingsBlur(itemId: string) {
    if (answersLocked) return
    const findings = findingsValues[itemId] ?? ''
    const key = `${itemId}__findings`
    setFieldSaveState((prev) => ({ ...prev, [key]: 'saving' }))
    setFieldSaveError((prev) => ({ ...prev, [key]: '' }))
    try {
      await saveFindings(id!, itemId, findings)
      markSaved(key)
    } catch {
      setFieldSaveState((prev) => ({ ...prev, [key]: 'error' }))
      setFieldSaveError((prev) => ({ ...prev, [key]: "Couldn't save these findings. Your text is still here — click away and back to retry." }))
    }
  }

  async function confirmCategoryToggle() {
    if (!pendingCategoryToggle) return
    setTogglingCategory(true)
    setCategoryError(null)
    try {
      await toggleProjectChecklistCategory(id!, {
        category: pendingCategoryToggle.category,
        enabled: false,
        guidelineId: pendingCategoryToggle.guidelineId,
      })
      setPendingCategoryToggle(null)
      reload()
    } catch {
      setCategoryError('Failed to update this category. Please try again.')
      setPendingCategoryToggle(null)
    } finally {
      setTogglingCategory(false)
    }
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
    setReviewError(null)
    try {
      await reviewSubmission(id!, true, reviewRemarks)
      setShowReviewPanel(false)
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed to approve this audit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    setSubmitting(true)
    setReviewError(null)
    try {
      await reviewSubmission(id!, false, reviewRemarks)
      setShowReviewPanel(false)
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed to reject this audit. Please try again.')
    } finally {
      setSubmitting(false)
    }
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
              <StatusBadge type="audit" status={project.status} />
              {project.submissionStatus !== 'not_submitted' && (
                <span className={[
                  'text-2xs px-2 py-0.5 rounded-md font-medium border',
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

          <div className="flex flex-col items-stretch sm:items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isHeadAuditor && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setShowManageAuditors((v) => !v)}>
                    <UserPlus size={13} /> Manage Auditors
                  </Button>
                  <Button variant="danger-outline" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                    <Trash size={13} /> Delete Project
                  </Button>
                </>
              )}
              {isAuditor && (project.submissionStatus === 'not_submitted' || project.submissionStatus === 'rejected') && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canSubmit || submitting}
                  onClick={handleSubmitForReview}
                  aria-describedby={!canSubmit && incompleteItems.length > 0 ? 'submit-blocked-reason' : undefined}
                >
                  {submitting ? <Spinner size={13} className="animate-spin" /> : <PaperPlaneTilt size={13} />}
                  {project.submissionStatus === 'rejected' ? 'Resubmit for Review' : 'Submit for Review'}
                </Button>
              )}
              {isAuditor && project.submissionStatus === 'pending_review' && (
                <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
                  <WarningCircle size={13} /> Pending Review
                </span>
              )}
            </div>
          </div>
        </div>

        {project.notes && <p className="text-xs text-slate-400 mt-2 mb-2 max-w-xl leading-relaxed">{project.notes}</p>}

        {/* Metrics strip */}
        <div className="flex items-center gap-5 mt-3 flex-wrap">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:flex sm:items-center sm:gap-5">
            <div className="flex items-center gap-2">
              <ScoreRing percentage={score.percentage} size={44} strokeWidth={4} showLabel={false} />
              <div>
                <p className="font-sans text-sm font-semibold text-slate-800 tabular-nums leading-none">{formatPercent(score.percentage)}%</p>
                <p className="text-2xs text-slate-400 mt-0.5">Compliance</p>
              </div>
            </div>
            <div className="w-px h-8 bg-slate-200 hidden sm:block" />
            {[
              { value: `${score.answered}/${score.total}`, label: 'Answered', color: 'text-slate-700' },
              { value: String(score.compliant), label: 'Passing', color: 'text-emerald-600' },
              { value: String(score.nonCompliant), label: 'Failing', color: 'text-rose-500' },
            ].map(({ value, label, color }) => (
              <div key={label} className="text-left sm:text-center">
                <p className={`font-sans text-sm font-semibold tabular-nums leading-none ${color}`}>{value}</p>
                <p className="text-2xs text-slate-400 mt-0.5">{label}</p>
              </div>
            ))}
            {isAuditor
              && (project.submissionStatus === 'not_submitted' || project.submissionStatus === 'rejected')
              && !canSubmit && incompleteItems.length > 0 && (
              <div id="submit-blocked-reason" className="col-span-2 sm:col-span-1 sm:max-w-[11rem]">
                <p className="text-sm font-semibold text-slate-500 tabular-nums leading-none">
                  {incompleteItems.length} item{incompleteItems.length !== 1 ? 's' : ''} remaining
                </p>
                <button
                  type="button"
                  onClick={() => goToItem(incompleteItems[0])}
                  className="text-2xs font-semibold text-blue-600 hover:text-blue-700 transition-colors mt-0.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Go to first →
                </button>
              </div>
            )}
          </div>

          {flaggedItems.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowFlaggedList((v) => !v)}
                aria-expanded={showFlaggedList}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ring-1 transition-colors cursor-pointer',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600',
                  showFlaggedList
                    ? 'bg-amber-500 text-white ring-amber-500'
                    : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100',
                ].join(' ')}
              >
                <Flag size={12} weight="fill" />
                {flaggedItems.length} Flagged
                <CaretRight size={11} weight="bold" className={`transition-transform duration-200 ${showFlaggedList ? 'rotate-90' : ''}`} />
              </button>

              <AnimatePresence>
                {showFlaggedList && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowFlaggedList(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-full mt-1.5 w-72 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1.5"
                    >
                      {flaggedItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => goToItem(item)}
                          className="w-full text-left px-3 py-2 hover:bg-amber-50 transition-colors flex items-start gap-2 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-600"
                        >
                          <Flag size={12} weight="fill" className="text-amber-500 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{item.itemName || item.text}</p>
                            <p className="text-2xs text-slate-400 truncate">{item.category}</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )}

        </div>

        {loadError && (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
            <WarningCircle size={14} weight="fill" className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Couldn't load this audit's checklist.</p>
              <p className="mt-0.5 break-words text-rose-600">{loadError}</p>
            </div>
            <Button variant="danger" size="xs" onClick={() => reload()} className="shrink-0">
              Retry
            </Button>
          </div>
        )}

        {categoryError && (
          <div role="alert" className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
            <WarningCircle size={14} className="shrink-0" />
            <span className="flex-1">{categoryError}</span>
            <button type="button" onClick={() => setCategoryError(null)} aria-label="Dismiss"
              className="text-rose-400 hover:text-rose-600 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
              <XIcon size={12} weight="bold" />
            </button>
          </div>
        )}
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
              <button type="button" onClick={() => { setShowReviewPanel((v) => !v); setReviewError(null) }}
                aria-expanded={showReviewPanel}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">
                {showReviewPanel ? 'Hide Review' : 'Review Submission'}
              </button>
            </div>
            <AnimatePresence>
              {showReviewPanel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-4">
                  <div className="bg-white border border-amber-200 rounded-xl p-5">
                    {reviewError && (
                      <div role="alert" className="mb-3 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                        {reviewError}
                      </div>
                    )}
                    <label htmlFor="review-remarks" className="block text-sm font-semibold text-slate-700 mb-2">Review Remarks</label>
                    <textarea id="review-remarks" value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)}
                      placeholder="Provide feedback or reasons for your decision…" rows={3}
                      className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                    <div className="flex items-center gap-3 mt-4">
                      <Button variant="success" size="md" onClick={handleApprove} disabled={submitting}>
                        <CheckIcon size={14} weight="bold" /> Approve
                      </Button>
                      <Button variant="danger" size="md" onClick={handleReject} disabled={submitting}>
                        <XIcon size={14} weight="bold" /> Reject
                      </Button>
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
                <label htmlFor="auditor-search" className="sr-only">Search auditors to add</label>
                <input
                  id="auditor-search"
                  type="text"
                  value={auditorSearchQuery}
                  onChange={(e) => setAuditorSearchQuery(e.target.value)}
                  placeholder="Search auditor to add…"
                  className="flex-1 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none bg-transparent rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                />
                {auditorSearchQuery && (
                  <button type="button" onClick={() => setAuditorSearchQuery('')} aria-label="Clear auditor search"
                    className="text-slate-400 hover:text-slate-600 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
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
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600">
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
                    <p className="text-2xs text-slate-400 capitalize">
                      {u.role.replace('_', ' ')}
                      {u.id === project.headAuditorId && <span className="ml-1 text-blue-500">· Head Auditor</span>}
                    </p>
                  </div>
                  {u.id !== project.headAuditorId && (
                    <button type="button" onClick={() => removeAuditorFromProject(id!, u.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                      title="Remove" aria-label={`Remove ${u.name} from this project`}>
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
              aria-current={activeTab === key ? 'true' : undefined}
              className={[
                'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600',
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
                  <Button variant="primary" size="sm" onClick={handleSaveGuidelines} disabled={savingGuidelines}>
                    {savingGuidelines ? <Spinner size={13} className="animate-spin" /> : <CheckIcon size={13} weight="bold" />}
                    Save Changes
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setShowManageGuidelines((v) => !v)} aria-expanded={showManageGuidelines}>
                  <Plus size={13} /> {showManageGuidelines ? 'Done' : 'Manage Guidelines'}
                </Button>
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
                        <span className="text-2xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">v{g.version}</span>
                        <button type="button"
                          onClick={() => { setActiveGuidelineTab(g.id); setActiveTab('checklist') }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                          <ListChecks size={12} /> Edit Checklist
                        </button>
                        <button type="button"
                          onClick={() => setSelectedGuidelineIds((prev) => prev.filter((x) => x !== g.id))}
                          className="p-1 rounded-md text-slate-300 hover:text-rose-500 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                          title="Remove" aria-label={`Remove ${g.name}`}>
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
                  <p className="text-2xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Available Guidelines</p>
                  {projectManageGuidelines.filter((g) => !g.isDeleted).length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-xl">
                      No guideline frameworks are available to add.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                      {projectManageGuidelines
                        .filter((g) => !g.isDeleted)
                        .map((g) => {
                          const checked = selectedGuidelineIds.includes(g.id)
                          return (
                            <label key={g.id} className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-blue-600">
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                onChange={() =>
                                  setSelectedGuidelineIds((prev) =>
                                    prev.includes(g.id) ? prev.filter((x) => x !== g.id) : [...prev, g.id],
                                  )
                                }
                              />
                              <div className={[
                                'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                                checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white',
                              ].join(' ')}>
                                {checked && <CheckIcon size={11} weight="bold" className="text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{g.description}</p>
                              </div>
                              <span className="text-2xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">v{g.version}</span>
                            </label>
                          )
                        })}
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
            <label htmlFor="scope-input" className="sr-only">Add a feature to the audit scope</label>
            <input id="scope-input" value={scopeInput} onChange={(e) => setScopeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && scopeInput.trim()) { setScopeFeatures((p) => [...p, scopeInput.trim()]); setScopeInput('') } }}
              placeholder="e.g. Login, Data Sharing, Privacy Settings…"
              className="flex-1 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
            <Button variant="neutral" size="md"
              onClick={() => { if (scopeInput.trim()) { setScopeFeatures((p) => [...p, scopeInput.trim()]); setScopeInput('') } }}>
              Add
            </Button>
          </div>
          {scopeFeatures.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {scopeFeatures.map((f) => (
                <span key={f} className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-slate-100 text-slate-700 text-xs font-medium rounded-md">
                  {f}
                  <button type="button" onClick={() => setScopeFeatures((p) => p.filter((x) => x !== f))}
                    aria-label={`Remove ${f} from scope`}
                    className="text-slate-400 hover:text-rose-500 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"><XIcon size={11} weight="bold" /></button>
                </span>
              ))}
            </div>
          )}
          {scopeFeatures.length === 0 && <p className="text-sm text-slate-400 mb-5">No features defined yet. Add features above.</p>}
          <Button variant="primary" size="md" onClick={handleSaveScope} disabled={savingScope}>
            {savingScope ? <Spinner size={14} className="animate-spin" /> : <CheckIcon size={14} weight="bold" />}
            Save Scope
          </Button>
        </div>
      )}

      {/* Checklist view */}
      {(!isHeadAuditor || activeTab === 'checklist') && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Guideline tabs — one per selected guideline, visible to all roles */}
          {projectGuidelines.length > 1 && (
            <div className="border-b border-slate-200 bg-white px-4 md:px-8 py-2.5 flex items-center gap-3 overflow-x-auto scrollbar-none shrink-0">
              <span className="text-2xs font-semibold text-slate-400 uppercase tracking-widest shrink-0">Guideline</span>
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                {projectGuidelines.map((g) => (
                  <button key={g.id} type="button"
                    onClick={() => setActiveGuidelineTab(g.id)}
                    aria-current={activeGuidelineTab === g.id ? 'true' : undefined}
                    className={[
                      'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                      activeGuidelineTab === g.id
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700',
                    ].join(' ')}>
                    {g.shortName}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Mobile: category select dropdown */}
          <div className="md:hidden px-4 py-3 bg-white border-b border-slate-200 shrink-0">
            <label htmlFor="mobile-category-select" className="sr-only">Checklist category</label>
            <select
              id="mobile-category-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              {sections.map((section, sIdx) => (
                <optgroup key={section.sectionName} label={`${sIdx + 1}. ${section.sectionName}`}>
                  {section.subcategories.map((sub, subIdx) => {
                    const cs = sub.catScore
                    return (
                      <option key={sub.originalCategory} value={sub.originalCategory}>
                        {sIdx + 1}.{subIdx + 1} {sub.subcategoryName}{!sub.enabled && isHeadAuditor ? ' (Deactivated)' : cs.applicable > 0 ? ` — ${cs.percentage.toFixed(0)}%` : ''}
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
            <p className="text-xs text-slate-400 font-mono tracking-widest uppercase px-2 mb-3">Sections</p>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size={20} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <ul className="space-y-3 list-none m-0 p-0">
                {sections.map((section, sIdx) => {
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
                        aria-expanded={isExpanded}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left text-2xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        <span className="truncate pr-2">{sIdx + 1}. {section.sectionName}</span>
                        <CaretRight
                          size={12}
                          className={["transform transition-transform text-slate-400 shrink-0", isExpanded ? "rotate-90" : ""].join(' ')}
                        />
                      </button>

                      {/* Subcategories (Only visible if expanded) */}
                      {isExpanded && (
                        <ul className="pl-2 space-y-1 border-l border-slate-200 ml-1.5 list-none">
                          {section.subcategories.map((sub, subIdx) => {
                            const active = sub.originalCategory === selectedCategory
                            const completionPct = sub.catScore.total > 0
                              ? (sub.catScore.answered / sub.catScore.total) * 100
                              : 0

                            return (
                              <li key={sub.originalCategory}>
                                <div className={['group flex items-center rounded-lg border-l-2 transition-colors w-full', active ? 'bg-blue-50/70 border-blue-500' : 'border-transparent hover:bg-white/70'].join(' ')}>
                                  {isHeadAuditor && (
                                    <div className="pl-2.5 pr-0.5 py-2 flex items-center">
                                      <input
                                        type="checkbox"
                                        checked={sub.enabled}
                                        aria-label={`${sub.enabled ? 'Disable' : 'Enable'} category ${sub.subcategoryName}`}
                                        onChange={async (e) => {
                                          e.stopPropagation()
                                          if (!sub.guidelineId) return
                                          setCategoryError(null)
                                          if (sub.enabled) {
                                            setPendingCategoryToggle({
                                              category: sub.originalCategory,
                                              guidelineId: sub.guidelineId,
                                              label: sub.subcategoryName,
                                            })
                                            return
                                          }
                                          try {
                                            await toggleProjectChecklistCategory(id!, {
                                              category: sub.originalCategory,
                                              enabled: true,
                                              guidelineId: sub.guidelineId,
                                            })
                                            reload()
                                          } catch {
                                            setCategoryError('Failed to update this category. Please try again.')
                                          }
                                        }}
                                        className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                      />
                                    </div>
                                  )}
                                  <button type="button" onClick={() => setSelectedCategory(sub.originalCategory)}
                                    aria-current={active ? 'true' : undefined}
                                    className={['flex-1 text-left py-2 pr-2.5 text-slate-600 rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600', isHeadAuditor ? 'pl-1' : 'pl-2.5', !sub.enabled && isHeadAuditor ? 'opacity-50' : ''].join(' ')}>
                                    <p className={`text-xs leading-tight mb-0.5 ${active ? 'text-slate-800 font-semibold' : 'text-slate-600 font-medium'}`}>{sIdx + 1}.{subIdx + 1} {sub.subcategoryName}</p>
                                    {sub.enabled && (
                                      <div className="flex items-center gap-1.5">
                                        <div className="relative h-0.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="absolute inset-y-0 left-0 rounded-full origin-left bg-blue-500"
                                            style={{ transform: `scaleX(${completionPct / 100})`, transition: 'transform 0.8s' }} />
                                        </div>
                                        <span className="text-2xs font-mono text-slate-400 tabular-nums shrink-0">
                                          {sub.catScore.answered}/{sub.catScore.total}
                                        </span>
                                      </div>
                                    )}
                                    {!sub.enabled && isHeadAuditor && (
                                      <p className="text-2xs text-slate-400 mt-0.5">Deactivated</p>
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
                        <Button variant="primary" size="xs" onClick={() => setShowAddItemModal(true)}>
                          <Plus size={12} weight="bold" /> Add Item
                        </Button>
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
                {evidenceError && (
                  <div role="alert" className="mb-4 flex items-center gap-2 text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
                    <WarningCircle size={14} className="shrink-0" />
                    <span>{evidenceError}</span>
                    <button type="button" onClick={() => setEvidenceError(null)} aria-label="Dismiss"
                      className="ml-auto text-rose-400 hover:text-rose-600 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
                      <XIcon size={12} weight="bold" />
                    </button>
                  </div>
                )}

                {responseError && (
                  <div role="alert" className="mb-4 flex items-center gap-2 text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
                    <WarningCircle size={14} className="shrink-0" />
                    <span>{responseError}</span>
                    <button type="button" onClick={() => setResponseError(null)} aria-label="Dismiss"
                      className="ml-auto text-rose-400 hover:text-rose-600 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600">
                      <XIcon size={12} weight="bold" />
                    </button>
                  </div>
                )}

                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <Spinner size={28} className="animate-spin text-slate-300" />
                  </div>
                ) : loadError ? (
                  <div className="py-12 text-center">
                    <WarningCircle size={30} className="text-rose-300 mx-auto mb-3" />
                    <p className="text-slate-600 text-sm font-medium">This category couldn't be loaded.</p>
                    <p className="text-slate-400 text-xs mt-1">The checklist request failed — it may just be a connection blip.</p>
                    <Button variant="secondary" size="sm" className="mt-3 mx-auto" onClick={() => reload()}>
                      Retry
                    </Button>
                  </div>
                ) : categoryItems.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-slate-400 text-sm">No checklist items in this category.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden">
                    {categoryItems.map((ci, itemIdx) => {
                      const resp = getResponse(ci.id)
                      const currentStatus = resp?.status ?? 'not_started'
                      const notesOpen = expandedNotes.has(ci.id)
                      const currentNotes = noteValues[ci.id] ?? resp?.notes ?? ''
                      const isEditing = editingItemId === ci.id
                      const isConfirmingDelete = confirmDeleteItemId === ci.id

                      return (
                        <motion.div
                          key={ci.id}
                          variants={rowVar}
                          ref={(el: HTMLDivElement | null) => { itemRefs.current[ci.id] = el }}
                          className={[
                            'px-6 py-5 transition-colors duration-700',
                            highlightedItemId === ci.id ? 'bg-amber-50 ring-1 ring-inset ring-amber-200' : '',
                          ].join(' ')}
                        >
                          {isEditing ? (
                            <div className="space-y-3">
                              <div>
                                <label htmlFor={`edit-text-${ci.id}`} className="block text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                                  Question / Text
                                </label>
                                <textarea id={`edit-text-${ci.id}`} value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                                  className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" />
                              </div>
                              <fieldset className="border-0 p-0 m-0">
                                <legend className="text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">Severity</legend>
                                <div className="flex items-center gap-2">
                                  {SEVERITY_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      aria-pressed={editSeverity === opt.value}
                                      onClick={() => setEditSeverity(opt.value)}
                                      className={[
                                        'px-3 py-1.5 rounded-md text-xs font-semibold ring-1 transition-colors',
                                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                                        editSeverity === opt.value
                                          ? 'bg-blue-600 text-white ring-blue-600'
                                          : 'bg-white text-slate-500 ring-slate-200 hover:text-slate-700 hover:ring-slate-300',
                                      ].join(' ')}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              </fieldset>
                              <div className="flex items-center gap-3">
                                <Button variant="primary" size="sm" onClick={saveEditItem}>
                                  <CheckIcon size={12} weight="bold" /> Save
                                </Button>
                                <Button variant="neutral" size="sm" onClick={() => setEditingItemId(null)}>
                                  <XIcon size={12} weight="bold" /> Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  {ci.itemCode && (
                                    <span className="text-2xs font-mono text-slate-400">{ci.itemCode}</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => { setSelectedItemForModal(ci); setItemModalTab('traceability'); }}
                                    className="text-2xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-mono px-1.5 py-0.5 rounded-md transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                  >
                                    {ci.reference || 'N/A'}
                                  </button>
                                  <SeverityBadge severity={ci.severity} />
                                  {currentStatus === 'needs_review' && (
                                    <span className="flex items-center gap-1 text-2xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium">
                                      <Flag size={9} weight="fill" /> Flagged
                                    </span>
                                  )}
                                </div>
                                {ci.itemName && (
                                  <p className="text-sm font-semibold text-slate-800 mb-1">{ci.itemName}</p>
                                )}
                                <p className="text-sm text-slate-600 leading-relaxed">
                                  {ci.itemCode ? '' : `${itemIdx + 1}. `}{ci.text}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedItemForModal(ci); setItemModalTab('help'); }}
                                  className="text-2xs text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 px-2 py-0.5 rounded-md transition-colors cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                >
                                  Help
                                </button>
                                {isHeadAuditor && (
                                  <div className="flex items-center gap-1 ml-0.5">
                                    <button type="button" onClick={() => startEditItem(ci.id, ci.text, ci.severity)}
                                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                      title="Edit" aria-label="Edit checklist item">
                                      <PencilSimple size={14} />
                                    </button>
                                    <button type="button" onClick={() => setConfirmDeleteItemId(ci.id)}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                                      title="Delete" aria-label="Delete checklist item">
                                      <Trash size={14} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {isConfirmingDelete && (
                            <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
                              <p className="text-xs font-semibold text-rose-700 mb-0.5">Delete this checklist item permanently?</p>
                              {(() => {
                                const r = getResponse(ci.id)
                                return r && r.status !== 'not_started' ? (
                                  <p className="text-xs text-rose-600 mb-3">This item has a recorded response from an auditor. Deleting it will remove that response.</p>
                                ) : (
                                  <p className="text-xs text-rose-500 mb-3">This action cannot be undone.</p>
                                )
                              })()}
                              <div className="flex items-center gap-2">
                                <Button variant="danger" size="xs" onClick={() => handleDeleteItem(ci.id)}>Delete</Button>
                                <Button variant="secondary" size="xs" onClick={() => setConfirmDeleteItemId(null)}>Cancel</Button>
                              </div>
                            </div>
                          )}

                          {/* Auditor response controls (14.2, 14.3) */}
                          {isAuditor && !isEditing && (
                            <div className="mt-3 space-y-1">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                {AUDITOR_RESPONSE_OPTIONS.map(({ value, label, icon: Icon, active, inactive }) => {
                                  const isActive = currentStatus === value
                                  return (
                                    <motion.button key={value} type="button" whileTap={{ scale: 0.97 }}
                                      disabled={answersLocked}
                                      aria-pressed={isActive}
                                      onClick={() => handleResponseClick(ci.id, ci.guidelineId, value)}
                                      className={['flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ring-1 transition-all',
                                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                                        isActive ? `${active} shadow-sm` : inactive, answersLocked ? 'opacity-50 cursor-not-allowed' : ''].join(' ')}>
                                      <Icon size={15} weight={isActive ? 'fill' : 'regular'} /> {label}
                                    </motion.button>
                                  )
                                })}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {/* Flag for Review */}
                                <motion.button type="button" whileTap={{ scale: 0.97 }}
                                  disabled={answersLocked}
                                  aria-pressed={currentStatus === 'needs_review'}
                                  onClick={() => handleResponseClick(ci.id, ci.guidelineId, 'needs_review')}
                                  className={['flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600',
                                    currentStatus === 'needs_review'
                                      ? 'bg-amber-500 text-white'
                                      : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50',
                                    answersLocked ? 'opacity-50 cursor-not-allowed' : '',
                                  ].join(' ')}>
                                  <Flag size={13} weight={currentStatus === 'needs_review' ? 'fill' : 'regular'} /> Flag
                                </motion.button>
                                {/* Notes + Evidence buttons */}
                                <button type="button" onClick={() => toggleNotes(ci.id)}
                                  aria-expanded={notesOpen}
                                  className={['flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                                    notesOpen || currentNotes ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
                                  ].join(' ')}>
                                  <NotePencil size={13} weight={currentNotes ? 'fill' : 'regular'} />
                                  {currentNotes ? 'Notes' : 'Add note'}
                                </button>
                                <button type="button" onClick={() => handleImageClick(ci.id)}
                                  disabled={answersLocked}
                                  title={answersLocked ? 'Locked while this audit is under review' : 'Attach image as evidence'}
                                  className={['flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600',
                                    (evidence[ci.id]?.length ?? 0) > 0 ? 'text-violet-600 bg-violet-50' : 'text-slate-400 hover:text-violet-600 hover:bg-violet-50',
                                    answersLocked ? 'opacity-50 cursor-not-allowed' : '',
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
                          {(isAuditor || isHeadAuditor) && currentStatus !== 'not_started' && (
                            <div className="mt-5">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <label htmlFor={`findings-${ci.id}`} className="block text-2xs font-semibold text-slate-400 uppercase tracking-widest">
                                  Findings{!isAuditor && ' (read-only)'}
                                </label>
                                <SaveIndicator state={fieldSaveState[`${ci.id}__findings`]} />
                              </div>
                              <textarea
                                id={`findings-${ci.id}`}
                                value={findingsValues[ci.id] ?? getResponse(ci.id)?.findings ?? ''}
                                onChange={(e) => setFindingsValues((prev) => ({ ...prev, [ci.id]: e.target.value }))}
                                onBlur={isAuditor ? () => handleFindingsBlur(ci.id) : undefined}
                                readOnly={answersLocked || !isAuditor}
                                placeholder={isAuditor ? 'Describe what you observed on the platform…' : 'No findings recorded.'}
                                rows={2}
                                className={['w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600', answersLocked || !isAuditor ? 'opacity-70' : ''].join(' ')}
                              />
                              {fieldSaveError[`${ci.id}__findings`] && (
                                <p role="alert" className="mt-1 flex items-center gap-1.5 text-2xs text-rose-700">
                                  <WarningCircle size={12} weight="fill" className="shrink-0" />
                                  {fieldSaveError[`${ci.id}__findings`]}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Notes input */}
                          {isAuditor && (
                            <AnimatePresence>
                              {notesOpen && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 28 }} className="overflow-hidden">
                                  <div className="flex items-center justify-between gap-2 mt-3 mb-1">
                                    <label htmlFor={`notes-${ci.id}`} className="block text-2xs font-semibold text-slate-400 uppercase tracking-widest">Notes</label>
                                    <SaveIndicator state={fieldSaveState[`${ci.id}__notes`]} />
                                  </div>
                                  <textarea id={`notes-${ci.id}`} value={currentNotes}
                                    onChange={(e) => setNoteValues((prev) => ({ ...prev, [ci.id]: e.target.value }))}
                                    onBlur={() => handleNotesBlur(ci.id, ci.guidelineId)}
                                    readOnly={answersLocked}
                                    placeholder="Record evidence references or remediation notes…" rows={2}
                                    className={['w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600', answersLocked ? 'opacity-70 cursor-not-allowed' : ''].join(' ')} />
                                  {fieldSaveError[`${ci.id}__notes`] && (
                                    <p role="alert" className="mt-1 flex items-center gap-1.5 text-2xs text-rose-700">
                                      <WarningCircle size={12} weight="fill" className="shrink-0" />
                                      {fieldSaveError[`${ci.id}__notes`]}
                                    </p>
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          )}

                          {!notesOpen && currentNotes && (
                            <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-md px-3 py-2 border border-slate-100 leading-relaxed max-w-[65ch]">{currentNotes}</p>
                          )}

                          {/* Evidence image previews */}
                          {(evidence[ci.id]?.length ?? 0) > 0 && (
                            <div className="mt-3">
                              {!isAuditor && (
                                <p className="text-2xs font-semibold text-slate-400 uppercase tracking-widest mb-1.5">Evidence</p>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {evidence[ci.id].map((img, idx) => (
                                  <div key={idx} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setLightbox(img)}
                                      title={`View ${img.name} full size`}
                                      className="block w-full h-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                                    >
                                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                    </button>
                                    {isAuditor && (
                                      <button
                                        type="button"
                                        onClick={() => removeEvidence(ci.id, idx)}
                                        className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity bg-white rounded-full shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                                        title="Remove"
                                        aria-label={`Remove evidence ${img.name}`}
                                      >
                                        <XCircleFill size={16} className="text-rose-500" weight="fill" />
                                      </button>
                                    )}
                                    <p className="absolute bottom-0 left-0 right-0 text-2xs text-white bg-black/50 px-1 py-0.5 truncate pointer-events-none">{img.name}</p>
                                  </div>
                                ))}
                                {isAuditor && (
                                  <button
                                    type="button"
                                    onClick={() => handleImageClick(ci.id)}
                                    aria-label="Add another evidence photo"
                                    className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-violet-400 hover:text-violet-500 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
                                  >
                                    <Image size={18} />
                                  </button>
                                )}
                              </div>
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
      <ChecklistItemDetailModal
        item={selectedItemForModal}
        tab={itemModalTab}
        onClose={() => setSelectedItemForModal(null)}
        parseLegacyFeature
      />

      <Modal
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        size="xl"
        panelClassName="overflow-hidden max-h-[90vh] flex flex-col"
        labelledBy="evidence-lightbox-title"
      >
        {lightbox && (
          <>
            <div className="flex items-center justify-between gap-4 px-6 py-4 bg-slate-50 border-b border-slate-100 rounded-t-2xl shrink-0">
              <h3 id="evidence-lightbox-title" className="text-sm font-semibold text-slate-800 truncate">{lightbox.name}</h3>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <XIcon size={16} weight="bold" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-900/5 p-4 flex items-center justify-center">
              <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={pendingCategoryToggle !== null}
        onClose={() => setPendingCategoryToggle(null)}
        size="sm"
        panelClassName="p-6"
        labelledBy="disable-category-title"
        dismissable={!togglingCategory}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 mx-auto mb-4">
          <WarningCircle size={22} className="text-amber-500" weight="fill" />
        </div>
        <h3 id="disable-category-title" className="text-base font-bold text-slate-900 text-center mb-1">Disable this category?</h3>
        <p className="text-sm text-slate-500 text-center mb-6">
          <span className="font-semibold text-slate-700">{pendingCategoryToggle?.label}</span> and its checklist
          items will be removed from this audit for every assigned auditor. You can re-enable it later.
        </p>
        <div className="flex gap-3">
          <Button variant="neutral" size="md" fullWidth disabled={togglingCategory} onClick={() => setPendingCategoryToggle(null)}>
            Cancel
          </Button>
          <Button variant="danger" size="md" fullWidth disabled={togglingCategory} onClick={confirmCategoryToggle}>
            {togglingCategory && <Spinner size={13} className="animate-spin" />}
            Disable
          </Button>
        </div>
      </Modal>

      {/* Add Checklist Item Modal */}
      <Modal
        open={showAddItemModal}
        onClose={() => setShowAddItemModal(false)}
        size="md"
        panelClassName="overflow-hidden max-h-[90vh] flex flex-col"
        labelledBy="add-item-title"
        dismissable={!addingItem}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 bg-slate-50 border-b border-slate-100 rounded-t-2xl shrink-0">
          <div>
            <h3 id="add-item-title" className="text-base font-bold text-slate-900">Add Checklist Item</h3>
            <p className="text-xs text-slate-500 mt-0.5">Custom item for {selectedCategory}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddItemModal(false)}
            aria-label="Close"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <XIcon size={16} weight="bold" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto flex-1 px-6 py-5">
          {addItemError && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
              {addItemError}
            </div>
          )}

          <div>
            <label htmlFor="new-item-text" className="block text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">
              Question / Text *
            </label>
            <textarea
              id="new-item-text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="e.g. Does the app provide clear options to delete user accounts?"
              rows={3}
              className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              required
            />
          </div>

          <fieldset className="border-0 p-0 m-0">
            <legend className="text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">Severity</legend>
            <div className="flex items-center gap-2">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={newItemSeverity === opt.value}
                  onClick={() => setNewItemSeverity(opt.value)}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-semibold ring-1 transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                    newItemSeverity === opt.value
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-500 ring-slate-200 hover:text-slate-700 hover:ring-slate-300',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="new-item-reference" className="block text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">
              Clause Reference
            </label>
            <input
              id="new-item-reference"
              type="text"
              value={newItemReference}
              onChange={(e) => setNewItemReference(e.target.value)}
              placeholder="e.g. Clause 4.2"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>

          <div>
            <label htmlFor="new-item-help" className="block text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">
              Help &amp; Audit Guidance
            </label>
            <textarea
              id="new-item-help"
              value={newItemHelp}
              onChange={(e) => setNewItemHelp(e.target.value)}
              placeholder="Instructions or guidelines to help auditors verify compliance..."
              rows={3}
              className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>

          <div>
            <label htmlFor="new-item-trace" className="block text-2xs font-bold text-slate-400 uppercase tracking-wide mb-1">
              Traceability Mapping
            </label>
            <textarea
              id="new-item-trace"
              value={newItemTrace}
              onChange={(e) => setNewItemTrace(e.target.value)}
              placeholder="Code files, configuration settings, or process requirements mapping..."
              rows={3}
              className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 px-6 py-4 flex justify-end gap-3 shrink-0">
          <Button variant="secondary" size="xs" onClick={() => setShowAddItemModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="xs" onClick={handleAddItem} disabled={addingItem || !newItemText.trim()}>
            {addingItem ? <Spinner size={12} className="animate-spin" /> : <Plus size={12} weight="bold" />}
            Add Item
          </Button>
        </div>
      </Modal>

      {/* Delete Project Confirmation Modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        size="sm"
        panelClassName="p-6"
        labelledBy="delete-project-title"
        dismissable={!deleting}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-50 mx-auto mb-4">
          <Trash size={22} className="text-rose-500" />
        </div>
        <h3 id="delete-project-title" className="text-base font-bold text-slate-900 text-center mb-1">Delete Project</h3>
        <p className="text-sm text-slate-500 text-center mb-6">
          Are you sure you want to delete <span className="font-semibold text-slate-700">{project.name}</span>? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button variant="neutral" size="md" fullWidth disabled={deleting} onClick={() => setShowDeleteConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="md" fullWidth disabled={deleting} onClick={handleDeleteProject}>
            {deleting ? <Spinner size={13} className="animate-spin" /> : <Trash size={13} />}
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckIcon,
  WarningIcon as Warning,
  LockIcon as Lock,
  SpinnerIcon as Spinner,
  UserPlusIcon as UserPlus,
  XIcon,
  MagnifyingGlassIcon as MagnifyingGlass,
  BookOpenIcon as BookOpen,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import type { Platform } from '../../../types'
import AuditorAvatar from '../../../components/ui/AuditorAvatar'
import { buttonClasses } from '../../../components/ui/Button'
import { platformColor, platformTextColor } from '../../../lib/platformColors'

const PLATFORM_OPTIONS: Platform[] = [
  'TikTok', 'Instagram', 'Facebook', 'Snapchat', 'YouTube', 'Discord', 'X (Twitter)',
]

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
}
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

export default function CreateProjectPage() {
  const navigate = useNavigate()
  const { users, currentUserId, guidelines, createProject } = useStore()
  const currentUser = users.find((u) => u.id === currentUserId)!

  const [projectName, setProjectName] = useState('')
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [customPlatform, setCustomPlatform] = useState('')
  const isOther = platform === 'Other'
  const [selectedGuidelines, setSelectedGuidelines] = useState<string[]>([])
  const [selectedAuditors, setSelectedAuditors] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ name?: string; platform?: string; guidelines?: string }>({})
  const [submitted, setSubmitted] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  const platformRef = useRef<HTMLFieldSetElement>(null)
  const guidelinesRef = useRef<HTMLFieldSetElement>(null)

  const otherAuditors = users.filter((u) => u.id !== currentUserId && u.role === 'auditor')

  const [memberSearchQuery, setMemberSearchQuery] = useState('')

  const searchableAuditors = otherAuditors.filter(
    (u) =>
      !selectedAuditors.includes(u.id) &&
      u.name.toLowerCase().includes(memberSearchQuery.toLowerCase()),
  )

  const selectedAuditorUsers = otherAuditors.filter((u) => selectedAuditors.includes(u.id))

  if (currentUser?.role !== 'head_auditor') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Lock size={20} className="text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Access Restricted</h2>
        <p className="text-slate-500 text-sm max-w-xs">
          Only Head Auditors can create new audit projects.
        </p>
        <Link to="/projects" className="mt-4 text-blue-600 text-sm font-medium hover:text-blue-700 transition-colors">
          Back to Audits
        </Link>
      </div>
    )
  }

  function toggleGuideline(id: string) {
    setSelectedGuidelines((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    )
    if (errors.guidelines) setErrors((e) => ({ ...e, guidelines: undefined }))
  }

  function toggleAuditor(id: string) {
    setSelectedAuditors((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    )
  }

  function validate() {
    const newErrors: typeof errors = {}
    if (!projectName.trim()) newErrors.name = 'Enter a project name.'
    if (!platform) newErrors.platform = 'Select a platform to audit.'
    else if (platform === 'Other' && !customPlatform.trim()) newErrors.platform = 'Enter the platform name.'
    if (selectedGuidelines.length === 0) newErrors.guidelines = 'Select at least one guideline.'
    setErrors(newErrors)
    return newErrors
  }

  function focusFirstInvalid(current: typeof errors) {
    const target = current.name ? nameRef.current : current.platform ? platformRef.current : current.guidelines ? guidelinesRef.current : null
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (target instanceof HTMLInputElement) target.focus({ preventScroll: true })
  }

  const [creating, setCreating] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setCreateError(null)
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0 || !platform) {
      focusFirstInvalid(validationErrors)
      return
    }
    setCreating(true)
    const effectivePlatform = platform === 'Other' ? customPlatform.trim() : platform
    try {
      const id = await createProject({
        name: projectName.trim(),
        platform: effectivePlatform,
        guidelineIds: selectedGuidelines,
        auditorIds: selectedAuditors,
        dueDate: dueDate || undefined,
        notes,
      })
      navigate(`/projects/${id}`)
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? `Couldn't create this audit project: ${err.message}`
          : "Couldn't create this audit project. Check your connection and try again.",
      )
    } finally {
      setCreating(false)
    }
  }

  const errorList = submitted
    ? ([
        errors.name && { field: 'Project name', message: errors.name },
        errors.platform && { field: 'Platform', message: errors.platform },
        errors.guidelines && { field: 'Guidelines', message: errors.guidelines },
      ].filter(Boolean) as { field: string; message: string }[])
    : []

  const availableGuidelines = guidelines.filter((g) => !g.isDeleted && !g.projectId)

  const totalItems = selectedGuidelines.reduce((sum, gid) => {
    const g = guidelines.find((x) => x.id === gid)
    return sum + (g?.itemCount ?? 0)
  }, 0)

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-10">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-6 group"
      >
        <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
        Back to Audits
      </Link>

      <motion.div variants={container} initial="hidden" animate="show">
        <motion.div variants={item} className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Create New Audit
          </h1>
          <p className="text-slate-500 text-base mt-1.5 leading-relaxed">
            Set up a new compliance audit project. You can add checklist items and scope after creation.
          </p>
        </motion.div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-7">
            <div className="lg:col-span-2 space-y-7">

              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <label htmlFor="project-name" className="block text-base font-semibold text-slate-800 mb-1.5">
                  Project Name <span className="text-rose-400">*</span>
                </label>
                <p className="text-sm text-slate-500 mb-3">A descriptive name for this audit project.</p>
                {errors.name && submitted && (
                  <div id="project-name-error" className="flex items-center gap-2 text-rose-600 text-sm mb-3">
                    <Warning size={14} />
                    {errors.name}
                  </div>
                )}
                <input
                  id="project-name"
                  ref={nameRef}
                  type="text"
                  aria-invalid={submitted && !!errors.name}
                  aria-describedby={errors.name && submitted ? 'project-name-error' : undefined}
                  value={projectName}
                  onChange={(e) => { setProjectName(e.target.value); if (errors.name) setErrors((prev) => ({ ...prev, name: undefined })) }}
                  placeholder="e.g. TikTok with EDPD"
                  className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                />
              </motion.div>

              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6 ">
                <fieldset ref={platformRef} className="border-0 p-0 m-0">
                  <div className="flex items-center justify-between mb-4">
                    <legend className="text-base font-semibold text-slate-800 float-left">
                      Platform <span className="text-rose-400">*</span>
                    </legend>
                    {platform && (
                      <span className="text-sm text-blue-600 font-medium ml-auto">
                        {isOther ? (customPlatform.trim() || 'Other') : platform} selected
                      </span>
                    )}
                  </div>

                  {errors.platform && submitted && (
                    <div className="flex items-center gap-2 text-rose-600 text-sm mb-3">
                      <Warning size={14} />
                      {errors.platform}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {PLATFORM_OPTIONS.map((value) => {
                      const selected = platform === value
                      return (
                        <motion.button
                          key={value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            setPlatform(value)
                            if (errors.platform) setErrors((e) => ({ ...e, platform: undefined }))
                          }}
                          whileTap={{ scale: 0.97 }}
                          className={[
                            'relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all text-left',
                            'focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2',
                            selected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                          ].join(' ')}
                        >
                          <div className={`w-10 h-10 rounded-lg ${platformColor(value)} flex items-center justify-center`}>
                            <span className={`${platformTextColor(value)} text-xs font-bold`}>
                              {value.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span className={`text-sm font-medium ${selected ? 'text-blue-700' : 'text-slate-700'} text-center leading-tight`}>
                            {value}
                          </span>
                          {selected && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                              <CheckIcon size={11} weight="bold" className="text-white" />
                            </div>
                          )}
                        </motion.button>
                      )
                    })}

                    <motion.button
                      type="button"
                      aria-pressed={isOther}
                      onClick={() => {
                        setPlatform('Other')
                        if (errors.platform) setErrors((e) => ({ ...e, platform: undefined }))
                      }}
                      whileTap={{ scale: 0.97 }}
                      className={[
                        'relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all',
                        'focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2',
                        isOther
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center">
                        <span className="text-slate-500 text-xs font-bold">?</span>
                      </div>
                      <span className={`text-sm font-medium ${isOther ? 'text-blue-700' : 'text-slate-500'} text-center leading-tight`}>
                        Other
                      </span>
                      {isOther && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                          <CheckIcon size={11} weight="bold" className="text-white" />
                        </div>
                      )}
                    </motion.button>
                  </div>

                  {isOther && (
                    <div className="mt-3">
                      <label htmlFor="custom-platform" className="sr-only">Custom platform name</label>
                      <input
                        id="custom-platform"
                        type="text"
                        value={customPlatform}
                        onChange={(e) => {
                          setCustomPlatform(e.target.value)
                          if (errors.platform) setErrors((prev) => ({ ...prev, platform: undefined }))
                        }}
                        placeholder="Enter platform name (e.g. LinkedIn, Pinterest…)"
                        autoFocus
                        className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      />
                    </div>
                  )}
                </fieldset>
              </motion.div>

              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <fieldset ref={guidelinesRef} className="border-0 p-0 m-0">
                <div className="flex items-center justify-between mb-1.5">
                  <legend className="text-base font-semibold text-slate-800 float-left">
                    Compliance Guidelines <span className="text-rose-400">*</span>
                  </legend>
                  {selectedGuidelines.length > 0 && (
                    <span className="text-sm text-blue-600 font-medium ml-auto">
                      {selectedGuidelines.length} selected · {totalItems} items
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                  Select the regulatory frameworks to evaluate against. Each one adds its own checklist items to the audit.
                </p>

                {errors.guidelines && submitted && (
                  <div className="flex items-center gap-2 text-rose-600 text-sm mb-4">
                    <Warning size={14} />
                    {errors.guidelines}
                  </div>
                )}

                {availableGuidelines.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
                    <BookOpen size={26} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-600">No guideline frameworks available yet.</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                      An administrator needs to add at least one compliance framework before an
                      audit project can be created. Ask your admin to upload one, then come back here.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3">
                  {availableGuidelines.map((g) => {
                    const checked = selectedGuidelines.includes(g.id)
                    return (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleGuideline(g.id)}
                        className={[
                          'w-full text-left rounded-xl border-2 p-4 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
                          checked
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className="flex items-start gap-4">
                          <div className={[
                            'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                            checked ? 'bg-blue-600' : 'bg-slate-100',
                          ].join(' ')}>
                            <BookOpen size={18} className={checked ? 'text-white' : 'text-slate-500'} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <p className={`text-sm font-bold leading-tight ${checked ? 'text-blue-800' : 'text-slate-800'}`}>
                                {g.name}
                              </p>
                              <span className={[
                                'text-2xs font-mono px-1.5 py-0.5 rounded-md font-semibold',
                                checked ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
                              ].join(' ')}>
                                {g.shortName}
                              </span>
                              <span className="text-2xs font-mono bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-md">
                                v{g.version}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed mb-2">{g.description}</p>
                            {g.categories.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {Array.from(new Set(g.categories.map((cat) => cat.split(' > ')[0]))).map((section) => (
                                  <span key={section} className={[
                                    'text-2xs px-2 py-0.5 rounded-full font-medium',
                                    checked ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
                                  ].join(' ')}>
                                    {section}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="shrink-0 flex flex-col items-end gap-2">
                            <div className="text-right">
                              <p className={`font-mono text-base font-bold tabular-nums ${checked ? 'text-blue-700' : 'text-slate-700'}`}>
                                {g.itemCount}
                              </p>
                              <p className="text-2xs text-slate-400">items</p>
                            </div>
                            <div className={[
                              'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                              checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white',
                            ].join(' ')}>
                              {checked && <CheckIcon size={11} weight="bold" className="text-white" />}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                </fieldset>
              </motion.div>

              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6 ">
                <label htmlFor="project-notes" className="block text-base font-semibold text-slate-800 mb-1.5">
                  Notes
                  <span className="text-sm font-normal text-slate-400 ml-2">optional</span>
                </label>
                <p className="text-sm text-slate-500 mb-3">
                  Background context, scope limitations, or references for the audit team.
                </p>
                <textarea
                  id="project-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Focus on features accessible to under-13 users. Cross-reference the platform's published safety documentation."
                  rows={4}
                  className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                />
              </motion.div>
            </div>

            <div className="space-y-5">
              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-base font-semibold text-slate-800">Team Members</h2>
                  <span className="text-xs text-slate-400 font-mono">
                    {1 + selectedAuditors.length} member{selectedAuditors.length !== 0 ? 's' : ''}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mb-4">
                  You are the head auditor. Search and add auditors to collaborate on this project.
                </p>

                <div className="flex items-center gap-3 px-3 py-3 bg-blue-50 border border-blue-100 rounded-xl mb-3">
                  <AuditorAvatar user={currentUser} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{currentUser.name}</p>
                    <p className="text-xs text-blue-600 font-medium">Head Auditor — you</p>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <CheckIcon size={12} weight="bold" className="text-white" />
                  </div>
                </div>

                {selectedAuditorUsers.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {selectedAuditorUsers.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                        <AuditorAvatar user={u} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{u.name}</p>
                          <p className="text-xs text-slate-400 capitalize">{u.role.replace('_', ' ')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleAuditor(u.id)}
                          className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                          title="Remove"
                          aria-label={`Remove ${u.name}`}
                        >
                          <XIcon size={14} weight="bold" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
                    <MagnifyingGlass size={15} className="text-slate-400 shrink-0" />
                    <label htmlFor="member-search" className="sr-only">Search auditors to add</label>
                    <input
                      id="member-search"
                      type="text"
                      value={memberSearchQuery}
                      onChange={(e) => setMemberSearchQuery(e.target.value)}
                      placeholder="Search auditor to add…"
                      className="flex-1 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none bg-transparent rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    />
                    {memberSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setMemberSearchQuery('')}
                        aria-label="Clear auditor search"
                        className="text-slate-400 hover:text-slate-600 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        <XIcon size={14} weight="bold" />
                      </button>
                    )}
                  </div>

                  {searchableAuditors.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-400 text-center">
                      {memberSearchQuery ? 'No auditors match that name.' : 'All auditors have been added.'}
                    </p>
                  ) : (
                    <ul className="max-h-52 overflow-y-auto divide-y divide-slate-50">
                      {searchableAuditors.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => {
                              toggleAuditor(u.id)
                              setMemberSearchQuery('')
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                          >
                            <AuditorAvatar user={u} size="sm" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-700 truncate">{u.name}</p>
                              <p className="text-xs text-slate-400 capitalize">{u.role.replace('_', ' ')}</p>
                            </div>
                            <UserPlus size={14} className="text-blue-500 shrink-0" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.div>


              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <label htmlFor="due-date" className="block text-base font-semibold text-slate-800 mb-1">
                  Due Date
                  <span className="text-sm font-normal text-slate-400 ml-2">optional</span>
                </label>
                <p className="text-sm text-slate-500 mb-3">Target completion date for the audit.</p>
                <input
                  id="due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                />
              </motion.div>

              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <p className="text-xs text-slate-400 font-mono tracking-widest uppercase mb-4">Summary</p>
                <div className="space-y-3 divide-y divide-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Name</span>
                    <span className="text-sm font-medium text-slate-800 truncate max-w-[140px] text-right">
                      {projectName.trim() || <span className="text-slate-300">Not set</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-500">Platform</span>
                    <span className="text-sm font-medium text-slate-800">
                      {platform
                        ? (isOther ? (customPlatform.trim() || 'Other') : platform)
                        : <span className="text-slate-300">Not selected</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-500">Guidelines</span>
                    <span className="text-sm font-medium text-slate-800">
                      {selectedGuidelines.length > 0
                        ? `${selectedGuidelines.length} selected`
                        : <span className="text-slate-300">None</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-500">Checklist items</span>
                    <span className="font-mono text-sm font-semibold text-slate-800 tabular-nums">
                      {totalItems > 0 ? totalItems : <span className="text-slate-300">0</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-500">Auditors</span>
                    <span className="text-sm font-medium text-slate-800">
                      {1 + selectedAuditors.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-500">Due date</span>
                    <span className="text-sm font-medium text-slate-800">
                      {dueDate
                        ? new Date(dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : <span className="text-slate-300">Not set</span>}
                    </span>
                  </div>
                </div>
              </motion.div>

              <motion.div variants={item} className="flex flex-col gap-2.5">
                {errorList.length > 0 && (
                  <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                      <Warning size={14} weight="fill" />
                      Fix {errorList.length} item{errorList.length !== 1 ? 's' : ''} before creating
                    </p>
                    <ul className="mt-2 space-y-1 list-disc list-inside">
                      {errorList.map((e) => (
                        <li key={e.field} className="text-xs text-rose-600">
                          <span className="font-medium">{e.field}:</span> {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {createError && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                    <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />
                    <span>{createError}</span>
                  </div>
                )}

                <motion.button
                  type="submit"
                  disabled={creating}
                  whileTap={{ scale: 0.98 }}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-blue-600 text-white text-base font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2"
                >
                  {creating ? <><Spinner size={16} className="animate-spin" /> Creating…</> : <>Create Audit Project <ArrowRight size={16} weight="bold" /></>}
                </motion.button>
                <Link to="/projects" className={buttonClasses('secondary', 'md', 'w-full py-3')}>
                  Cancel
                </Link>
              </motion.div>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

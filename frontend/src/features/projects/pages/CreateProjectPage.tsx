import { useState } from 'react'
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

const PLATFORMS: { value: Platform; color: string; textColor: string }[] = [
  { value: 'TikTok', color: 'bg-slate-900', textColor: 'text-white' },
  { value: 'Instagram', color: 'bg-pink-500', textColor: 'text-white' },
  { value: 'Facebook', color: 'bg-blue-600', textColor: 'text-white' },
  { value: 'Snapchat', color: 'bg-yellow-400', textColor: 'text-slate-900' },
  { value: 'YouTube', color: 'bg-red-600', textColor: 'text-white' },
  { value: 'Discord', color: 'bg-indigo-500', textColor: 'text-white' },
  { value: 'X (Twitter)', color: 'bg-slate-900', textColor: 'text-white' },
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

  const otherAuditors = users.filter((u) => u.id !== currentUserId && u.role === 'auditor')

  // Team member search state
  const [memberSearchQuery, setMemberSearchQuery] = useState('')

  // Auditors not yet added, filtered by search
  const searchableAuditors = otherAuditors.filter(
    (u) =>
      !selectedAuditors.includes(u.id) &&
      u.name.toLowerCase().includes(memberSearchQuery.toLowerCase()),
  )

  // Already selected auditor objects
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
    return Object.keys(newErrors).length === 0
  }

  const [creating, setCreating] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!validate() || !platform) return
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
    } finally {
      setCreating(false)
    }
  }

  const totalItems = selectedGuidelines.reduce((sum, gid) => {
    const g = guidelines.find((x) => x.id === gid)
    return sum + (g?.itemCount ?? 0)
  }, 0)

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-10">
      {/* Back link */}
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-6 group"
      >
        <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
        Back to Audits
      </Link>

      <motion.div variants={container} initial="hidden" animate="show">
        {/* Page header */}
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
            {/* Left — main fields */}
            <div className="lg:col-span-2 space-y-7">

              {/* Project Name */}
              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <label htmlFor="project-name" className="block text-base font-semibold text-slate-800 mb-1.5">
                  Project Name <span className="text-rose-400">*</span>
                </label>
                <p className="text-sm text-slate-500 mb-3">A descriptive name for this audit project.</p>
                {errors.name && submitted && (
                  <div className="flex items-center gap-2 text-rose-600 text-sm mb-3">
                    <Warning size={14} />
                    {errors.name}
                  </div>
                )}
                <input
                  id="project-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => { setProjectName(e.target.value); if (errors.name) setErrors((prev) => ({ ...prev, name: undefined })) }}
                  placeholder="e.g. TikTok with EDPD"
                  className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                />
              </motion.div>

              {/* Platform selection */}
              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6 ">
                <div className="flex items-center justify-between mb-4">
                  <label className="text-base font-semibold text-slate-800">
                    Platform <span className="text-rose-400">*</span>
                  </label>
                  {platform && (
                    <span className="text-sm text-blue-600 font-medium">
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
                  {PLATFORMS.map(({ value, color, textColor }) => {
                    const selected = platform === value
                    return (
                      <motion.button
                        key={value}
                        type="button"
                        onClick={() => {
                          setPlatform(value)
                          if (errors.platform) setErrors((e) => ({ ...e, platform: undefined }))
                        }}
                        whileTap={{ scale: 0.97 }}
                        className={[
                          'relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all text-left',
                          'focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1',
                          selected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
                          <span className={`${textColor} text-xs font-bold`}>
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

                  {/* Other — custom platform */}
                  <motion.button
                    type="button"
                    onClick={() => {
                      setPlatform('Other')
                      if (errors.platform) setErrors((e) => ({ ...e, platform: undefined }))
                    }}
                    whileTap={{ scale: 0.97 }}
                    className={[
                      'relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all',
                      'focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1',
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

                {/* Custom platform name input */}
                {isOther && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={customPlatform}
                      onChange={(e) => {
                        setCustomPlatform(e.target.value)
                        if (errors.platform) setErrors((prev) => ({ ...prev, platform: undefined }))
                      }}
                      placeholder="Enter platform name (e.g. LinkedIn, Pinterest…)"
                      autoFocus
                      className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                    />
                  </div>
                )}
              </motion.div>

              {/* Guidelines */}
              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-base font-semibold text-slate-800">
                    Compliance Guidelines <span className="text-rose-400">*</span>
                  </label>
                  {selectedGuidelines.length > 0 && (
                    <span className="text-sm text-blue-600 font-medium">
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

                <div className="grid grid-cols-1 gap-3">
                  {guidelines.filter(g => !g.isDeleted && !g.projectId).map((g) => {
                    const checked = selectedGuidelines.includes(g.id)
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggleGuideline(g.id)}
                        className={[
                          'w-full text-left rounded-xl border-2 p-4 transition-all focus-visible:outline-2 focus-visible:outline-blue-400',
                          checked
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50',
                        ].join(' ')}
                      >
                        <div className="flex items-start gap-4">
                          {/* Icon */}
                          <div className={[
                            'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                            checked ? 'bg-blue-600' : 'bg-slate-100',
                          ].join(' ')}>
                            <BookOpen size={18} className={checked ? 'text-white' : 'text-slate-500'} />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <p className={`text-sm font-bold leading-tight ${checked ? 'text-blue-800' : 'text-slate-800'}`}>
                                {g.name}
                              </p>
                              <span className={[
                                'text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold',
                                checked ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
                              ].join(' ')}>
                                {g.shortName}
                              </span>
                              <span className="text-[10px] font-mono bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">
                                v{g.version}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed mb-2">{g.description}</p>
                            {/* Category chips */}
                            {g.categories.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {Array.from(new Set(g.categories.map((cat) => cat.split(' > ')[0]))).map((section) => (
                                  <span key={section} className={[
                                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                                    checked ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
                                  ].join(' ')}>
                                    {section}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Right: item count + checkbox */}
                          <div className="shrink-0 flex flex-col items-end gap-2">
                            <div className="text-right">
                              <p className={`font-mono text-base font-bold tabular-nums ${checked ? 'text-blue-700' : 'text-slate-700'}`}>
                                {g.itemCount}
                              </p>
                              <p className="text-[10px] text-slate-400">items</p>
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
              </motion.div>

              {/* Notes */}
              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6 ">
                <label className="block text-base font-semibold text-slate-800 mb-1.5">
                  Notes
                  <span className="text-sm font-normal text-slate-400 ml-2">optional</span>
                </label>
                <p className="text-sm text-slate-500 mb-3">
                  Background context, scope limitations, or references for the audit team.
                </p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Focus on features accessible to under-13 users. Cross-reference the platform's published safety documentation."
                  rows={4}
                  className="w-full text-sm text-slate-700 placeholder:text-slate-300 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent leading-relaxed transition-all"
                />
              </motion.div>
            </div>

            {/* Right — team + due date + summary */}
            <div className="space-y-5">
              {/* Team */}
              <motion.div variants={item} className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-base font-semibold text-slate-800">Team Members</label>
                  <span className="text-xs text-slate-400 font-mono">
                    {1 + selectedAuditors.length} member{selectedAuditors.length !== 0 ? 's' : ''}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mb-4">
                  You are the head auditor. Search and add auditors to collaborate on this project.
                </p>

                {/* Current user — always included */}
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

                {/* Added auditors list */}
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
                          className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Remove"
                        >
                          <XIcon size={14} weight="bold" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Member search — always visible */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  {/* Search input */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
                    <MagnifyingGlass size={15} className="text-slate-400 shrink-0" />
                    <input
                      type="text"
                      value={memberSearchQuery}
                      onChange={(e) => setMemberSearchQuery(e.target.value)}
                      placeholder="Search auditor to add…"
                      className="flex-1 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none bg-transparent"
                    />
                    {memberSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setMemberSearchQuery('')}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <XIcon size={14} weight="bold" />
                      </button>
                    )}
                  </div>

                  {/* Results */}
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
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left"
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


              {/* Due date */}
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
                  className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition-all"
                />
              </motion.div>

              {/* Summary card */}
              <motion.div variants={item} className="bg-slate-950 border border-slate-800 rounded-xl p-6">
                <p className="text-xs text-slate-500 font-mono tracking-widest uppercase mb-4">Summary</p>
                <div className="space-y-3 divide-y divide-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Name</span>
                    <span className="text-sm font-medium text-white truncate max-w-[140px] text-right">
                      {projectName.trim() || <span className="text-slate-600">Not set</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-400">Platform</span>
                    <span className="text-sm font-medium text-white">
                      {platform
                        ? (isOther ? (customPlatform.trim() || 'Other') : platform)
                        : <span className="text-slate-600">Not selected</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-400">Guidelines</span>
                    <span className="text-sm font-medium text-white">
                      {selectedGuidelines.length > 0
                        ? `${selectedGuidelines.length} selected`
                        : <span className="text-slate-600">None</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-400">Checklist items</span>
                    <span className="font-mono text-sm font-semibold text-white tabular-nums">
                      {totalItems > 0 ? totalItems : <span className="text-slate-600">0</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-400">Auditors</span>
                    <span className="text-sm font-medium text-white">
                      {1 + selectedAuditors.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm text-slate-400">Due date</span>
                    <span className="text-sm font-medium text-white">
                      {dueDate
                        ? new Date(dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : <span className="text-slate-600">Not set</span>}
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* Actions */}
              <motion.div variants={item} className="flex flex-col gap-2.5">
                <motion.button
                  type="submit"
                  disabled={creating}
                  whileTap={{ scale: 0.98 }}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-blue-600 text-white text-base font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1"
                >
                  {creating ? <><Spinner size={16} className="animate-spin" /> Creating…</> : <>Create Audit Project <ArrowRight size={16} weight="bold" /></>}
                </motion.button>
                <Link
                  to="/projects"
                  className="w-full flex items-center justify-center px-5 py-3 text-slate-600 text-sm font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                >
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

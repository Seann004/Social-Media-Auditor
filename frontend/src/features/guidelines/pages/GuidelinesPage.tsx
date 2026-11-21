import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CaretDownIcon as CaretDown,
  BookOpenIcon as BookOpen,
  TrashIcon as Trash,
  MagnifyingGlassIcon as MagnifyingGlass,
  XIcon,
} from '@phosphor-icons/react'
import type { ChecklistItem } from '../../../types'
import { useStore } from '../../../store/useStore'
import Button from '../../../components/ui/Button'
import ChecklistItemDetailModal from '../../audits/components/ChecklistItemDetailModal'
import LinkedItemsPanel from '../components/LinkedItemsPanel'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}
const cardVar = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

function GuidelinesSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-slate-200 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-slate-200" />
            <div className="h-3 w-2/3 rounded bg-slate-100" />
          </div>
          <div className="h-8 w-20 rounded-md bg-slate-100 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function matchesQuery(item: ChecklistItem, q: string) {
  return (
    item.text.toLowerCase().includes(q) ||
    (item.itemName ?? '').toLowerCase().includes(q) ||
    (item.itemCode ?? '').toLowerCase().includes(q) ||
    (item.reference ?? '').toLowerCase().includes(q) ||
    item.category.toLowerCase().includes(q)
  )
}

export default function GuidelinesPage() {
  const { guidelines, checklistItems, users, currentUserId, deleteGuideline, loading } = useStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedCat, setExpandedCat] = useState<Set<string>>(new Set())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedItemForModal, setSelectedItemForModal] = useState<ChecklistItem | null>(null)
  const [itemModalTab, setItemModalTab] = useState<'help' | 'traceability'>('help')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'frameworks' | 'links'>('frameworks')

  const currentUser = users.find((u) => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'admin'
  const isAuditor = currentUser?.role === 'auditor'

  const activeGuidelines = useMemo(
    () => guidelines.filter((g) => !g.isDeleted && !g.projectId),
    [guidelines],
  )

  const query = search.trim().toLowerCase()

  const searchResults = useMemo(() => {
    if (!query) return null
    const itemsByGuideline = new Map<string, ChecklistItem[]>()
    for (const ci of checklistItems) {
      if (!matchesQuery(ci, query)) continue
      const list = itemsByGuideline.get(ci.guidelineId)
      if (list) list.push(ci)
      else itemsByGuideline.set(ci.guidelineId, [ci])
    }
    const guidelineIds = new Set<string>()
    const categoryKeys = new Set<string>()
    const itemIds = new Set<string>()
    for (const g of activeGuidelines) {
      const matchedItems = itemsByGuideline.get(g.id) ?? []
      const guidelineMatches =
        g.name.toLowerCase().includes(query) ||
        g.shortName.toLowerCase().includes(query) ||
        g.description.toLowerCase().includes(query)
      const matchedCategories = g.categories.filter((cat) => cat.toLowerCase().includes(query))
      if (!guidelineMatches && matchedItems.length === 0 && matchedCategories.length === 0) continue

      guidelineIds.add(g.id)
      if (guidelineMatches) {
        for (const cat of g.categories) categoryKeys.add(`${g.id}_${cat}`)
        for (const ci of checklistItems) {
          if (ci.guidelineId === g.id) itemIds.add(ci.id)
        }
        continue
      }
      for (const cat of matchedCategories) {
        categoryKeys.add(`${g.id}_${cat}`)
        for (const ci of checklistItems) {
          if (ci.guidelineId === g.id && ci.category === cat) itemIds.add(ci.id)
        }
      }
      for (const ci of matchedItems) {
        categoryKeys.add(`${g.id}_${ci.category}`)
        itemIds.add(ci.id)
      }
    }
    return { guidelineIds, categoryKeys, itemIds }
  }, [query, activeGuidelines, checklistItems])

  const visibleGuidelines = searchResults
    ? activeGuidelines.filter((g) => searchResults.guidelineIds.has(g.id))
    : activeGuidelines
  const matchCount = searchResults ? searchResults.itemIds.size : 0

  function toggleGuideline(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCat(key: string) {
    setExpandedCat((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleDeleteGuideline(id: string) {
    deleteGuideline(id)
    setConfirmDeleteId(null)
    setExpanded((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  if (isAuditor) return <Navigate to="/projects" replace />

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        className="flex items-center justify-between mb-7"
      >
        <div>
          {isAdmin ? (
            <>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Guidelines</h1>
              <p className="text-slate-500 text-base mt-1.5">You have Admin access. Manage compliance guidelines below.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Guidelines</h1>
              <p className="text-slate-500 text-base mt-1">
                {activeGuidelines.length} frameworks ·{' '}
                {checklistItems.filter((ci) => activeGuidelines.some((g) => g.id === ci.guidelineId)).length} total checklist items
              </p>
            </>
          )}
        </div>
      </motion.div>

      {isAdmin && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl mb-7"
        >
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-sm text-slate-500 font-medium mb-2">Guidelines</p>
            <p className="text-3xl font-semibold text-slate-900 tabular-nums">{activeGuidelines.length}</p>
            <p className="text-sm text-slate-400 mt-1">Regulatory frameworks loaded</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
            <p className="text-sm text-slate-500 font-medium mb-2">Checklist Items</p>
            <p className="text-3xl font-semibold text-slate-900 tabular-nums">
              {checklistItems.filter((ci) => activeGuidelines.some((g) => g.id === ci.guidelineId)).length}
            </p>
            <p className="text-sm text-slate-400 mt-1">Total across all frameworks</p>
          </div>
        </motion.div>
      )}

      {isAdmin && (
      <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {([['frameworks', 'Frameworks'], ['links', 'Linked items']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              view === key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      )}

      {isAdmin && view === 'links' ? (
        <LinkedItemsPanel guidelines={activeGuidelines} />
      ) : (
      <>
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <label htmlFor="guideline-search" className="sr-only">Search guidelines and checklist items</label>
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            id="guideline-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search frameworks, categories or checklist items…"
            className="w-full pl-9 pr-9 py-2.5 text-sm text-slate-700 bg-white border border-slate-200 rounded-lg placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <XIcon size={13} weight="bold" />
            </button>
          )}
        </div>
        {query && (
          <p className="text-xs text-slate-500 tabular-nums" role="status">
            {matchCount} item{matchCount !== 1 ? 's' : ''} in {visibleGuidelines.length} framework
            {visibleGuidelines.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {loading && activeGuidelines.length === 0 ? (
        <GuidelinesSkeleton />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
          {activeGuidelines.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-slate-400 text-sm">No guidelines available. Upload a guideline to get started.</p>
            </div>
          )}
          {activeGuidelines.length > 0 && visibleGuidelines.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-slate-400 text-sm">Nothing matches "{search.trim()}".</p>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-blue-600 text-sm mt-1 hover:text-blue-700 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Clear search
              </button>
            </div>
          )}
          {visibleGuidelines.map((guideline) => {
            const isOpen = searchResults ? true : expanded.has(guideline.id)
            const items = checklistItems.filter((ci) => ci.guidelineId === guideline.id)
            const criticalCount = items.filter((ci) => ci.severity === 'critical').length
            const isConfirmingDelete = confirmDeleteId === guideline.id
            const visibleCategories = searchResults
              ? guideline.categories.filter((cat) => searchResults.categoryKeys.has(`${guideline.id}_${cat}`))
              : guideline.categories

            return (
              <motion.div
                key={guideline.id}
                variants={cardVar}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => toggleGuideline(guideline.id)}
                    aria-expanded={isOpen}
                    className="flex-1 min-w-0 flex items-center gap-4 px-6 py-5 hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 text-left"
                  >
                    <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                      <BookOpen size={16} className="text-blue-600" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-base font-semibold text-slate-800 truncate" title={guideline.name}>{guideline.name}</p>
                        <span className="shrink-0 whitespace-nowrap text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-mono">
                          v{guideline.version}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed truncate" title={guideline.description}>
                        {guideline.description}
                      </p>
                    </div>

                    <div className="hidden sm:grid grid-cols-[3.5rem_3.5rem_8.5rem] gap-4 items-center shrink-0">
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-slate-700 tabular-nums">{items.length}</p>
                        <p className="text-2xs text-slate-400">items</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-rose-600 tabular-nums">{criticalCount}</p>
                        <p className="text-2xs text-slate-400">critical</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-2xs text-slate-500 truncate">
                          {guideline.categories.length} {guideline.categories.length === 1 ? 'category' : 'categories'}
                        </p>
                        <p className="text-2xs text-slate-400 truncate" title={guideline.source}>{guideline.source}</p>
                      </div>
                    </div>

                    <motion.div
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                      className="shrink-0"
                    >
                      <CaretDown size={15} className="text-slate-400" />
                    </motion.div>
                  </button>

                  {isAdmin && (
                    <div className="px-4 border-l border-slate-100 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(guideline.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
                        title="Delete guideline"
                        aria-label={`Delete ${guideline.name}`}
                      >
                        <Trash size={15} />
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {isConfirmingDelete && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mx-6 mb-4 flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
                        <p className="text-xs text-rose-700 flex-1">
                          Permanently delete <strong>{guideline.name}</strong> and all its checklist items? This cannot be undone.
                        </p>
                        <Button variant="danger" size="xs" className="shrink-0" onClick={() => handleDeleteGuideline(guideline.id)}>
                          Delete
                        </Button>
                        <Button variant="secondary" size="xs" className="shrink-0" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 28 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-slate-100 px-5 py-4">
                        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                          {guideline.description} Source:{' '}
                          <span className="text-slate-600 font-medium">{guideline.source}</span>
                          {guideline.lastUpdated && <>{' ·'} Last updated: <span className="font-mono text-slate-600">{guideline.lastUpdated}</span></>}
                        </p>

                        <div className="space-y-6">
                          {Object.entries(
                            visibleCategories.reduce<Record<string, string[]>>((acc, cat) => {
                              const section = cat.split(' > ')[0]
                              if (!acc[section]) acc[section] = []
                              acc[section].push(cat)
                              return acc
                            }, {})
                          ).map(([section, cats], sIdx) => (
                            <div key={section} className="space-y-2">
                              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-4 mb-2 px-1">
                                {sIdx + 1}. {section}
                              </h4>
                              <div className="space-y-2 pl-3 border-l border-slate-100">
                                {cats.map((cat, subIdx) => {
                                  const catKey = `${guideline.id}_${cat}`
                                  const allCatItems = items.filter((ci) => ci.category === cat)
                                  const catItems = searchResults
                                    ? allCatItems.filter((ci) => searchResults.itemIds.has(ci.id))
                                    : allCatItems
                                  const catOpen = searchResults ? true : expandedCat.has(catKey)
                                  const displayName = cat.includes(' > ') ? cat.split(' > ').slice(1).join(' → ') : cat

                                  return (
                                    <div key={cat} className="border border-slate-100 rounded-lg overflow-hidden bg-white">
                                      <button
                                        type="button"
                                        onClick={() => toggleCat(catKey)}
                                        aria-expanded={catOpen}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                                      >
                                        <p className="flex-1 text-xs font-semibold text-slate-700">{sIdx + 1}.{subIdx + 1} {displayName}</p>
                                        <div className="flex items-center gap-3">
                                          <span className="text-2xs text-slate-400 font-mono">
                                            {catItems.length} item{catItems.length !== 1 ? 's' : ''}
                                          </span>
                                          <motion.div
                                            animate={{ rotate: catOpen ? 180 : 0 }}
                                            transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                                          >
                                            <CaretDown size={12} className="text-slate-400" />
                                          </motion.div>
                                        </div>
                                      </button>

                                      <AnimatePresence>
                                        {catOpen && (
                                          <motion.div
                                            initial={{ height: 0 }}
                                            animate={{ height: 'auto' }}
                                            exit={{ height: 0 }}
                                            transition={{ type: 'spring', stiffness: 200, damping: 28 }}
                                            className="overflow-hidden"
                                          >
                                            <div className="divide-y divide-slate-50 border-t border-slate-100">
                                              {catItems.map((ci, itemIdx) => (
                                                <div key={ci.id} className="flex items-start gap-3 px-4 py-3 bg-slate-50/50">
                                                  <p className="flex-1 text-xs text-slate-700 leading-relaxed">
                                                    {ci.itemCode ? '' : `${itemIdx + 1}. `}{ci.text}
                                                  </p>
                                                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                                    <button
                                                      type="button"
                                                      onClick={() => { setSelectedItemForModal(ci); setItemModalTab('help'); }}
                                                      className="text-2xs text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 px-2 py-0.5 rounded-md transition-colors cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                                    >
                                                      Help
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => { setSelectedItemForModal(ci); setItemModalTab('traceability'); }}
                                                      className="text-2xs text-slate-500 bg-slate-100 hover:bg-slate-200 border border-slate-200/60 font-mono px-2 py-0.5 rounded-md transition-colors cursor-pointer shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                                    >
                                                      {ci.reference || 'N/A'}
                                                    </button>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </motion.div>
      )}
      </>
      )}

      <ChecklistItemDetailModal
        item={selectedItemForModal}
        tab={itemModalTab}
        onClose={() => setSelectedItemForModal(null)}
      />
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ListIcon as List,
  ShieldCheckIcon as ShieldCheck,
} from '@phosphor-icons/react'
import Sidebar from './Sidebar'
import { useStore } from '../store/useStore'
import { useRealtimeGuidelines } from '../hooks/useRealtimeGuidelines'

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const initFromDb = useStore((s) => s.initFromDb)

  useRealtimeGuidelines()

  useEffect(() => {
    initFromDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-page-bg print:block print:h-auto print:overflow-visible">
      {/* Mobile backdrop */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-20 lg:hidden"
            onClick={() => setDrawerOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar — fixed drawer on mobile, static on desktop */}
      <div
        className={[
          'fixed inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out print:hidden',
          'lg:static lg:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <Sidebar onClose={() => setDrawerOpen(false)} />
      </div>

      {/* Main content column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden print:block print:overflow-visible">
        {/* Mobile-only top bar */}
        <div className="lg:hidden print:hidden flex items-center gap-3 px-4 h-14 bg-primary shrink-0 border-b border-primary-hover">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <List size={22} weight="bold" />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} weight="bold" className="text-white" />
            <span className="text-white font-bold text-base tracking-tight">SafetyAudit</span>
          </div>
        </div>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden print:overflow-visible print:h-auto print:block">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

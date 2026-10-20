import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useStore } from '../store/useStore'
import { useRealtimeGuidelines } from '../hooks/useRealtimeGuidelines'

const DESKTOP_QUERY = '(min-width: 1024px)'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setIsDesktop(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const initFromDb = useStore((s) => s.initFromDb)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const isDesktop = useIsDesktop()

  useRealtimeGuidelines()

  useEffect(() => {
    initFromDb()
  }, [])

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false)
  }, [isDesktop])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return
      const target = e.target as HTMLElement
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-page-bg print:block print:h-auto print:overflow-visible">
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

      <div
        className={[
          'fixed inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out print:hidden',
          'lg:static lg:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {isDesktop ? (
          <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
        ) : (
          <Sidebar collapsed={false} onClose={() => setDrawerOpen(false)} />
        )}
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden print:block print:overflow-visible">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-none print:overflow-visible print:h-auto print:block">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

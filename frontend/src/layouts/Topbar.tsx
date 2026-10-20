import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ListIcon as List,
  PlusIcon as Plus,
  UploadSimpleIcon as UploadSimple,
  CaretDownIcon as CaretDown,
  SignOutIcon as SignOut,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import Modal from '../components/ui/Modal'
import Button, { buttonClasses } from '../components/ui/Button'

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { users, currentUserId, logout } = useStore()
  const user = users.find((u) => u.id === currentUserId)
  const navigate = useNavigate()
  const [hour, setHour] = useState(() => new Date().getHours())
  const [menuOpen, setMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  const firstName = user?.name.split(' ')[0]

  return (
    <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 md:px-8 print:hidden">
      <button
        type="button"
        onClick={onOpenMenu}
        className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        aria-label="Open menu"
      >
        <List size={22} weight="bold" />
      </button>

      <p className="flex-1 min-w-0 truncate text-base font-semibold text-slate-800">
        {greetingFor(hour)}{firstName ? `, ${firstName}` : ''}
      </p>

      {user?.role === 'head_auditor' && (
        <Link to="/projects/new" className={buttonClasses('primary', 'sm', 'shrink-0')}>
          <Plus size={14} weight="bold" />
          <span className="hidden sm:inline">New Audit</span>
        </Link>
      )}
      {user?.role === 'admin' && (
        <Link to="/generator" className={buttonClasses('primary', 'sm', 'shrink-0')}>
          <UploadSimple size={14} weight="bold" />
          <span className="hidden sm:inline">Upload Guideline</span>
        </Link>
      )}

      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={user ? `Account menu for ${user.name}` : 'Account menu'}
          className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span className={`w-8 h-8 rounded-full ${user?.color ?? 'bg-slate-700'} flex items-center justify-center`}>
            <span className="text-on-dark text-xs font-bold">{user?.initials}</span>
          </span>
          <CaretDown size={12} weight="bold" className="text-slate-400" />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-30 py-1.5"
            >
              <div className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-800 truncate">{user?.name}</p>
                <p className="text-xs text-slate-500 capitalize">{user?.role.replace('_', ' ')}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); setShowLogoutConfirm(true) }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
              >
                <SignOut size={15} />
                Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Modal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        size="sm"
        panelClassName="p-6"
        labelledBy="signout-modal-title"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mx-auto mb-4">
          <SignOut size={22} className="text-slate-500" />
        </div>
        <h3 id="signout-modal-title" className="text-base font-bold text-slate-900 text-center mb-1">Sign Out</h3>
        <p className="text-sm text-slate-500 text-center mb-6">
          Are you sure you want to sign out of SafetyAudit?
        </p>
        <div className="flex gap-3">
          <Button variant="neutral" size="md" fullWidth onClick={() => setShowLogoutConfirm(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" fullWidth onClick={handleLogout}>
            <SignOut size={13} />
            Sign Out
          </Button>
        </div>
      </Modal>
    </header>
  )
}

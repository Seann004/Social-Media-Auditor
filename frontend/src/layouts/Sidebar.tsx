import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ShieldCheckIcon as ShieldCheck,
  SquaresFourIcon as SquaresFour,
  FolderOpenIcon as FolderOpen,
  ListChecksIcon as ListChecks,
  ChartBarIcon as ChartBar,
  SignOutIcon as SignOut,
  XIcon,
  MagicWandIcon as Wand,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}
const navItem = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const { users, currentUserId, projects, logout } = useStore()
  const user = users.find((u) => u.id === currentUserId)
  const location = useLocation()
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const isAdmin = user?.role === 'admin'
  const isAuditor = user?.role === 'auditor'

  const nextDue = [...projects]
    .filter((p) => (p.status === 'in_progress' || p.status === 'under_review') && p.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]

  const NAV = isAdmin
    ? [
        { to: '/dashboard', label: 'Dashboard', icon: SquaresFour, exact: true },
        { to: '/generator', label: 'Generator', icon: Wand, exact: false },
      ]
    : isAuditor
    ? [
        { to: '/dashboard', label: 'Dashboard', icon: SquaresFour, exact: true },
        { to: '/projects', label: 'Audits', icon: FolderOpen, exact: false },
        { to: '/reports', label: 'Reports', icon: ChartBar, exact: false },
      ]
    : [
        { to: '/dashboard', label: 'Dashboard', icon: SquaresFour, exact: true },
        { to: '/projects', label: 'Audits', icon: FolderOpen, exact: false },
        { to: '/guidelines', label: 'Guidelines', icon: ListChecks, exact: false },
        { to: '/reports', label: 'Reports', icon: ChartBar, exact: false },
      ]

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  return (
    <aside className="w-72 shrink-0 h-screen bg-sidebar-bg flex flex-col overflow-y-auto">
      <div className="px-6 pt-7 pb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.22)] flex items-center justify-center shrink-0">
              <ShieldCheck size={18} weight="bold" className="text-on-dark" />
            </div>
            <span className="text-on-dark font-bold tracking-tight text-lg">SafetyAudit</span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="lg:hidden p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <XIcon size={18} weight="bold" />
            </button>
          )}
        </div>
        <p className="text-sidebar-muted text-xs mt-2 font-mono tracking-[0.1em] uppercase">
          Compliance Audit Platform
        </p>
      </div>

      <div className="mx-5 border-t border-sidebar-border" />

      <nav className="flex-1 px-4 py-5">
        <motion.ul variants={container} initial="hidden" animate="show" className="space-y-1 list-none m-0 p-0">
          {NAV.map(({ to, label, icon: Icon, exact }) => {
            const active = exact
              ? location.pathname === to
              : location.pathname.startsWith(to)
            return (
              <motion.li key={to} variants={navItem}>
                <NavLink
                  to={to}
                  onClick={onClose}
                  className={[
                    'flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all duration-150',
                    'focus-visible:outline-2 focus-visible:outline-primary-muted focus-visible:outline-offset-1',
                    active
                      ? 'bg-sidebar-item-active text-on-dark'
                      : 'text-sidebar-text hover:text-sidebar-text-hover hover:bg-[var(--color-sidebar-item-hover)]',
                  ].join(' ')}
                >
                  <Icon
                    size={20}
                    weight={active ? 'fill' : 'regular'}
                    className={active ? 'text-on-dark' : ''}
                  />
                  <span>{label}</span>
                </NavLink>
              </motion.li>
            )
          })}
        </motion.ul>

        {!isAdmin && nextDue && (
          <div className="mt-7">
            <p className="px-4 text-xs text-sidebar-muted font-mono tracking-widest uppercase mb-2">
              Next deadline
            </p>
            <NavLink
              to={`/projects/${nextDue.id}`}
              className="block px-4 py-3 rounded-xl bg-[var(--color-sidebar-item-hover)] hover:bg-sidebar-item-active transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-muted"
            >
              <p className="text-sidebar-text-hover text-sm font-semibold truncate">{nextDue.name}</p>
              <p className="text-sidebar-muted text-xs mt-0.5">
                Due {new Date(`${nextDue.dueDate!.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </p>
            </NavLink>
          </div>
        )}
      </nav>

      <div className="px-4 pb-5 pt-3 border-t border-sidebar-border">
        <button
          type="button"
          onClick={() => setShowLogoutConfirm(true)}
          aria-label={user ? `Sign out (${user.name})` : 'Sign out'}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[var(--color-sidebar-item-hover)] transition-colors group focus-visible:outline-2 focus-visible:outline-[rgba(255,255,255,0.5)] focus-visible:outline-offset-1"
        >
          <div
            className={`w-9 h-9 rounded-full ${user?.color ?? 'bg-slate-700'} flex items-center justify-center shrink-0`}
          >
            <span className="text-on-dark text-xs font-bold">{user?.initials}</span>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sidebar-text-hover text-sm font-semibold truncate">{user?.name}</p>
            <p className="text-sidebar-muted text-xs capitalize">
              {user?.role.replace('_', ' ')}
            </p>
          </div>
          <SignOut
            size={16}
            className="text-sidebar-muted group-hover:text-sidebar-text transition-colors shrink-0"
          />
        </button>
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
    </aside>
  )
}

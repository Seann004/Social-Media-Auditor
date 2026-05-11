import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ShieldCheckIcon as ShieldCheck,
  SquaresFourIcon as SquaresFour,
  FolderOpenIcon as FolderOpen,
  ListChecksIcon as ListChecks,
  ChartBarIcon as ChartBar,
  SignOutIcon as SignOut,
} from '@phosphor-icons/react'
import { useStore } from '../store/useStore'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: SquaresFour, exact: true },
  { to: '/projects', label: 'Audits', icon: FolderOpen, exact: false },
  { to: '/guidelines', label: 'Guidelines', icon: ListChecks, exact: false },
  { to: '/reports', label: 'Reports', icon: ChartBar, exact: false },
]

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}
const navItem = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

export default function Sidebar() {
  const { users, currentUserId, projects, logout } = useStore()
  const user = users.find((u) => u.id === currentUserId)
  const location = useLocation()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  const nextDue = [...projects]
    .filter((p) => p.status === 'in_progress' && p.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]

  return (
    <aside className="w-56 shrink-0 min-h-[100dvh] bg-slate-950 flex flex-col">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-[8px] bg-blue-600 flex items-center justify-center shrink-0 ring-1 ring-blue-400/30 shadow-[0_2px_8px_oklch(0.45_0.2_250_/_0.4)]">
            <ShieldCheck size={15} weight="bold" className="text-white" />
          </div>
          <span className="text-white font-semibold tracking-tight text-sm">SafetyAudit</span>
        </div>
        <p className="text-slate-600 text-[10px] mt-1.5 font-mono tracking-[0.1em] uppercase">
          Child Safety Platform
        </p>
      </div>

      <div className="mx-4 border-t border-slate-800/80" />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4">
        <motion.ul variants={container} initial="hidden" animate="show" className="space-y-0.5 list-none m-0 p-0">
          {NAV.map(({ to, label, icon: Icon, exact }) => {
            const active = exact
              ? location.pathname === to || (to === '/dashboard' && location.pathname === '/dashboard')
              : location.pathname.startsWith(to)
            return (
              <motion.li key={to} variants={navItem}>
                <NavLink
                  to={to}
                  className={[
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150',
                    'focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1',
                    active
                      ? 'bg-slate-800 text-white ring-1 ring-white/[0.06] shadow-[0_1px_4px_oklch(0.08_0.01_250_/_0.4)]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',
                  ].join(' ')}
                >
                  <Icon
                    size={16}
                    weight={active ? 'fill' : 'regular'}
                    className={active ? 'text-blue-400' : ''}
                  />
                  <span className="font-medium">{label}</span>
                </NavLink>
              </motion.li>
            )
          })}
        </motion.ul>

        {nextDue && (
          <div className="mt-6">
            <p className="px-3 text-[10px] text-slate-600 font-mono tracking-widest uppercase mb-2">
              Next deadline
            </p>
            <NavLink
              to={`/projects/${projects.find((p) => p.dueDate === nextDue.dueDate)?.id}`}
              className="block px-3 py-2.5 rounded-lg bg-slate-800/40 hover:bg-slate-800/70 transition-colors"
            >
              <p className="text-slate-200 text-xs font-medium">{nextDue.platform} Audit</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                Due{' '}
                {new Date(nextDue.dueDate!).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })}
              </p>
            </NavLink>
          </div>
        )}
      </nav>

      {/* User profile */}
      <div className="px-3 pb-4 pt-3 border-t border-slate-800/60">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/50 transition-colors group focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1"
        >
          <div
            className={`w-7 h-7 rounded-full ${user?.color ?? 'bg-slate-700'} flex items-center justify-center shrink-0`}
          >
            <span className="text-white text-[10px] font-bold">{user?.initials}</span>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-slate-200 text-xs font-medium truncate">{user?.name}</p>
            <p className="text-slate-500 text-[10px] capitalize">
              {user?.role.replace('_', ' ')}
            </p>
          </div>
          <SignOut
            size={13}
            className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0"
          />
        </button>
      </div>
    </aside>
  )
}
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ShieldCheckIcon as ShieldCheck,
  SquaresFourIcon as SquaresFour,
  FolderOpenIcon as FolderOpen,
  ListChecksIcon as ListChecks,
  ChartBarIcon as ChartBar,
  XIcon,
  MagicWandIcon as Wand,
  CaretRightIcon as CaretRight,
  CaretDoubleLeftIcon as CaretDoubleLeft,
  CaretDoubleRightIcon as CaretDoubleRight,
  ClockIcon as Clock,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { useStore } from '../store/useStore'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}
const navItem = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
}

interface NavEntry {
  to: string
  label: string
  icon: Icon
  exact: boolean
}

interface Props {
  collapsed: boolean
  onToggle?: () => void
  onClose?: () => void
}

export default function Sidebar({ collapsed, onToggle, onClose }: Props) {
  const { users, currentUserId, projects } = useStore()
  const user = users.find((u) => u.id === currentUserId)
  const location = useLocation()

  const isAdmin = user?.role === 'admin'
  const isAuditor = user?.role === 'auditor'

  const nextDue = [...projects]
    .filter((p) => (p.status === 'in_progress' || p.status === 'under_review') && p.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]
  const nextDueLabel = nextDue
    ? new Date(`${nextDue.dueDate!.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''

  const dashboard: NavEntry = { to: '/dashboard', label: 'Dashboard', icon: SquaresFour, exact: true }
  const audits: NavEntry = { to: '/projects', label: 'Audits', icon: FolderOpen, exact: false }
  const reports: NavEntry = { to: '/reports', label: 'Reports', icon: ChartBar, exact: false }
  const guidelines: NavEntry = { to: '/guidelines', label: 'Guidelines', icon: ListChecks, exact: false }
  const generator: NavEntry = { to: '/generator', label: 'Generator', icon: Wand, exact: false }

  const groups: { title: string; items: NavEntry[] }[] = isAdmin
    ? [{ title: 'Workspace', items: [dashboard] }, { title: 'Frameworks', items: [generator] }]
    : isAuditor
    ? [{ title: 'Workspace', items: [dashboard, audits, reports] }]
    : [{ title: 'Workspace', items: [dashboard, audits, reports] }, { title: 'Frameworks', items: [guidelines] }]

  return (
    <aside
      className={[
        'h-full shrink-0 bg-sidebar-bg flex flex-col overflow-y-auto overflow-x-hidden overscroll-none',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-[76px]' : 'w-64',
      ].join(' ')}
    >
      <div className={`flex items-center h-16 shrink-0 ${collapsed ? 'justify-center' : 'justify-between px-5'}`}>
        <NavLink
          to="/dashboard"
          onClick={onClose}
          aria-label="SafetyAudit home"
          className="flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <div className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.22)] flex items-center justify-center shrink-0">
            <ShieldCheck size={18} weight="bold" className="text-on-dark" />
          </div>
          {!collapsed && <span className="text-on-dark font-bold tracking-tight text-lg">SafetyAudit</span>}
        </NavLink>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <XIcon size={18} weight="bold" />
          </button>
        )}
      </div>

      <div className="mx-4 border-t border-sidebar-border" />

      <nav className={`flex-1 py-5 ${collapsed ? 'px-3' : 'px-4'}`} aria-label="Main">
        {groups.map((group, gIdx) => (
          <div key={group.title} className={gIdx > 0 ? 'mt-6' : ''}>
            {collapsed ? (
              gIdx > 0 && <div className="mx-2 mb-4 border-t border-sidebar-border" />
            ) : (
              <p className="px-3 mb-2 text-2xs text-sidebar-muted font-mono tracking-widest uppercase">{group.title}</p>
            )}
            <motion.ul variants={container} initial="hidden" animate="show" className="space-y-1 list-none m-0 p-0">
              {group.items.map(({ to, label, icon: Icon, exact }) => {
                const active = exact ? location.pathname === to : location.pathname.startsWith(to)
                return (
                  <motion.li key={to} variants={navItem}>
                    <NavLink
                      to={to}
                      onClick={onClose}
                      title={collapsed ? label : undefined}
                      aria-label={collapsed ? label : undefined}
                      className={[
                        'flex items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-150',
                        'focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1',
                        collapsed ? 'justify-center h-11' : 'px-3 py-2.5',
                        active
                          ? 'bg-white text-primary shadow-sm'
                          : 'text-sidebar-text hover:text-sidebar-text-hover hover:bg-[var(--color-sidebar-item-hover)]',
                      ].join(' ')}
                    >
                      <Icon size={20} weight={active ? 'fill' : 'regular'} className="shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">{label}</span>
                          <CaretRight size={12} weight="bold" className={active ? 'text-primary/60' : 'opacity-40'} />
                        </>
                      )}
                    </NavLink>
                  </motion.li>
                )
              })}
            </motion.ul>
          </div>
        ))}

        {!isAdmin && nextDue && (
          <div className="mt-7">
            {collapsed ? (
              <NavLink
                to={`/projects/${nextDue.id}`}
                title={`Next deadline: ${nextDue.name}, due ${nextDueLabel}`}
                aria-label={`Next deadline: ${nextDue.name}, due ${nextDueLabel}`}
                className="flex items-center justify-center h-11 rounded-xl bg-[var(--color-sidebar-item-hover)] text-sidebar-text-hover hover:bg-sidebar-item-active transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Clock size={20} />
              </NavLink>
            ) : (
              <NavLink
                to={`/projects/${nextDue.id}`}
                onClick={onClose}
                className="block rounded-2xl bg-[var(--color-sidebar-item-hover)] hover:bg-sidebar-item-active px-4 py-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <div className="flex items-center gap-2 text-sidebar-muted">
                  <Clock size={14} weight="bold" />
                  <p className="text-2xs font-mono tracking-widest uppercase">Next deadline</p>
                </div>
                <p className="text-sidebar-text-hover text-sm font-semibold truncate mt-2">{nextDue.name}</p>
                <p className="text-sidebar-muted text-xs mt-0.5">Due {nextDueLabel}</p>
              </NavLink>
            )}
          </div>
        )}
      </nav>

      {onToggle && (
        <div className={`py-4 border-t border-sidebar-border ${collapsed ? 'px-3' : 'px-4'}`}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
            className={[
              'w-full flex items-center gap-3 rounded-xl text-sm font-medium text-sidebar-text hover:text-sidebar-text-hover hover:bg-[var(--color-sidebar-item-hover)] transition-colors',
              'focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1',
              collapsed ? 'justify-center h-11' : 'px-3 py-2.5',
            ].join(' ')}
          >
            {collapsed ? <CaretDoubleRight size={18} /> : <CaretDoubleLeft size={18} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      )}
    </aside>
  )
}

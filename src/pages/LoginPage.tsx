import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheckIcon as ShieldCheck,
  ArrowRightIcon as ArrowRight,
  WarningIcon as Warning,
} from '@phosphor-icons/react'
import { useStore, MOCK_CREDENTIALS } from '../store/useStore'

const DEMO_ACCOUNTS = [
  { email: 'jackie@safetyaudit.org', name: 'Jackie Chan', role: 'Head Auditor', color: 'bg-violet-500', initials: 'JC' },
  { email: 'john@safetyaudit.org', name: 'John Lee', role: 'Auditor', color: 'bg-emerald-500', initials: 'JL' },
  { email: 'ahmad@safetyaudit.org', name: 'Ahmad bin Ali', role: 'Auditor', color: 'bg-amber-500', initials: 'AA' },
  { email: 'sanji@safetyaudit.org', name: 'Sanji Nambiar', role: 'Auditor', color: 'bg-rose-500', initials: 'SN' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useStore()

  const [email, setEmail] = useState('jackie@safetyaudit.org')
  const [password, setPassword] = useState('audit2026')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function selectDemo(demoEmail: string) {
    setEmail(demoEmail)
    setPassword('audit2026')
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.')
      return
    }
    setLoading(true)
    await new Promise((r) => setTimeout(r, 500))
    const cred = MOCK_CREDENTIALS[email.trim().toLowerCase()]
    if (!cred || cred.password !== password) {
      setLoading(false)
      setError('Incorrect credentials. Select a demo account below.')
      return
    }
    login(cred.userId)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center px-4 py-12">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(oklch(0.8 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(0.8 0 0) 1px, transparent 1px)`,
          backgroundSize: '52px 52px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 22 }}
        className="relative w-full max-w-sm"
      >
        {/* Card */}
        <div className="bg-white rounded-[18px] shadow-[0_24px_64px_-12px_oklch(0.08_0.01_250_/_0.55),_0_4px_16px_-4px_oklch(0.15_0.02_250_/_0.2)] overflow-hidden">
          {/* Accent strip */}
          <div className="h-[3px] bg-blue-600" />

          {/* Card header — logo + title */}
          <div className="px-7 pt-6 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-8 h-8 rounded-[8px] bg-blue-600 flex items-center justify-center shrink-0 shadow-[0_4px_12px_oklch(0.45_0.2_250_/_0.35)]">
                <ShieldCheck size={16} weight="bold" className="text-white" />
              </div>
              <div>
                <p className="text-slate-900 font-semibold text-sm tracking-tight leading-none">SafetyAudit</p>
                <p className="text-slate-400 text-[10px] font-mono tracking-[0.12em] uppercase mt-0.5">
                  Child Safety Platform
                </p>
              </div>
            </div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Sign in</h1>
            <p className="text-slate-500 text-sm mt-1">Access your audit projects and reports.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="px-7 py-5 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
                className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-[10px] px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                placeholder="you@safetyaudit.org"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-[10px] px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                placeholder="••••••••"
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-100 rounded-[8px] px-3 py-2.5"
                >
                  <Warning size={14} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white text-sm font-semibold rounded-[10px] hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1"
            >
              {loading ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
                    className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={14} weight="bold" />
                </>
              )}
            </motion.button>
          </form>

          {/* Demo accounts */}
          <div className="px-7 pb-7">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-slate-100" />
              <p className="text-xs text-slate-400 font-medium shrink-0">Quick access</p>
              <div className="flex-1 h-px bg-slate-100" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => {
                const selected = email === acc.email
                return (
                  <motion.button
                    key={acc.email}
                    type="button"
                    onClick={() => selectDemo(acc.email)}
                    whileTap={{ scale: 0.97 }}
                    className={[
                      'flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] border-2 transition-all text-left',
                      'focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1',
                      selected
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <div className={`w-7 h-7 rounded-full ${acc.color} flex items-center justify-center shrink-0`}>
                      <span className="text-white text-[9px] font-bold">{acc.initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold truncate leading-tight ${selected ? 'text-blue-700' : 'text-slate-700'}`}>
                        {acc.name.split(' ')[0]}
                      </p>
                      <p className={`text-[10px] leading-tight mt-0.5 ${selected ? 'text-blue-500' : 'text-slate-400'}`}>
                        {acc.role}
                      </p>
                    </div>
                  </motion.button>
                )
              })}
            </div>

            <p className="text-center text-[11px] text-slate-400 mt-3 font-mono">
              password: <span className="text-slate-600 font-semibold">audit2026</span>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

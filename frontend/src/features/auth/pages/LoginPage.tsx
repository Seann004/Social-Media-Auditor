import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheckIcon as ShieldCheck,
  ArrowRightIcon as ArrowRight,
  WarningIcon as Warning,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import * as db from '../../../lib/db'
import { hashPassword } from '../../../lib/crypto'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim()) {
      setError('Please enter your email.')
      return
    }
    if (!password) {
      setError('Please enter your password.')
      return
    }

    setLoading(true)
    const hashedPassword = await hashPassword(password)

    try {
      const { token, user } = await db.login(email.trim().toLowerCase(), hashedPassword)
      login(user.userId, user.userName, user.role, token)
      const { initFromDb } = useStore.getState()
      initFromDb().catch(() => {})
      navigate('/dashboard', { replace: true })
    } catch {
      setLoading(false)
      setError('Incorrect email or password.')
    }
  }

  return (
    <div className="min-h-[100dvh] bg-login-bg flex flex-col items-center justify-center px-4 py-12">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.08]"
        style={{
          backgroundImage: `linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)`,
          backgroundSize: '52px 52px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 22 }}
        className="relative w-full max-w-lg"
      >
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="h-1 bg-primary" />

          <div className="px-9 pt-8 pb-6 border-b border-border-light">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
                <ShieldCheck size={20} weight="bold" className="text-on-dark" />
              </div>
              <div>
                <p className="text-heading font-bold text-base tracking-tight leading-none">SafetyAudit</p>
                <p className="text-muted text-xs font-mono tracking-[0.12em] uppercase mt-0.5">
                  Compliance Audit Platform
                </p>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-heading tracking-tight">Sign in</h1>
            <p className="text-secondary text-base mt-1.5">Access your audit projects and reports.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="px-9 py-7 space-y-5">
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
                className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                placeholder="you@example.com"
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
                className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                placeholder="••••••••"
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5"
                >
                  <Warning size={14} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <p className="text-center text-base text-secondary">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary font-semibold hover:text-primary-hover transition-colors">
                Register
              </Link>
            </p>

            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-primary text-on-dark text-base font-bold rounded-xl hover:bg-primary-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-primary-border focus-visible:outline-offset-1"
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
        </div>
      </motion.div>
    </div>
  )
}

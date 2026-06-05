import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheckIcon as ShieldCheck,
  ArrowRightIcon as ArrowRight,
  WarningIcon as Warning,
  CheckIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import { supabase } from '../../../lib/supabase'
import type { UserRole } from '../../../types'

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter (A–Z)', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number (0–9)', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One symbol (e.g. _ ! @)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

function passwordValid(p: string) {
  return PASSWORD_RULES.every((r) => r.test(p))
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const showRules = passwordTouched && password.length > 0
  const allRulesPassed = passwordValid(password)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasswordTouched(true)

    if (!email.trim()) {
      setError('Please enter your email.')
      return
    }
    if (!passwordValid(password)) {
      setError('Password does not meet the requirements below.')
      return
    }

    setLoading(true)

    const { data, error: dbError } = await supabase.rpc('verify_user_login', {
      p_email: email.trim().toLowerCase(),
      p_password: password,
    })

    if (dbError || !data || data.length === 0) {
      setLoading(false)
      setError('Incorrect email or password.')
      return
    }

    const user = data[0]
    login(user.userId, user.userName, user.role as UserRole)
    // Pre-load DB data (non-blocking — pages handle their own loading)
    const { initFromDb } = useStore.getState()
    initFromDb().catch(() => {})
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-[100dvh] bg-login-bg flex flex-col items-center justify-center px-4 py-12">
      {/* Background grid */}
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
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Accent strip */}
          <div className="h-1 bg-primary" />

          {/* Card header */}
          <div className="px-9 pt-8 pb-6 border-b border-border-light">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
                <ShieldCheck size={20} weight="bold" className="text-on-dark" />
              </div>
              <div>
                <p className="text-heading font-bold text-base tracking-tight leading-none">SafetyAudit</p>
                <p className="text-muted text-xs font-mono tracking-[0.12em] uppercase mt-0.5">
                  Child Safety Platform
                </p>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-heading tracking-tight">Sign in</h1>
            <p className="text-secondary text-base mt-1.5">Access your audit projects and reports.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="px-9 py-7 space-y-5">
            {/* Email */}
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

            {/* Password */}
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
                onBlur={() => setPasswordTouched(true)}
                className={[
                  'w-full text-sm text-slate-800 bg-slate-50 border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:border-transparent placeholder:text-slate-300 transition-all',
                  showRules && !allRulesPassed
                    ? 'border-rose-300 focus:ring-rose-200'
                    : showRules && allRulesPassed
                    ? 'border-emerald-300 focus:ring-emerald-200'
                    : 'border-slate-200 focus:ring-blue-300',
                ].join(' ')}
                placeholder="••••••••"
              />

              {/* Password rules checklist */}
              <AnimatePresence>
                {showRules && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <ul className="mt-2.5 space-y-1.5 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
                      {PASSWORD_RULES.map((rule) => {
                        const passed = rule.test(password)
                        return (
                          <li key={rule.label} className="flex items-center gap-2">
                            {passed ? (
                              <CheckIcon size={12} weight="bold" className="text-emerald-500 shrink-0" />
                            ) : (
                              <XIcon size={12} weight="bold" className="text-rose-400 shrink-0" />
                            )}
                            <span className={`text-xs ${passed ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {rule.label}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Error banner */}
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

            {/* Register link */}
            <p className="text-center text-base text-secondary">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary font-semibold hover:text-primary-hover transition-colors">
                Register
              </Link>
            </p>

            {/* Submit */}
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

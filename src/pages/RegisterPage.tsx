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
import { useStore } from '../store/useStore'
import type { UserRole } from '../types'

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter (A–Z)', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number (0–9)', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One symbol (e.g. _ ! @)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
]

function passwordValid(p: string) {
  return PASSWORD_RULES.every((r) => r.test(p))
}

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] = [
  { value: 'head_auditor', label: 'Head Auditor', description: 'Manage projects, assign auditors, review submissions' },
  { value: 'auditor', label: 'Auditor', description: 'Conduct audits, record findings, submit for review' },
]

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register, users } = useStore()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<UserRole>('auditor')
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const showRules = passwordTouched && password.length > 0
  const allRulesPassed = passwordValid(password)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasswordTouched(true)

    if (!name.trim()) { setError('Please enter your full name.'); return }
    if (!email.trim()) { setError('Please enter your email.'); return }
    if (!passwordValid(password)) { setError('Password does not meet the requirements below.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    const emailLower = email.trim().toLowerCase()
    if (users.some((u) => u.name.toLowerCase() === name.trim().toLowerCase())) {
      setError('An account with this name already exists.')
      return
    }
    void emailLower

    setLoading(true)
    setTimeout(() => {
      register(email, name.trim(), role)
      navigate('/dashboard', { replace: true })
    }, 600)
  }

  return (
    <div className="min-h-[100dvh] bg-blue-600 flex flex-col items-center justify-center px-4 py-12">
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
        className="relative w-full max-w-sm"
      >
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="h-[3px] bg-blue-600" />

          <div className="px-7 pt-6 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                <ShieldCheck size={16} weight="bold" className="text-white" />
              </div>
              <div>
                <p className="text-slate-900 font-semibold text-sm tracking-tight leading-none">SafetyAudit</p>
                <p className="text-slate-400 text-[10px] font-mono tracking-[0.12em] uppercase mt-0.5">
                  Child Safety Platform
                </p>
              </div>
            </div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Create account</h1>
            <p className="text-slate-500 text-sm mt-1">Register to access SafetyAudit.</p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="px-7 py-6 space-y-4">
            {/* Full name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1.5">
                Full Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError('') }}
                className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent placeholder:text-slate-300 transition-all"
                placeholder="Jane Smith"
              />
            </div>

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

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
              <div className="space-y-2">
                {ROLE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={[
                      'flex items-start gap-3 px-3 py-3 rounded-lg border cursor-pointer transition-colors',
                      role === opt.value ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={opt.value}
                      checked={role === opt.value}
                      onChange={() => setRole(opt.value)}
                      className="sr-only"
                    />
                    <div className={[
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                      role === opt.value ? 'border-blue-600 bg-blue-600' : 'border-slate-300',
                    ].join(' ')}>
                      {role === opt.value && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${role === opt.value ? 'text-blue-800' : 'text-slate-700'}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
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
                            {passed
                              ? <CheckIcon size={12} weight="bold" className="text-emerald-500 shrink-0" />
                              : <XIcon size={12} weight="bold" className="text-rose-400 shrink-0" />}
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

            {/* Confirm password */}
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
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

            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-1"
            >
              {loading ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.75, ease: 'linear' }}
                    className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  />
                  Creating account…
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight size={14} weight="bold" />
                </>
              )}
            </motion.button>

            <p className="text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/" className="text-blue-600 font-medium hover:text-blue-700 transition-colors">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </motion.div>
    </div>
  )
}

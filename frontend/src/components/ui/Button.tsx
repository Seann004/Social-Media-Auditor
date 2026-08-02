import { forwardRef } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'danger-outline'
  | 'success'
  | 'neutral'
  | 'ghost'

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center font-semibold rounded-lg transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600',
  secondary:
    'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-blue-600',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600',
  'danger-outline':
    'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 focus-visible:outline-rose-600',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-600',
  neutral: 'bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:outline-slate-500',
  ghost: 'bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus-visible:outline-blue-600',
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'gap-1.5 px-3 py-1.5 text-xs',
  sm: 'gap-1.5 px-3 py-2 text-xs',
  md: 'gap-2 px-4 py-2 text-sm',
  lg: 'gap-2 px-5 py-3 text-base',
}

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return [BASE, VARIANTS[variant], SIZES[size], extra].filter(Boolean).join(' ')
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, [fullWidth ? 'w-full' : '', className].filter(Boolean).join(' '))}
      {...rest}
    />
  )
})

export default Button

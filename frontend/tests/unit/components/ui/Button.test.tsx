import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import Button, { buttonClasses } from '../../../../src/components/ui/Button'

describe('buttonClasses', () => {
  it('defaults to a medium primary button', () => {
    const cls = buttonClasses()
    expect(cls).toContain('bg-blue-600')
    expect(cls).toContain('px-4 py-2 text-sm')
  })

  it('combines a variant, a size and extra classes', () => {
    const cls = buttonClasses('danger-outline', 'xs', 'w-full')
    expect(cls).toContain('text-rose-600')
    expect(cls).toContain('px-3 py-1.5 text-xs')
    expect(cls.endsWith('w-full')).toBe(true)
  })
})

describe('Button', () => {
  it('is a plain button by default, so it does not submit a form', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const onClick = vi.fn()
    render(<form onSubmit={onSubmit}><Button onClick={onClick}>Save</Button></form>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('takes a variant, size, full width, extra classes, a type and a ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref} variant="success" size="lg" fullWidth className="mt-2" type="submit" disabled>Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeDisabled()
    expect(button.className).toContain('bg-emerald-600')
    expect(button.className).toContain('px-5 py-3 text-base')
    expect(button.className).toContain('w-full mt-2')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import AuditorAvatar from '../../../../src/components/ui/AuditorAvatar'

describe('AuditorAvatar', () => {
  const user = { id: 'u1', name: 'Andy Auditor', role: 'auditor' as const, initials: 'AA', color: 'bg-emerald-500' }

  it('shows the initials in the user colour with the name as a tooltip', () => {
    render(<AuditorAvatar user={user} size="md" />)
    const badge = screen.getByTitle('Andy Auditor')
    expect(badge).toHaveTextContent('AA')
    expect(badge.className).toContain('bg-emerald-500')
    expect(badge.className).toContain('w-9 h-9')
    expect(screen.queryByText('Andy Auditor')).toBeNull()
  })

  it('can show the name next to it', () => {
    render(<AuditorAvatar user={user} size="xs" showName />)
    expect(screen.getByText('Andy Auditor')).toBeInTheDocument()
    expect(screen.getByTitle('Andy Auditor').className).toContain('w-6 h-6')
  })
})

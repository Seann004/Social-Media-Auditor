import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import Modal from '../../../../src/components/ui/Modal'

function Harness({ dismissable = true, onClose = vi.fn(), children }: { dismissable?: boolean; onClose?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Modal
        open={open}
        onClose={() => { onClose(); setOpen(false) }}
        dismissable={dismissable}
        label="Edit item"
        size="lg"
        panelClassName="p-6"
      >
        {children ?? (
          <>
            <button type="button">First</button>
            <input aria-label="Middle" />
            <button type="button">Last</button>
          </>
        )}
      </Modal>
    </>
  )
}

async function openModal(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit item' })
  // The first control is focused on the next tick.
  await waitFor(() => expect(screen.getByRole('button', { name: 'First' })).toHaveFocus())
  return dialog
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Modal open={false} onClose={vi.fn()}>Hidden body</Modal>)
    expect(screen.queryByText('Hidden body')).toBeNull()
  })

  it('opens as a labelled, modal dialog of the chosen size and focuses its first control', async () => {
    const dialog = await openModal()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.className).toContain('max-w-2xl')
    expect(dialog.className).toContain('p-6')
  })

  it('uses labelledBy over a label, and a generated label when given neither', () => {
    const { rerender } = render(<Modal open onClose={vi.fn()} labelledBy="t"><h2 id="t">Title</h2></Modal>)
    expect(screen.getByRole('dialog', { name: 'Title' })).not.toHaveAttribute('aria-label')
    rerender(<Modal open onClose={vi.fn()}>Body</Modal>)
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toMatch(/^dialog-/)
  })

  it('closes on Escape and on a backdrop click, and gives focus back', async () => {
    const onClose = vi.fn()
    await openModal({ onClose })
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus())

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const backdrop = (await screen.findByRole('dialog')).previousElementSibling as HTMLElement
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('stays open on Escape and backdrop clicks when not dismissable', async () => {
    const onClose = vi.fn()
    const dialog = await openModal({ onClose, dismissable: false })
    await userEvent.keyboard('{Escape}')
    await userEvent.click(dialog.previousElementSibling as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    await openModal()
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    // jsdom has no layout, so offsetParent is null; the trap still knows the focused control.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(first).toHaveFocus()
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(last).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(last).toHaveFocus()
  })

  it('wraps focus from the last control to the first and back when the controls are laid out', async () => {
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
    try {
      await openModal()
      const first = screen.getByRole('button', { name: 'First' })
      const last = screen.getByRole('button', { name: 'Last' })
      last.focus()
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(first).toHaveFocus()
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
      expect(last).toHaveFocus()
      screen.getByLabelText('Middle').focus()
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(screen.getByLabelText('Middle')).toHaveFocus()
    } finally {
      offsetParent.mockRestore()
    }
  })

  it('focuses the panel itself when it has no controls, and Tab keeps it there', async () => {
    render(<Modal open onClose={vi.fn()} label="Info"><p>Just text</p></Modal>)
    const dialog = screen.getByRole('dialog', { name: 'Info' })
    await waitFor(() => expect(dialog).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog).toHaveFocus()
  })

  it('does not steal focus if it closes before the focus tick', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<Modal open onClose={vi.fn()} label="Quick"><button type="button">Inside</button></Modal>)
      rerender(<Modal open={false} onClose={vi.fn()} label="Quick"><button type="button">Inside</button></Modal>)
      act(() => { vi.runAllTimers() })
      expect(document.body).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })
})

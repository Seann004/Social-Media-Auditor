import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Pager, { pageNumbers } from '../../../../../src/features/guidelines/components/Pager'

describe('pageNumbers', () => {
  it('lists every page when there are few', () => {
    expect(pageNumbers(0, 3)).toEqual([0, 1, 2])
  })

  it('keeps the first, the last and the neighbours of the current page, with gaps between', () => {
    expect(pageNumbers(0, 20)).toEqual([0, 1, 'gap', 19])
    expect(pageNumbers(10, 20)).toEqual([0, 'gap', 9, 10, 11, 'gap', 19])
    expect(pageNumbers(19, 20)).toEqual([0, 'gap', 18, 19])
  })

  it('leaves no gap when the neighbours touch the ends', () => {
    expect(pageNumbers(2, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('shows one page for an empty list', () => {
    expect(pageNumbers(0, 1)).toEqual([0])
  })
})

describe('Pager', () => {
  const setup = (over: Partial<Parameters<typeof Pager>[0]> = {}) => {
    const onPage = vi.fn()
    const onPageSize = vi.fn()
    render(<Pager page={1} pageSize={10} total={45} label="High confidence" onPage={onPage} onPageSize={onPageSize} {...over} />)
    return { onPage, onPageSize }
  }

  it('says which rows are shown', () => {
    setup()
    expect(screen.getByText('Showing 11–20 of 45')).toBeInTheDocument()
  })

  it('says so when there is nothing to show', () => {
    setup({ page: 0, total: 0 })
    expect(screen.getByText('Showing 0–0 of 0')).toBeInTheDocument()
  })

  it('goes to the previous, the next and a numbered page', async () => {
    const { onPage } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Page 5' }))
    expect(onPage.mock.calls.map((c) => c[0])).toEqual([0, 2, 4])
  })

  it('marks the current page and disables the ends', () => {
    setup({ page: 4 })
    expect(screen.getByRole('button', { name: 'Page 5' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('reports a new page size', async () => {
    const { onPageSize } = setup()
    await userEvent.selectOptions(screen.getByLabelText('Rows per page in High confidence'), '50')
    expect(onPageSize).toHaveBeenCalledWith(50)
  })
})

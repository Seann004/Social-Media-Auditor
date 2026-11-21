import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { read, sheetToJson, getDocument } = vi.hoisted(() => ({ read: vi.fn(), sheetToJson: vi.fn(), getDocument: vi.fn() }))

vi.mock('xlsx', () => ({ read, utils: { sheet_to_json: sheetToJson } }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))
vi.mock('../../../../../src/lib/db', async (orig) => ({
  ...(await orig<typeof import('../../../../../src/lib/db')>()),
  processTextChunk: vi.fn(),
  mergeChecklistItems: vi.fn(),
  createGuideline: vi.fn(),
}))

// The store first: lib/db imports the store, so loading the store first gives it the mocked lib/db.
import { useStore } from '../../../../../src/store/useStore'
import * as db from '../../../../../src/lib/db'
import GeneratorPage from '../../../../../src/features/generator/pages/GeneratorPage'

type Row = unknown[]

function mount() {
  return render(
    <MemoryRouter initialEntries={['/generator']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/generator" element={<GeneratorPage />} />
        <Route path="/guidelines" element={<p>Guidelines list</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Uploads a spreadsheet whose first sheet holds `rows`, then runs the four parsing steps. */
async function uploadExcel(container: HTMLElement, rows: Row[], name = 'EDPB checklist.xlsx') {
  sheetToJson.mockReturnValue(rows)
  const input = container.querySelector('input[accept=".xlsx, .xls"]') as HTMLInputElement
  await userEvent.upload(input, new File(['binary'], name))
  await waitFor(() => expect(read).toHaveBeenCalled())
  await runParsingSteps()
}

/** The page animates four parsing steps on a 600 ms interval; the test ticks it by hand. */
let stepTick: (() => void) | null = null
async function runParsingSteps() {
  await waitFor(() => expect(stepTick).not.toBeNull())
  for (let i = 0; i < 4; i++) await act(async () => { stepTick?.() })
}

function pdfOf(pages: string[][]) {
  return {
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({ getTextContent: async () => ({ items: pages[n - 1].map((str) => ({ str })) }) }),
    }),
  }
}

async function uploadPdf(container: HTMLElement, name = 'Kids Code 2024.pdf') {
  await userEvent.click(screen.getByRole('button', { name: /PDF Guidelines/ }))
  const input = container.querySelector('input[accept=".pdf"]') as HTMLInputElement
  const file = new File(['%PDF'], name, { type: 'application/pdf' })
  // jsdom's File may not implement arrayBuffer; the page only hands the buffer to the (mocked) PDF reader.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) })
  await userEvent.upload(input, file)
}

const ROW_TYPE_SHEET: Row[] = [
  ['Checklist title'],
  ['Row Type', 'Item ID', 'Item Name', 'Item Description', 'Help Text', 'Clause Reference', 'Verbatim Text'],
  ['SECTION', '1', 'Section 1 - Accounts', '', '', '', ''],
  ['SUBSECTION', '1.1', 'Age checks', '', '', '', ''],
  ['ITEM', '1.1.1', 'Age gate', 'The service must ask for age', 'Look at sign-up', 'Art. 8', 'Original clause'],
  ['SUBSECTION', '1.1.1', 'Nested', '', '', '', ''],
  ['ITEM', '1.1.1.1', 'Nested item', 'An optional setting is recommended', '', '', ''],
  ['SUBSECTION', '1.2', 'Defaults', '', '', '', ''],
  ['ITEM', '1.2.1', '', 'Location sharing is off', '', null, null],
  [],
  ['SECTION', '2', '2 Design', '', '', '', ''],
  ['ITEM', '2.1', 'Dark patterns', '', '', '', ''],
]

beforeEach(() => {
  localStorage.clear()
  // Only the page's 600 ms step timer is captured: jsdom runs animation frames on the real setInterval.
  stepTick = null
  const realSetInterval = globalThis.setInterval
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
    if (ms === 600) { stepTick = fn; return 0 as never }
    return realSetInterval(fn, ms, ...args)
  }) as typeof setInterval)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  read.mockReset().mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })
  sheetToJson.mockReset()
  getDocument.mockReset()
  vi.mocked(db.processTextChunk).mockReset().mockResolvedValue({ items: [{ text: 'raw' }], _aiUsed: true })
  vi.mocked(db.mergeChecklistItems).mockReset().mockResolvedValue({
    name: 'n', shortName: 's', _aiUsed: true,
    categories: ['Age'],
    items: [
      { category: 'Age', text: 'Ask for age at sign-up', severity: 'critical', reference: 'p.2', helpText: 'Check the form', verbatimClauseText: 'Clause 2' },
      { text: 'Keep profiles private' },
    ],
  })
  vi.mocked(db.createGuideline).mockReset().mockResolvedValue(undefined as never)
  useStore.setState({ currentUserId: 'ad', users: [{ id: 'ad', name: 'Ada', role: 'admin', initials: 'A', color: '' }], guidelines: [], checklistItems: [] } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GeneratorPage empty state', () => {
  it('starts on the Excel tab and switches its hint text with the tab', async () => {
    mount()
    expect(screen.getByText('Framework Synthesis Area')).toBeInTheDocument()
    expect(screen.getByText(/Upload an Excel checklist \(\.xlsx\)/)).toBeInTheDocument()
    expect(screen.getByText('Select Excel File')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /PDF Guidelines/ }))
    expect(await screen.findByText(/Upload a PDF guidelines file/)).toBeInTheDocument()
    expect(screen.getByText('Select PDF Guidelines')).toBeInTheDocument()
  })
})

describe('GeneratorPage Excel import (Row Type columns)', () => {
  it('shows the parsing steps, then a guideline built from the sections, subsections and items', async () => {
    const { container } = mount()
    sheetToJson.mockReturnValue(ROW_TYPE_SHEET)
    await userEvent.upload(container.querySelector('input[accept=".xlsx, .xls"]') as HTMLInputElement, new File(['b'], 'EDPB checklist.xlsx'))
    expect(await screen.findByText('Parsing Compliance Spreadsheet')).toBeInTheDocument()
    expect(screen.getByText('Reading binary spreadsheet data...')).toBeInTheDocument()
    expect(screen.getByText('EDPB checklist.xlsx')).toBeInTheDocument()
    await waitFor(() => expect(read).toHaveBeenCalledWith(expect.anything(), { type: 'binary' }))
    await runParsingSteps()

    expect(await screen.findByText('EDPB-CHECK')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EDPB checklist' })).toBeInTheDocument()
    expect(screen.getByText('v1.0 (Excel Import)')).toBeInTheDocument()
    expect(screen.getByText('Guideline framework imported from file EDPB checklist.xlsx.')).toBeInTheDocument()
    expect(screen.getByText('Framework Items').nextElementSibling).toHaveTextContent('4')
    expect(screen.getByText('1. The service must ask for age')).toBeInTheDocument()
    expect(screen.getByText('2. An optional setting is recommended')).toBeInTheDocument()
    expect(screen.getByText('3. Location sharing is off')).toBeInTheDocument()
    // An item with no description falls back to its name.
    expect(screen.getByText('4. Dark patterns')).toBeInTheDocument()
    // Section names lose their "Section 1 -" and "2 " prefixes; nested subsections show as a path.
    const first = screen.getByText('1. The service must ask for age').parentElement as HTMLElement
    expect(within(first).getByText('Accounts')).toBeInTheDocument()
    expect(within(first).getByText('Age checks')).toBeInTheDocument()
    const nested = screen.getByText('2. An optional setting is recommended').parentElement as HTMLElement
    expect(within(nested).getByText('Accounts → Age checks')).toBeInTheDocument()
    expect(within(nested).getByText('Nested')).toBeInTheDocument()
    const defaults = screen.getByText('3. Location sharing is off').parentElement as HTMLElement
    expect(within(defaults).getByText('Defaults')).toBeInTheDocument()
    expect(within(defaults).getByRole('button', { name: 'N/A' })).toBeInTheDocument()
    const design = screen.getByText('4. Dark patterns').parentElement as HTMLElement
    expect(within(design).getByText('Design')).toBeInTheDocument()
  })

  it('opens the help and traceability details of an item, and closes them', async () => {
    const { container } = mount()
    await uploadExcel(container, ROW_TYPE_SHEET)
    const first = (await screen.findByText('1. The service must ask for age')).parentElement as HTMLElement

    await userEvent.click(within(first).getByRole('button', { name: 'Help' }))
    expect(screen.getByText('Help & Audit Guidance')).toBeInTheDocument()
    expect(screen.getByText('Look at sign-up')).toBeInTheDocument()
    // "must" in the description makes the item critical.
    expect(screen.getByText('Critical')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText('Help & Audit Guidance')).toBeNull())

    await userEvent.click(within(first).getByRole('button', { name: 'Art. 8' }))
    expect(screen.getByText('Traceability Details')).toBeInTheDocument()
    expect(screen.getByText(/Age checks -> Age gate/)).toHaveTextContent('Original clause')
  })

  it('marks optional or recommended items minor and leaves the rest major, with fallback texts in the dialog', async () => {
    const { container } = mount()
    await uploadExcel(container, ROW_TYPE_SHEET)
    const nested = (await screen.findByText('2. An optional setting is recommended')).parentElement as HTMLElement
    await userEvent.click(within(nested).getByRole('button', { name: 'Help' }))
    expect(screen.getByText('Minor')).toBeInTheDocument()
    expect(screen.getByText('No additional audit instructions provided for this item.')).toBeInTheDocument()
    // The close (X) button in the header also closes the dialog.
    await userEvent.click(screen.getByText('Help & Audit Guidance').nextElementSibling as HTMLElement)
    await waitFor(() => expect(screen.queryByText('Help & Audit Guidance')).toBeNull())

    const defaults = screen.getByText('3. Location sharing is off').parentElement as HTMLElement
    await userEvent.click(within(defaults).getByRole('button', { name: 'Help' }))
    expect(screen.getByText('Major')).toBeInTheDocument()
  })

  // BUG (GeneratorPage.tsx:294, 322): currentSectionRawName is declared as '' and never assigned, so the
  // traceability path of an item never starts with its section. Remove `.fails` once the section is recorded.
  it('starts an item\'s traceability path with its section name', async () => {
    const { container } = mount()
    await uploadExcel(container, ROW_TYPE_SHEET)
    const first = (await screen.findByText('1. The service must ask for age')).parentElement as HTMLElement
    await userEvent.click(within(first).getByRole('button', { name: 'Art. 8' }))
    expect(screen.getByText(/Age checks -> Age gate/).textContent).toContain('Section 1 - Accounts -> Age checks -> Age gate')
  })

  it('saves the guideline with its items and goes to the guidelines list', async () => {
    const { container } = mount()
    await uploadExcel(container, ROW_TYPE_SHEET)
    await userEvent.click(await screen.findByRole('button', { name: /Save as Guideline/ }))
    expect(await screen.findByText('Guidelines list')).toBeInTheDocument()
    expect(db.createGuideline).toHaveBeenCalledTimes(1)
    const { guideline, items } = vi.mocked(db.createGuideline).mock.calls[0][0]
    expect(guideline).toMatchObject({
      guidelineName: 'EDPB checklist', shortName: 'EDPB-CHECK', version: '1.0 (Excel Import)', source: 'Excel Upload', userId: 'ad',
      categories: ['Accounts > Age checks', 'Accounts > Age checks > Nested', 'Accounts > Defaults', 'Design'],
    })
    expect(items.map((i) => [i.category, i.severity, i.reference ?? null])).toEqual([
      ['Accounts > Age checks', 'critical', 'Art. 8'],
      ['Accounts > Age checks > Nested', 'minor', null],
      ['Accounts > Defaults', 'major', null],
      ['Design', 'major', null],
    ])
    expect(items[0]).toMatchObject({ text: 'The service must ask for age', helpText: 'Look at sign-up' })
    expect(useStore.getState().guidelines[0]).toMatchObject({ name: 'EDPB checklist', itemCount: 4 })
  })

  it('shows the error and keeps the result when saving fails', async () => {
    vi.mocked(db.createGuideline).mockRejectedValue(new Error('db down'))
    const { container } = mount()
    await uploadExcel(container, ROW_TYPE_SHEET)
    await userEvent.click(await screen.findByRole('button', { name: /Save as Guideline/ }))
    expect(await screen.findByText('Failed to save checklist to database: Error: db down')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save as Guideline/ })).toBeEnabled()
    expect(screen.queryByText('Guidelines list')).toBeNull()
  })

  it('Clear drops the result and the file name', async () => {
    const { container } = mount()
    await uploadExcel(container, ROW_TYPE_SHEET)
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }))
    expect(await screen.findByText('Framework Synthesis Area')).toBeInTheDocument()
    expect(screen.getByText('Select Excel File')).toBeInTheDocument()
  })
})

describe('GeneratorPage Excel import (other layouts)', () => {
  it('reads a clause-reference sheet: sections, subsections, and items built from repeated rows', async () => {
    const { container } = mount()
    await uploadExcel(container, [
      ['Clause Reference', 'Clause Text'],
      ['1', 'Consent'],
      ['1.1', 'Parental'],
      ['1.1.1', 'Parental consent'],
      ['1.1.1', 'The platform shall verify parental consent'],
      ['1.1.1', 'Check the flow'],
      ['1.1.1', 'Look at emails'],
      ['1.1.2', 'Is a minor setting optional?'],
      ['', ''],
      ['2', 'Design'],
      ['2.1.1', 'Defaults are private'],
      ['2.1.2', 'Notice', 'unused'],
      ['2.1.2', 'Notices are clear'],
    ], 'Clauses.xlsx')
    expect(await screen.findByText('1. The platform shall verify parental consent')).toBeInTheDocument()
    expect(screen.getByText('2. Is a minor setting optional?')).toBeInTheDocument()
    expect(screen.getByText('3. Defaults are private')).toBeInTheDocument()
    expect(screen.getByText('4. Notices are clear')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /Save as Guideline/ }))
    await screen.findByText('Guidelines list')
    const { guideline, items } = vi.mocked(db.createGuideline).mock.calls[0][0]
    expect(guideline.categories).toEqual(['Consent > Parental', 'Design'])
    expect(items.map((i) => [i.reference, i.severity, i.category])).toEqual([
      ['1.1.1', 'critical', 'Consent > Parental'],
      ['1.1.2', 'minor', 'Consent > Parental'],
      ['2.1.1', 'major', 'Design'],
      ['2.1.2', 'major', 'Design'],
    ])
    expect(items[0]).toMatchObject({ helpText: 'Check the flow\nLook at emails' })
  })

  it('reads a sheet with no header whose first column holds clause numbers', async () => {
    const { container } = mount()
    await uploadExcel(container, [
      ['1', 'Accounts'],
      ['1.0.1', 'Accounts must be private'],
    ])
    expect(await screen.findByText('1. Accounts must be private')).toBeInTheDocument()
  })

  it('falls back to fixed columns when no header is found', async () => {
    const { container } = mount()
    await uploadExcel(container, [
      ['My sheet'],
      ['SECTION', '1', 'Accounts'],
      ['SUBSECTION', '1.1', 'Sign-up'],
      ['ITEM', '1.1.1', 'Age', 'Sign-up should not nudge', 'See the form'],
      ['ITEM', '1.1.2', 'Must name', ''],
      [],
    ])
    expect(await screen.findByText('1. Sign-up should not nudge')).toBeInTheDocument()
    expect(screen.getByText('2. Must name')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Save as Guideline/ }))
    await screen.findByText('Guidelines list')
    const { items } = vi.mocked(db.createGuideline).mock.calls[0][0]
    expect(items.map((i) => [i.category, i.severity])).toEqual([
      ['Accounts > Sign-up', 'minor'],
      ['Accounts > Sign-up', 'critical'],
    ])
    expect(items[0]).toMatchObject({ helpText: 'See the form' })
  })

  it('finds a Row Type header further down the sheet', async () => {
    const { container } = mount()
    await uploadExcel(container, [
      ...Array.from({ length: 11 }, () => ['note']),
      ['Row Type', 'Item ID', 'Item Name', 'Item Description', 'Help Text', 'Clause Reference'],
      ['SECTION', '1', 'Privacy'],
      ['ITEM', '1.1', 'Location', 'Location is off', '', 'Std 10'],
    ])
    expect(await screen.findByText('1. Location is off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Std 10' })).toBeInTheDocument()
  })

  it('says when the sheet is empty', async () => {
    const { container } = mount()
    await uploadExcel(container, [])
    expect(await screen.findByText('The Excel file is empty.')).toBeInTheDocument()
  })

  it('says when the sheet holds no checklist items', async () => {
    const { container } = mount()
    await uploadExcel(container, [['Row Type', 'Item ID', 'Item Name'], ['SECTION', '1', 'Only a section']])
    expect(await screen.findByText('Could not find any checklist items in the Excel sheet.')).toBeInTheDocument()
  })

  it('says when the file cannot be read as a spreadsheet', async () => {
    read.mockImplementation(() => { throw new Error('not a zip') })
    const { container } = mount()
    sheetToJson.mockReturnValue([])
    await userEvent.upload(container.querySelector('input[accept=".xlsx, .xls"]') as HTMLInputElement, new File(['x'], 'bad.xlsx'))
    expect(await screen.findByText('Failed to parse Excel file. Ensure it is a valid .xlsx file.')).toBeInTheDocument()
    expect(screen.queryByText('Parsing Compliance Spreadsheet')).toBeNull()
  })

  it('refuses a file that is not .xlsx or .xls, even when the picker filter is set to All files (NFR-06)', async () => {
    const { container } = mount()
    // applyAccept: false acts like the user switching the file picker to "All files".
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(container.querySelector('input[accept=".xlsx, .xls"]') as HTMLInputElement, new File(['plain text'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText('"notes.txt" is not an Excel file. Choose a .xlsx or .xls file.')).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
    expect(screen.queryByText('Parsing Compliance Spreadsheet')).toBeNull()
  })

  // BUG (GeneratorPage.tsx:752, 762, 844): switching tabs does not clear excelError, and the PDF tab shows the
  // same state, so an Excel parsing error appears under the PDF upload box. Remove `.fails` once it is per tab.
  it('does not show an Excel error on the PDF tab', async () => {
    read.mockImplementation(() => { throw new Error('not a zip') })
    const { container } = mount()
    await userEvent.upload(container.querySelector('input[accept=".xlsx, .xls"]') as HTMLInputElement, new File(['x'], 'bad.xlsx'))
    await screen.findByText('Failed to parse Excel file. Ensure it is a valid .xlsx file.')
    await userEvent.click(screen.getByRole('button', { name: /PDF Guidelines/ }))
    expect(screen.queryByText('Failed to parse Excel file. Ensure it is a valid .xlsx file.')).toBeNull()
  })
})

describe('GeneratorPage PDF import', () => {
  it('reads every page, sends each chunk to the AI with the platform, merges, and shows the result', async () => {
    getDocument.mockReturnValue(pdfOf([['Children must', 'verify age.'], ['Profiles are private.']]))
    const { container } = mount()
    await uploadPdf(container)
    expect(await screen.findByText('1. Ask for age at sign-up')).toBeInTheDocument()
    expect(db.processTextChunk).toHaveBeenCalledTimes(1)
    expect(db.processTextChunk).toHaveBeenCalledWith('Children must verify age.\nProfiles are private.\n', 'TikTok')
    expect(db.mergeChecklistItems).toHaveBeenCalledWith([{ text: 'raw' }], 'TikTok')
    expect(screen.getByText('KIDS-CODE-20')).toBeInTheDocument()
    expect(screen.getByText('v1.0 (Llama PDF)')).toBeInTheDocument()
    expect(screen.getByText('Compliance guidelines synthesized from PDF file Kids Code 2024.pdf.')).toBeInTheDocument()
    // An item with no category is filed under General.
    const second = screen.getByText('2. Keep profiles private').parentElement as HTMLElement
    expect(within(second).getByText('General')).toBeInTheDocument()

    const first = screen.getByText('1. Ask for age at sign-up').parentElement as HTMLElement
    await userEvent.click(within(first).getByRole('button', { name: 'p.2' }))
    expect(screen.getByText('Clause 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await userEvent.click(within(second).getByRole('button', { name: 'N/A' }))
    expect(await screen.findByText('No verbatim clause text available.')).toBeInTheDocument()
  })

  it('shows the PDF steps with the chunk being analysed', async () => {
    getDocument.mockReturnValue(pdfOf([['Some rules.']]))
    let answer!: (v: Awaited<ReturnType<typeof db.processTextChunk>>) => void
    vi.mocked(db.processTextChunk).mockReturnValue(new Promise((r) => { answer = r }))
    const { container } = mount()
    await uploadPdf(container)
    expect(await screen.findByText('Processing PDF Guidelines via Llama-3.3')).toBeInTheDocument()
    expect(await screen.findByText('Analyzing text chunk 1 of 1 (Llama-3.3)...')).toBeInTheDocument()
    expect(screen.getByText('Kids Code 2024.pdf')).toBeInTheDocument()
    await act(async () => answer({ items: [], _aiUsed: true }))
    expect(await screen.findByText('1. Ask for age at sign-up')).toBeInTheDocument()
  })

  it('splits a long document into chunks at sentence ends and analyses each one', async () => {
    const sentences = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} is a rule.`)
    getDocument.mockReturnValue(pdfOf([sentences]))
    const { container } = mount()
    await uploadPdf(container)
    await screen.findByText('1. Ask for age at sign-up')
    const chunks = vi.mocked(db.processTextChunk).mock.calls.map(([chunk]) => chunk)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(4000)
    expect(chunks.slice(0, -1).every((c) => c.endsWith('a rule'))).toBe(true)
    expect(chunks.join('')).toContain('Sentence number 299')
  })

  it('drops a table of contents before analysing', async () => {
    getDocument.mockReturnValue(pdfOf([['Intro text'], ['Table of Contents'], ['Age rules ..... 3'], ['Privacy    4'], ['Real rule one.'], ['Real rule two.'], ['Real rule three.']]))
    const { container } = mount()
    await uploadPdf(container)
    await screen.findByText('1. Ask for age at sign-up')
    const [chunk] = vi.mocked(db.processTextChunk).mock.calls[0]
    expect(chunk).toContain('Intro text')
    expect(chunk).not.toContain('Table of Contents')
    expect(chunk).not.toContain('Age rules ..... 3')
    expect(chunk).toContain('Real rule three.')
  })

  // BUG (GeneratorPage.tsx:104-114 with 617-618): after a table of contents, removeTOC waits for three
  // non-contents lines and drops the first two. The PDF text has one line per page, so the two pages after
  // the contents are never analysed. Remove `.fails` once those lines are kept.
  it('keeps the pages that follow a table of contents', async () => {
    getDocument.mockReturnValue(pdfOf([['Table of Contents'], ['Rules ..... 2'], ['Rule A: verify age.'], ['Rule B: private by default.'], ['Rule C: no ads.']]))
    const { container } = mount()
    await uploadPdf(container)
    await screen.findByText('1. Ask for age at sign-up')
    const [chunk] = vi.mocked(db.processTextChunk).mock.calls[0]
    expect(chunk).toContain('Rule A: verify age.')
  })

  it('warns, and lets the admin dismiss the warning, when the AI fell back to heuristics', async () => {
    getDocument.mockReturnValue(pdfOf([['Some rules.']]))
    vi.mocked(db.processTextChunk).mockResolvedValue({ items: [], _aiUsed: false })
    const { container } = mount()
    await uploadPdf(container)
    expect(await screen.findByText('AI Engine: LLM Connection Failed')).toBeInTheDocument()
    expect(screen.getByText(/a heuristic fallback was used/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('AI Engine: LLM Connection Failed')).toBeNull()
  })

  it('refuses a file that is not a PDF and says the file type is wrong (NFR-06)', async () => {
    const { container } = mount()
    await userEvent.click(screen.getByRole('button', { name: /PDF Guidelines/ }))
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(container.querySelector('input[accept=".pdf"]') as HTMLInputElement, new File(['plain text'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText('"notes.txt" is not a PDF file. Choose a .pdf file.')).toBeInTheDocument()
    expect(getDocument).not.toHaveBeenCalled()
  })

  it('says when a PDF has no readable text', async () => {
    getDocument.mockReturnValue(pdfOf([['   '], ['']]))
    const { container } = mount()
    await uploadPdf(container)
    expect(await screen.findByText('Failed to extract text from PDF. Please ensure the file is not scanned/image-only.')).toBeInTheDocument()
    expect(db.processTextChunk).not.toHaveBeenCalled()
  })

  it('says when the PDF cannot be opened', async () => {
    getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error('Invalid PDF')) }))
    const { container } = mount()
    await uploadPdf(container)
    expect(await screen.findByText(/Failed to extract text from PDF/)).toBeInTheDocument()
  })

  it('shows the AI error when a chunk request fails', async () => {
    getDocument.mockReturnValue(pdfOf([['Some rules.']]))
    vi.mocked(db.processTextChunk).mockRejectedValue(new Error('Groq 500'))
    const { container } = mount()
    await uploadPdf(container)
    expect(await screen.findByText('Error during Llama processing: Error: Groq 500')).toBeInTheDocument()
    expect(db.mergeChecklistItems).not.toHaveBeenCalled()
  })

  it('names the guideline after the file and handles a merge with no items or categories', async () => {
    getDocument.mockReturnValue(pdfOf([['Some rules.']]))
    vi.mocked(db.mergeChecklistItems).mockResolvedValue({ name: '', shortName: '', _aiUsed: true } as never)
    const { container } = mount()
    await uploadPdf(container, '--a.pdf')
    expect(await screen.findByText('Framework Items')).toBeInTheDocument()
    expect(screen.getByText('Framework Items').nextElementSibling).toHaveTextContent('0')
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})

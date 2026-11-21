import { describe, expect, it } from 'vitest'
import { guidelineFileTypeError } from '../../../../src/features/generator/fileType'

describe('guidelineFileTypeError (NFR-06)', () => {
  it.each(['EDPB checklist.xlsx', 'old.xls', 'CAPS.XLSX', ' spaced.xlsx '])('accepts %s on the Excel tab', (name) => {
    expect(guidelineFileTypeError(name, 'excel')).toBeNull()
  })

  it.each(['notes.txt', 'data.csv', 'guide.pdf', 'xlsx', 'report.xlsx.exe'])('refuses %s on the Excel tab', (name) => {
    expect(guidelineFileTypeError(name, 'excel')).toBe(`"${name}" is not an Excel file. Choose a .xlsx or .xls file.`)
  })

  it.each(['Kids Code 2024.pdf', 'GUIDE.PDF'])('accepts %s on the PDF tab', (name) => {
    expect(guidelineFileTypeError(name, 'pdf')).toBeNull()
  })

  it.each(['notes.txt', 'sheet.xlsx', 'scan.pdf.png'])('refuses %s on the PDF tab', (name) => {
    expect(guidelineFileTypeError(name, 'pdf')).toBe(`"${name}" is not a PDF file. Choose a .pdf file.`)
  })
})

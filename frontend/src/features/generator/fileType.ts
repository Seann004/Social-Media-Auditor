// Upload checks for the Generator (NFR-06). The file picker's `accept` filter is only a hint:
// a user can switch it to "All files", so each upload is checked by its extension before it is read.

export type GuidelineFileKind = 'excel' | 'pdf'

const ALLOWED: Record<GuidelineFileKind, { extensions: readonly string[]; label: string; hint: string }> = {
  excel: { extensions: ['.xlsx', '.xls'], label: 'an Excel', hint: 'a .xlsx or .xls' },
  pdf: { extensions: ['.pdf'], label: 'a PDF', hint: 'a .pdf' },
}

/** Returns an error message when `fileName` is not of the given kind, or null when it is allowed. */
export function guidelineFileTypeError(fileName: string, kind: GuidelineFileKind): string | null {
  const rule = ALLOWED[kind]
  const lower = fileName.trim().toLowerCase()
  if (rule.extensions.some((ext) => lower.endsWith(ext))) return null
  return `"${fileName}" is not ${rule.label} file. Choose ${rule.hint} file.`
}

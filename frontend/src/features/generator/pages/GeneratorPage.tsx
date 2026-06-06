import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  MagicWandIcon as Wand,
  SparkleIcon as Sparkle,
  PlusIcon as Plus,
  CheckIcon as Check,
  TrashIcon as Trash,
  UploadIcon as Upload,
  FileXlsIcon as FileSpreadsheet,
  WarningIcon as Warning,
  ShieldCheckIcon as ShieldCheck,
  FilePdfIcon as FilePdf,
  XIcon,
} from '@phosphor-icons/react'
import { useStore } from '../../../store/useStore'
import SeverityBadge from '../../audits/components/SeverityBadge'
import * as db from '../../../lib/db'
import type { Guideline, ChecklistItem, Platform, Severity } from '../../../types'

// Set worker source to CDN to avoid complex bundling in Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const PRESETS: Record<string, { category: string; text: string; severity: Severity }[]> = {
  TikTok: [
    { category: 'Age Gate', text: 'Ensure a neutral age screen is presented during sign-up that does not default to or nudge users towards entering a birth date that makes them 13+.', severity: 'critical' },
    { category: 'Direct Messaging', text: 'Validate that direct messaging is disabled by default for users registered under the age of 16.', severity: 'critical' },
    { category: 'Content Filtering', text: 'Confirm that restricted mode is enabled by default to filter out mature, sensitive, or harmful user-generated content from the For You feed.', severity: 'major' },
    { category: 'Data Safety', text: 'Ensure geolocation and precise location sharing are completely disabled by default for minors under 18.', severity: 'major' },
  ],
  Instagram: [
    { category: 'Age Gate', text: 'Verify that third-party age assurance tools (like Yoti facial age estimation) are integrated for users trying to change their age from under 18 to over 18.', severity: 'major' },
    { category: 'Direct Messaging', text: 'Ensure minor accounts (under 16) can only receive direct messages and group chat invites from accounts they already follow.', severity: 'critical' },
    { category: 'Consent', text: 'Validate that parental consent is explicitly verified via email or credit card transaction before allowing under-13 child profile features.', severity: 'critical' },
    { category: 'Data Safety', text: 'Verify that minor accounts are set to "Private" by default upon sign-up, restricting profile details from public search.', severity: 'major' },
  ],
  YouTube: [
    { category: 'Ad Profiling', text: 'Ensure that personalized advertisements are disabled by default for accounts identified as children or teens under 18.', severity: 'critical' },
    { category: 'Content Filtering', text: 'Validate that auto-play features on videos are disabled by default for accounts identified as minors under 18.', severity: 'minor' },
    { category: 'Data Safety', text: 'Ensure precise location tracking, audio data, and search history are not collected or profile-saved for child accounts.', severity: 'critical' },
    { category: 'Age Gate', text: 'Implement robust age verification gates for accessing mature videos flagged with restricted viewing requirements.', severity: 'major' },
  ],
  Discord: [
    { category: 'Direct Messaging', text: 'Confirm that direct messaging from server members who are not on the user\'s friends list is disabled by default for child accounts.', severity: 'major' },
    { category: 'Content Filtering', text: 'Verify that mature content filters are permanently locked to the highest level for accounts registered under 18.', severity: 'major' },
    { category: 'Consent', text: 'Ensure clear, age-appropriate, parental-consent verification mechanisms are utilized before minors join public servers.', severity: 'critical' },
  ],
  General: [
    { category: 'Dark Patterns', text: 'Verify that cancellation of account or subscription does not use deceptive color contrasts, microcopy, or multi-step loops to dissuade minor users.', severity: 'minor' },
    { category: 'Consent', text: 'Validate that privacy policies and terms of service are written in clear, age-appropriate language that can be easily understood by minors.', severity: 'minor' },
    { category: 'Data Safety', text: 'Ensure that all data collected from minors is encrypted in transit and at rest with strict access controls.', severity: 'major' },
  ]
}

export default function GeneratorPage() {
  const navigate = useNavigate()
  const { addSyntheticGuideline } = useStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<'excel' | 'pdf'>('excel')

  const [platform] = useState<Platform>('TikTok')

  // Upload state
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelError, setExcelError] = useState('')

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [generatedGuideline, setGeneratedGuideline] = useState<Guideline | null>(null)
  const [generatedItems, setGeneratedItems] = useState<ChecklistItem[]>([])

  // PDF specific parsing progress state
  const [pdfStep, setPdfStep] = useState(0) // 1: extracting, 2: processing chunks, 3: merging
  const [totalChunks, setTotalChunks] = useState(0)
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0)
  const [selectedItemForModal, setSelectedItemForModal] = useState<ChecklistItem | null>(null)
  const [itemModalTab, setItemModalTab] = useState<'help' | 'traceability'>('help')




  const excelSteps = [
    'Reading binary spreadsheet data...',
    'Locating audit columns and row types...',
    'Parsing Section/Subsection hierarchies...',
    'Compiling checklist items and mapping references...'
  ]

  // Hierarchical Excel Parser
  const handleExcelParse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setExcelFile(file)
    setExcelError('')
    setGenerating(true)
    setCurrentStep(0)
    setGeneratedGuideline(null)
    setGeneratedItems([])

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const rawRows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 })

        const timer = setInterval(() => {
          setCurrentStep(prev => {
            if (prev < excelSteps.length - 1) {
              return prev + 1
            } else {
              clearInterval(timer)
              processExcelData(rawRows, file.name)
              return prev
            }
          })
        }, 600)

      } catch (err) {
        console.error(err)
        setExcelError('Failed to parse Excel file. Ensure it is a valid .xlsx file.')
        setGenerating(false)
      }
    }

    reader.onerror = () => {
      setExcelError('Error reading file.')
      setGenerating(false)
    }

    reader.readAsBinaryString(file)
  }

  
  const generateSequentialUUID = (baseTs: number, offset: number) => {
    const ts = (baseTs + offset).toString(16).padStart(12, '0')
    const r = window.crypto.randomUUID().replace(/-/g, '')
    return `${ts.substring(0,8)}-${ts.substring(8,12)}-7${r.substring(13,16)}-8${r.substring(17,20)}-${r.substring(20,32)}`
  }

  const processExcelData = (rows: any[][], fileName: string) => {
    if (rows.length === 0) {
      setExcelError('The Excel file is empty.')
      setGenerating(false)
      return
    }

    let headerIdx = -1
    let colMap = {
      rowType: -1,
      itemId: -1,
      itemName: -1,
      itemDesc: -1,
      helpText: -1,
      clauseRef: -1,
      verbatimText: -1
    }

    // Detect if this sheet has explicit Row Type and Item ID headers (e.g. in the first 10 rows)
    let hasRowTypeHeader = false
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r]
      if (!row) continue
      const rowLower = row.map(c => String(c || '').toLowerCase().replace(/[\s_\-]/g, ''))
      const rtIdx = rowLower.indexOf('rowtype')
      const idIdx = rowLower.indexOf('itemid')
      if (rtIdx !== -1 && idIdx !== -1) {
        hasRowTypeHeader = true
        headerIdx = r
        colMap.rowType = rtIdx
        colMap.itemId = idIdx
        colMap.itemName = rowLower.indexOf('itemname')
        colMap.itemDesc = rowLower.indexOf('itemdescription')
        colMap.helpText = rowLower.indexOf('helptext')
        colMap.clauseRef = rowLower.indexOf('clausereference')
        colMap.verbatimText = rowLower.findIndex((c: string) => c.includes('verbatim') || c.includes('traceability'))
        break
      }
    }

    // Fallback detection for EDPB format if row type is not found
    let isEDPBFormat = false
    let clauseRefCol = -1
    let textCol = -1

    if (!hasRowTypeHeader) {
      for (let r = 0; r < Math.min(rows.length, 5); r++) {
        const row = rows[r]
        if (!row) continue
        const crefIdx = row.findIndex(c => {
          const s = String(c).toLowerCase().replace(/\s/g, '')
          return s.includes('clausereference') || s.includes('clause') || s.includes('ref')
        })
        const textIdx = row.findIndex(c => {
          const s = String(c).toLowerCase().replace(/\s/g, '')
          return s.includes('verbatim') || s.includes('clausetext') || s.includes('text') || s.includes('description')
        })
        if (crefIdx !== -1 && textIdx !== -1) {
          clauseRefCol = crefIdx
          textCol = textIdx
          headerIdx = r
          isEDPBFormat = true
          break
        }
      }

      if (!isEDPBFormat && headerIdx === -1) {
        const looksLikeRef = rows.slice(0, 5).some(row => row && /^\d+(\.\d+)*$/.test(String(row[0] || '').trim()))
        if (looksLikeRef) {
          isEDPBFormat = true
          clauseRefCol = 0
          textCol = 1
          headerIdx = -1
        }
      }
    }

    const guidelineId = window.crypto.randomUUID()
    const items: ChecklistItem[] = []
    const categories: string[] = []

    let currentSectionNum = ''
    let currentSection = 'General Compliance'
    let currentSectionId = ''
    let currentSectionRawName = ''
    let currentSubsection = ''

    const cleanCategoryName = (name: string): string => {
      return name
        .replace(/^Section\s+\d+(\.\d+)*\s*[-—|:]\s*/i, '')
        .replace(/^\d+(\.\d+)*\s+/, '')
        .trim()
    }

    if (hasRowTypeHeader) {
      // Prioritize explicit SECTION, SUBSECTION, and ITEM parsing
      let activeSubsections: { id: string; name: string }[] = []
      const startIdx = headerIdx + 1

      for (let r = startIdx; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.length === 0) continue

        const type = String(row[colMap.rowType] !== undefined && row[colMap.rowType] !== null ? row[colMap.rowType] : '').trim().toUpperCase()
        const id = String(row[colMap.itemId] !== undefined && row[colMap.itemId] !== null ? row[colMap.itemId] : '').trim()
        const name = String(colMap.itemName !== -1 && row[colMap.itemName] !== undefined && row[colMap.itemName] !== null ? row[colMap.itemName] : '').trim()
        const desc = String(colMap.itemDesc !== -1 && row[colMap.itemDesc] !== undefined && row[colMap.itemDesc] !== null ? row[colMap.itemDesc] : '').trim()
        const help = String(colMap.helpText !== -1 && row[colMap.helpText] !== undefined && row[colMap.helpText] !== null ? row[colMap.helpText] : '').trim()
        const ref = colMap.clauseRef !== -1 && row[colMap.clauseRef] !== undefined && row[colMap.clauseRef] !== null ? String(row[colMap.clauseRef]).trim() : ''
        const verbatim = String(colMap.verbatimText !== -1 && row[colMap.verbatimText] !== undefined && row[colMap.verbatimText] !== null ? row[colMap.verbatimText] : '').trim()
        
        let tracePath = ''
        if (type === 'ITEM') {
          tracePath = [currentSectionRawName, ...activeSubsections.map(s => s.name), name || desc].filter(Boolean).join(' -> ')
        } else {
          tracePath = name || desc
        }
        
        let combinedFeature = help
        let finalVerbatim = verbatim ? (tracePath ? `${tracePath}\n${verbatim}` : verbatim) : (tracePath ? tracePath : '')

        if (finalVerbatim) {
          combinedFeature = combinedFeature ? `${combinedFeature}\n\n[TRACEABILITY]\n${finalVerbatim}` : `[TRACEABILITY]\n${finalVerbatim}`
        }
        if (type === 'SECTION') {
          currentSection = cleanCategoryName(name)
          currentSectionId = id
          activeSubsections = []
          currentSubsection = ''
        } else if (type === 'SUBSECTION') {
          const subId = id
          const subName = name

          // Maintain nesting by checking if new subsection is a child of the last active subsection
          while (activeSubsections.length > 0 && !subId.startsWith(activeSubsections[activeSubsections.length - 1].id + '.')) {
            activeSubsections.pop()
          }
          activeSubsections.push({ id: subId, name: subName })
          currentSubsection = activeSubsections.map(s => s.name).join(' > ')
        } else if (type === 'ITEM') {
          // Keep N/A placeholders to preserve structure

          let severity: Severity = 'major'
          const lowerDesc = desc.toLowerCase()
          const lowerName = name.toLowerCase()
          if (lowerDesc.includes('critical') || lowerDesc.includes('must') || lowerName.includes('must')) {
            severity = 'critical'
          } else if (lowerDesc.includes('minor') || lowerDesc.includes('should not') || lowerDesc.includes('option') || lowerDesc.includes('recommended')) {
            severity = 'minor'
          }

          const finalCategory = currentSubsection ? `${currentSection} > ${currentSubsection}` : currentSection
          if (finalCategory && !categories.includes(finalCategory)) {
            categories.push(finalCategory)
          }

          const _helpT = combinedFeature?.includes('[TRACEABILITY]')
            ? combinedFeature.split('[TRACEABILITY]')[0].trim()
            : combinedFeature || ''
          const _verbT = combinedFeature?.includes('[TRACEABILITY]')
            ? combinedFeature.split('[TRACEABILITY]').slice(1).join('[TRACEABILITY]').trim()
            : ''
          items.push({
            id: generateSequentialUUID(Date.now(), items.length),
            guidelineId,
            category: finalCategory,
            text: desc || name || 'No description provided',
            severity,
            reference: ref || undefined,
            helpText: _helpT || undefined,
            verbatimClauseText: _verbT || undefined,
          })
        }
      }
    } else if (isEDPBFormat) {
      const itemsMap = new Map<string, {
        ref: string;
        section: string;
        subsection: string;
        texts: string[];
      }>()

      if (clauseRefCol === -1 || textCol === -1) {
        clauseRefCol = 0
        textCol = 1
      }

      const startIdx = headerIdx !== -1 ? headerIdx + 1 : 0
      for (let r = startIdx; r < rows.length; r++) {
        const row = rows[r]
        if (!row) continue
        
        const ref = String(row[clauseRefCol] !== undefined ? row[clauseRefCol] : '').trim()
        const text = String(row[textCol] !== undefined ? row[textCol] : '').trim()

        if (!ref && !text) continue

        const isSection = /^\d+$/.test(ref)
        const isSubsection = currentSectionNum !== '' && 
                             /^\d+\.\d+$/.test(ref) && 
                             ref.startsWith(currentSectionNum + '.')

        if (isSection) {
          currentSectionNum = ref
          currentSection = text.trim()
          currentSubsection = ''
        } else if (isSubsection) {
          currentSubsection = text.trim()
        } else if (ref) {
          const itemKey = `${currentSection}_${currentSubsection}_${ref}`
          if (!itemsMap.has(itemKey)) {
            itemsMap.set(itemKey, {
              ref,
              section: currentSection,
              subsection: currentSubsection,
              texts: []
            })
          }
          itemsMap.get(itemKey)!.texts.push(text)
        }
      }

      itemsMap.forEach((entry) => {
        const { ref, section, subsection, texts } = entry
        if (texts.length === 0) return

        let name = ''
        let question = ''
        let help = ''

        if (texts.length === 1) {
          question = texts[0]
        } else if (texts.length === 2) {
          name = texts[0]
          question = texts[1]
        } else {
          name = texts[0]
          question = texts[1]
          help = texts.slice(2).filter(t => t.trim() !== '').join('\n').trim()
        }

        let severity: Severity = 'major'
        const lowerText = (name + ' ' + question).toLowerCase()
        if (lowerText.includes('critical') || lowerText.includes('must') || lowerText.includes('shall')) {
          severity = 'critical'
        } else if (lowerText.includes('minor') || lowerText.includes('should not') || lowerText.includes('option') || lowerText.includes('recommended')) {
          severity = 'minor'
        }

        const finalCategory = subsection ? `${section} > ${subsection}` : section
        if (finalCategory && !categories.includes(finalCategory)) {
          categories.push(finalCategory)
        }

        items.push({
          id: generateSequentialUUID(Date.now(), items.length),
          guidelineId,
          category: finalCategory,
          text: question || name || 'No description provided',
          severity,
          reference: ref,
          helpText: help || undefined,
        })
      })
    } else {
      // Traditional rowType detection logic (fallback)
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]
        if (!row) continue
        
        const rowTypeIdx = row.findIndex(c => String(c).toLowerCase().replace(/\s/g, '') === 'rowtype')
        const itemIdIdx = row.findIndex(c => String(c).toLowerCase().replace(/\s/g, '') === 'itemid')
        
        if (rowTypeIdx !== -1 && itemIdIdx !== -1) {
          headerIdx = r
          colMap.rowType = rowTypeIdx
          colMap.itemId = itemIdIdx
          colMap.itemName = row.findIndex(c => String(c).toLowerCase().replace(/\s/g, '') === 'itemname')
          colMap.itemDesc = row.findIndex(c => String(c).toLowerCase().replace(/\s/g, '') === 'itemdescription')
          colMap.helpText = row.findIndex(c => String(c).toLowerCase().replace(/\s/g, '') === 'helptext')
          colMap.clauseRef = row.findIndex(c => String(c).toLowerCase().replace(/\s/g, '') === 'clausereference')
          break
        }
      }

      if (headerIdx === -1) {
        colMap = { rowType: 0, itemId: 1, itemName: 2, itemDesc: 3, helpText: 4, clauseRef: 9, verbatimText: 10 }
        headerIdx = 0
      }

      let activeSubsections: { id: string; name: string }[] = []

      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.length === 0) continue

        const type = String(row[colMap.rowType] || '').trim().toUpperCase()
        const id = String(row[colMap.itemId] || '').trim()
        const name = String(row[colMap.itemName] || '').trim()
        const desc = String(row[colMap.itemDesc] || '').trim()
        const help = String(row[colMap.helpText] || '').trim()
        const ref = colMap.clauseRef !== -1 ? String(row[colMap.clauseRef] || '').trim() : ''
        const verbatim = colMap.verbatimText !== -1 && row[colMap.verbatimText] !== undefined ? String(row[colMap.verbatimText]).trim() : ''

        let tracePath = ''
        if (type === 'ITEM') {
          tracePath = [currentSectionRawName, ...activeSubsections.map(s => s.name), name || desc].filter(Boolean).join(' -> ')
        } else {
          tracePath = name || desc
        }
        
        let combinedFeature = help
        let finalVerbatim = verbatim ? (tracePath ? `${tracePath}\n${verbatim}` : verbatim) : (tracePath ? tracePath : '')

        if (finalVerbatim) {
          combinedFeature = combinedFeature ? `${combinedFeature}\n\n[TRACEABILITY]\n${finalVerbatim}` : `[TRACEABILITY]\n${finalVerbatim}`
        }

        if (type === 'SECTION') {
          currentSection = cleanCategoryName(name)
          currentSectionId = id
          activeSubsections = []
          currentSubsection = ''
        } else if (type === 'SUBSECTION') {
          const subId = id
          const subName = name
          while (activeSubsections.length > 0 && !subId.startsWith(activeSubsections[activeSubsections.length - 1].id + '.')) {
            activeSubsections.pop()
          }
          activeSubsections.push({ id: subId, name: subName })
          currentSubsection = activeSubsections.map(s => s.name).join(' > ')
        } else if (type === 'ITEM') {
          let severity: Severity = 'major'
          const lowerDesc = desc.toLowerCase()
          const lowerName = name.toLowerCase()
          if (lowerDesc.includes('critical') || lowerDesc.includes('must') || lowerName.includes('must')) {
            severity = 'critical'
          } else if (lowerDesc.includes('minor') || lowerDesc.includes('should not') || lowerDesc.includes('option')) {
            severity = 'minor'
          }

          const finalCategory = currentSubsection ? `${currentSection} > ${currentSubsection}` : currentSection
          if (finalCategory && !categories.includes(finalCategory)) {
            categories.push(finalCategory)
          }

          const _ht2 = combinedFeature?.includes('[TRACEABILITY]')
            ? combinedFeature.split('[TRACEABILITY]')[0].trim()
            : combinedFeature || ''
          const _vt2 = combinedFeature?.includes('[TRACEABILITY]')
            ? combinedFeature.split('[TRACEABILITY]').slice(1).join('[TRACEABILITY]').trim()
            : ''
          items.push({
            id: generateSequentialUUID(Date.now(), items.length),
            guidelineId,
            category: finalCategory,
            text: desc || name || 'No description provided',
            severity,
            reference: ref || undefined,
            helpText: _ht2 || undefined,
            verbatimClauseText: _vt2 || undefined,
          })
        }
      }
    }

    if (items.length === 0) {
      setExcelError('Could not find any checklist items in the Excel sheet.')
      setGenerating(false)
      return
    }

    const cleanFileName = fileName.replace(/\.[^/.]+$/, "")
    const newGuideline: Guideline = {
      id: guidelineId,
      name: cleanFileName,
      shortName: cleanFileName.slice(0, 10).toUpperCase().replace(/\s/g, '-'),
      version: '1.0 (Excel Import)',
      description: `Guideline framework imported from file ${fileName}.`,
      source: 'Excel Upload',
      categories: categories.length > 0 ? categories : ['General'],
      itemCount: items.length,
      lastUpdated: new Date().toISOString().split('T')[0]
    }

    setGeneratedGuideline(newGuideline)
    setGeneratedItems(items)
    setGenerating(false)
  }

  // PDF PARSER + LOOP CHUNKING WITH GROQ
  const handlePdfParse = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setExcelFile(file) // Reuse file state for display
    setExcelError('')
    setGenerating(true)
    setPdfStep(1)
    setGeneratedGuideline(null)
    setGeneratedItems([])

    try {
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      const pdf = await loadingTask.promise
      
      let fullText = ''
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map((item: any) => item.str).join(' ')
        fullText += pageText + '\n'
      }

      if (!fullText.trim()) {
        throw new Error('No readable text found in PDF.')
      }

      // Chunk text: ~16,000 characters per chunk (~4000 tokens)
      const textChunks = chunkText(fullText, 16000)
      setTotalChunks(textChunks.length)
      setPdfStep(2)
      
      processPdfChunks(textChunks, file.name)

    } catch (err) {
      console.error(err)
      setExcelError('Failed to extract text from PDF. Please ensure the file is not scanned/image-only.')
      setGenerating(false)
    }
  }

  const chunkText = (text: string, size: number): string[] => {
    const chunks: string[] = []
    let index = 0
    while (index < text.length) {
      chunks.push(text.slice(index, index + size))
      index += size
    }
    return chunks
  }

  const processPdfChunks = async (chunks: string[], fileName: string) => {
    const gatheredItems: any[] = []
    
    try {
      for (let i = 0; i < chunks.length; i++) {
        setCurrentChunkIdx(i)
        
        // Call backend processing endpoint
        const chunkItems = await db.processTextChunk(chunks[i], platform)
        gatheredItems.push(...chunkItems)
      }

      setPdfStep(3)
      
      // Final pass: merge & deduplicate via Groq Llama 3.3
      const mergeResult = await db.mergeChecklistItems(gatheredItems, platform)
      
      const guidelineId = window.crypto.randomUUID()
      const cleanFileName = fileName.replace(/\.[^/.]+$/, "")

      const newGuideline: Guideline = {
        id: guidelineId,
        name: cleanFileName,
        shortName: cleanFileName.slice(0, 12).toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 12),
        version: '1.0 (Llama PDF)',
        description: `Compliance guidelines synthesized from PDF file ${fileName}.`,
        source: 'PDF Llama Parser',
        categories: mergeResult.categories || ['General'],
        itemCount: mergeResult.items?.length || 0,
        lastUpdated: new Date().toISOString().split('T')[0]
      }

      const finalItems: ChecklistItem[] = (mergeResult.items || []).map((item: any, idx: number) => ({
        id: generateSequentialUUID(Date.now(), idx),
        guidelineId,
        category: item.category || 'General',
        text: item.text,
        severity: item.severity || 'major',
        reference: item.reference || undefined,
        feature: item.feature || undefined
      }))

      setGeneratedGuideline(newGuideline)
      setGeneratedItems(finalItems)
      setGenerating(false)

    } catch (err) {
      console.error(err)
      setExcelError(`Error during Llama processing: ${String(err)}`)
      setGenerating(false)
    }
  }

  const [saving, setSaving] = useState(false)
  const handleSave = async () => {
    if (generatedGuideline) {
      setSaving(true)
      try {
        await addSyntheticGuideline(generatedGuideline, generatedItems)
        navigate('/guidelines')
      } catch (err) {
        console.error(err)
        setExcelError('Failed to save checklist to database: ' + String(err))
      } finally {
        setSaving(false)
      }
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-8 md:py-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center border border-blue-100 shadow-sm">
          <Wand size={24} className="text-blue-600 animate-pulse" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Compliance Generator</h1>
          <p className="text-slate-500 text-sm mt-1">Upload Excel tables containing derived checklists, or let Llama analyze PDF guidelines to derive a checklist.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left Column: Generator Form */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
            {/* Tabs Selector */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => { setActiveTab('excel'); setGeneratedGuideline(null); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'excel' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileSpreadsheet size={14} />
                Excel Checklist
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('pdf'); setGeneratedGuideline(null); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'pdf' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <FilePdf size={14} />
                PDF Guidelines
              </button>
            </div>

            {activeTab === 'excel' ? (
              // EXCEL FILE UPLOAD VIEW
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Upload Excel Checklist</h3>
                  <p className="text-slate-400 text-xs leading-relaxed mb-4">
                    Upload an Excel audit checklist (e.g. EDPB Guidelines template). The sheet must contain columns matching:
                    <span className="font-semibold text-slate-600"> Row Type, Item ID, Item Name, Item Description, Help Text</span>.
                  </p>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/10 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all gap-3 text-center"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".xlsx, .xls"
                    className="hidden"
                    onChange={handleExcelParse}
                  />
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100">
                    <Upload size={20} className="text-blue-600" />
                  </div>
                  <div className="w-full px-2">
                    <p className="text-sm font-bold text-slate-800 break-all text-center">
                      {excelFile && activeTab === 'excel' ? excelFile.name : 'Select Excel File'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Accepts .xlsx and .xls formats</p>
                  </div>
                </div>

                {excelError && activeTab === 'excel' && (
                  <div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5">
                    <Warning size={14} />
                    {excelError}
                  </div>
                )}
              </div>
            ) : (
              // PDF AI GUIDELINES VIEW
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Upload PDF Guidelines</h3>
                  <p className="text-slate-400 text-xs leading-relaxed mb-4">
                    Select a social media child safety guideline PDF. We will extract its text via PDF.js, chunk the document, and prompt **Llama-3.3-70b** on Groq to extract and compile the checklist.
                  </p>
                </div>

                

                <div
                  onClick={() => pdfInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/10 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all gap-3 text-center"
                >
                  <input
                    type="file"
                    ref={pdfInputRef}
                    accept=".pdf"
                    className="hidden"
                    onChange={handlePdfParse}
                  />
                  <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center border border-red-100">
                    <FilePdf size={20} className="text-red-500" />
                  </div>
                  <div className="w-full px-2">
                    <p className="text-sm font-bold text-slate-800 break-all text-center">
                      {excelFile && activeTab === 'pdf' ? excelFile.name : 'Select PDF Guidelines'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Accepts standard PDF documents</p>
                  </div>
                </div>

                {excelError && activeTab === 'pdf' && (
                  <div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5">
                    <Warning size={14} />
                    {excelError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Loading / Results Preview */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 min-h-[460px] flex flex-col justify-between">
            <AnimatePresence mode="wait">
              {generating ? (
                // Step-by-Step Generator Processing Animation
                <motion.div
                  key="generating"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col items-center justify-center py-8 space-y-6"
                >
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                      className="absolute inset-0 border-4 border-blue-100 border-t-blue-600 rounded-full"
                    />
                    {activeTab === 'pdf' ? (
                      <FilePdf size={24} className="text-red-500 animate-bounce" />
                    ) : (
                      <Wand size={24} className="text-blue-600 animate-bounce" />
                    )}
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-slate-800">
                      {activeTab === 'excel' ? 'Parsing Compliance Spreadsheet' : 'Processing PDF Guidelines via Llama-3.3'}
                    </h3>
                    <p className="text-slate-400 text-xs mt-1">
                      {activeTab === 'excel'
                        ? 'Mapping columns and evaluating hierarchical relationships...'
                        : 'Looping through text chunks & calling Groq API...'}
                    </p>
                  </div>
                  
                  {activeTab === 'pdf' ? (
                    // RENDER CUSTOM STEP INDICATOR FOR PDF PARSING
                    <div className="w-full max-w-sm space-y-3 pt-4">
                      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all ${
                        pdfStep >= 1 ? 'border-emerald-100 bg-emerald-50/30 text-emerald-800' : 'border-blue-200 bg-blue-50/50 text-blue-800'
                      }`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                          pdfStep > 1 ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white'
                        }`}>
                          {pdfStep > 1 ? <Check size={12} weight="bold" /> : '1'}
                        </div>
                        <span className="text-sm font-medium">Extracting text from PDF pages (PDF.js)...</span>
                      </div>
                      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all ${
                        pdfStep === 2
                          ? 'border-blue-200 bg-blue-50/50 text-blue-800'
                          : pdfStep > 2
                          ? 'border-emerald-100 bg-emerald-50/30 text-emerald-800'
                          : 'border-slate-100 bg-slate-50/20 text-slate-400'
                      }`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                          pdfStep === 2 ? 'bg-blue-600 text-white animate-pulse' : pdfStep > 2 ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
                        }`}>
                          {pdfStep > 2 ? <Check size={12} weight="bold" /> : '2'}
                        </div>
                        <span className="text-sm font-medium">
                          {pdfStep === 2 ? `Analyzing text chunk ${currentChunkIdx + 1} of ${totalChunks} (Llama-3.3)...` : 'Analyzing text chunks (Llama-3.3)...'}
                        </span>
                      </div>
                      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all ${
                        pdfStep === 3
                          ? 'border-blue-200 bg-blue-50/50 text-blue-800'
                          : 'border-slate-100 bg-slate-50/20 text-slate-400'
                      }`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                          pdfStep === 3 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'
                        }`}>
                          3
                        </div>
                        <span className="text-sm font-medium">Merging & deduplicating checklist items (Llama-3.3)...</span>
                      </div>
                    </div>
                  ) : (
                    // AI / EXCEL STANDARD STEPS
                    <div className="w-full max-w-sm space-y-3 pt-4">
                      {excelSteps.map((step, idx) => {
                        const active = currentStep === idx
                        const completed = currentStep > idx
                        return (
                          <div
                            key={step}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all ${
                              active
                                ? 'border-blue-200 bg-blue-50/50 text-blue-800'
                                : completed
                                ? 'border-emerald-100 bg-emerald-50/30 text-emerald-800'
                                : 'border-slate-100 bg-slate-50/20 text-slate-400'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${
                              active
                                ? 'bg-blue-600 text-white'
                                : completed
                                ? 'bg-emerald-500 text-white'
                                : 'bg-slate-200 text-slate-500'
                            }`}>
                              {completed ? <Check size={12} weight="bold" /> : idx + 1}
                            </div>
                            <span className="text-sm font-medium">{step}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </motion.div>
              ) : generatedGuideline ? (
                // Framework Generated Results Preview
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col justify-between"
                >
                  <div className="space-y-5">
                    <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-mono font-bold uppercase tracking-wide">
                            {generatedGuideline.shortName}
                          </span>
                          <span className="text-slate-400 text-xs">v{generatedGuideline.version}</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mt-1 break-all">{generatedGuideline.name}</h3>
                        <p className="text-slate-500 text-sm mt-1 break-all">{generatedGuideline.description}</p>
                      </div>
                      <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100 text-center shrink-0 ml-3">
                        <p className="text-xs text-slate-400 font-medium">Framework Items</p>
                        <p className="text-lg font-bold text-slate-800">{generatedGuideline.itemCount}</p>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                      {generatedItems.map((item, idx) => (
                        <div key={item.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            {item.category.includes(' > ') ? (
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-[10px] text-slate-400 font-medium truncate max-w-[250px] sm:max-w-[400px]" title={item.category.split(' > ').slice(0, -1).join(' → ')}>
                                  {item.category.split(' > ').slice(0, -1).join(' → ')}
                                </span>
                                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded w-fit truncate max-w-[200px]" title={item.category.split(' > ').pop()}>
                                  {item.category.split(' > ').pop()}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded truncate max-w-[200px]" title={item.category}>
                                {item.category}
                              </span>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { setSelectedItemForModal(item); setItemModalTab('help'); }}
                                className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 font-medium px-2 py-0.5 rounded transition-colors cursor-pointer font-semibold"
                              >
                                Help
                              </button>
                              <button
                                type="button"
                                onClick={() => { setSelectedItemForModal(item); setItemModalTab('traceability'); }}
                                className="text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 border border-slate-200/60 font-mono px-2 py-0.5 rounded transition-colors cursor-pointer shadow-sm"
                              >
                                {item.reference || 'N/A'}
                              </button>
                              <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full font-bold ${
                                item.severity === 'critical'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                  : item.severity === 'major'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                  : 'bg-blue-50 text-blue-700 border border-blue-100'
                              }`}>
                                {item.severity}
                              </span>
                            </div>
                          </div>
                          <p className="text-sm text-slate-700 leading-relaxed font-semibold">
                            {idx + 1}. {item.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 border-t border-slate-100 pt-4 mt-6">
                    <button
                      onClick={() => { setGeneratedGuideline(null); setExcelFile(null); }}
                      className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-semibold hover:bg-slate-50 transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                    >
                      {saving ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check size={16} weight="bold" />
                      )}
                      Commit Framework to Guidelines
                    </button>
                  </div>
                </motion.div>
              ) : (
                // Empty State
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col items-center justify-center text-center py-12"
                >
                  <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 mb-4 shadow-sm">
                    <ShieldCheck size={28} className="text-slate-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800">Framework Synthesis Area</h3>
                  <p className="text-slate-400 text-sm max-w-sm mt-2 leading-relaxed">
                    {activeTab === 'excel'
                      ? 'Upload an Excel checklist (.xlsx) using the box on the left to parse compliance frameworks.'
                      : 'Upload a PDF guidelines file on the left and let Groq Llama-3.3 derive the checklist.'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Reference & Help Text Modal */}
      <AnimatePresence>
        {selectedItemForModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForModal(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="flex flex-col border-b border-slate-100 mb-4 bg-slate-50">
                <div className="flex items-center justify-between p-4">
                  <h3 className="text-base font-bold text-slate-900">
                    {itemModalTab === 'help' ? 'Help & Audit Guidance' : 'Traceability Details'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemForModal(null)
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    <XIcon size={16} weight="bold" />
                  </button>
                </div>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1 px-4 pb-4">
                {itemModalTab === 'help' ? (
                  <>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">CHECKLIST QUESTION</h4>
                      <p className="text-sm font-semibold text-slate-800 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3.5">
                        {selectedItemForModal!.text}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">SEVERITY</h4>
                      <SeverityBadge severity={selectedItemForModal!.severity} />
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">HELP & AUDIT GUIDANCE</h4>
                      <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/30 border border-blue-100/50 rounded-xl p-3.5 whitespace-pre-wrap">
                        {selectedItemForModal!.helpText || 'No additional audit instructions provided for this item.'}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">CLAUSE REFERENCE</h4>
                      <span className="inline-block font-mono text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded">
                        {selectedItemForModal!.reference || 'N/A'}
                      </span>
                    </div>

                    {selectedItemForModal!.verbatimClauseText ? (
                        <div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">VERBATIM CLAUSE TEXT</h4>
                          <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3.5 whitespace-pre-wrap font-mono">
                            {selectedItemForModal!.verbatimClauseText}
                          </p>
                        </div>
                    ) : (
                      <p className="text-sm text-slate-400 italic mt-4">No verbatim clause text available.</p>
                    )}
                  </>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedItemForModal(null)}
                  className="px-4 py-2 bg-slate-800 text-white text-xs font-bold rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

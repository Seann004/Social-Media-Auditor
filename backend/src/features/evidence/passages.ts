import { MAX_WORDS_PER_PASSAGE } from './config.js'

const SENTENCE_PATTERN = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g
const CONTROL_LINE_PATTERN = /^\s*-?\s*((?:checkbox|switch|radio|combobox)\b.*)$/

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

function sentencesOf(paragraph: string): string[] {
  return (paragraph.match(SENTENCE_PATTERN) ?? [paragraph]).map((s) => s.trim()).filter(Boolean)
}

/**
 * Splits page text into passages of at most maxWords words, breaking on
 * paragraphs first and sentences second. A single sentence longer than
 * maxWords is kept whole rather than cut mid-sentence.
 */
export function splitIntoPassages(text: string, maxWords: number = MAX_WORDS_PER_PASSAGE): string[] {
  const passages: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.replace(/\s+/g, ' ').trim()
    if (!trimmed) continue
    if (wordCount(trimmed) <= maxWords) {
      passages.push(trimmed)
      continue
    }
    let current = ''
    for (const sentence of sentencesOf(trimmed)) {
      const combined = current ? `${current} ${sentence}` : sentence
      if (current && wordCount(combined) > maxWords) {
        passages.push(current)
        current = sentence
      } else {
        current = combined
      }
    }
    if (current) passages.push(current)
  }
  return passages
}

/** Keeps only checkbox, switch, radio and combobox lines (with their state) from an ARIA snapshot. */
export function extractControlLines(ariaSnapshot: string): string {
  return ariaSnapshot
    .split('\n')
    .map((line) => CONTROL_LINE_PATTERN.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

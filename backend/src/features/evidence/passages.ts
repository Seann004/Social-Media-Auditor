import { MAX_CHARS_PER_PASSAGE, MAX_WORDS_PER_PASSAGE } from './config.js'

const SENTENCE_PATTERN = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g
const CONTROL_LINE_PATTERN = /^\s*-?\s*((?:checkbox|switch|radio|combobox)\b.*)$/

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

function sentencesOf(paragraph: string): string[] {
  return (paragraph.match(SENTENCE_PATTERN) ?? [paragraph]).map((s) => s.trim()).filter(Boolean)
}

function fits(s: string, maxWords: number, maxChars: number): boolean {
  return wordCount(s) <= maxWords && s.length <= maxChars
}

/** Cuts text that is over a cap between words, and inside a word only if that word alone is over the character cap. */
function hardSplit(text: string, maxWords: number, maxChars: number): string[] {
  const pieces: string[] = []
  let current = ''
  let currentWords = 0
  const flush = () => {
    if (current) pieces.push(current)
    current = ''
    currentWords = 0
  }
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let at = 0; at < word.length || at === 0; at += maxChars) {
      const part = word.slice(at, at + maxChars)
      const joined = current ? `${current} ${part}` : part
      if (current && (currentWords + 1 > maxWords || joined.length > maxChars)) flush()
      current = current ? `${current} ${part}` : part
      currentWords += 1
      if (part.length === maxChars) flush()
    }
  }
  flush()
  return pieces
}

/**
 * Splits page text into passages of at most maxWords words and maxChars characters, breaking on
 * paragraphs first and sentences second. A sentence over either cap is cut between words, so that
 * a passage always fits into one call of the AI.
 */
export function splitIntoPassages(
  text: string,
  maxWords: number = MAX_WORDS_PER_PASSAGE,
  maxChars: number = MAX_CHARS_PER_PASSAGE,
): string[] {
  const passages: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.replace(/\s+/g, ' ').trim()
    if (!trimmed) continue
    if (fits(trimmed, maxWords, maxChars)) {
      passages.push(trimmed)
      continue
    }
    let current = ''
    for (const sentence of sentencesOf(trimmed).flatMap((s) => (fits(s, maxWords, maxChars) ? [s] : hardSplit(s, maxWords, maxChars)))) {
      const combined = current ? `${current} ${sentence}` : sentence
      if (current && !fits(combined, maxWords, maxChars)) {
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

/** Cuts a block of control lines into chunks of at most maxChars, between lines. */
export function splitControlLines(text: string, maxChars: number = MAX_CHARS_PER_PASSAGE): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    for (const part of line.length > maxChars ? hardSplit(line, Infinity, maxChars) : [line]) {
      const joined = current ? `${current}\n${part}` : part
      if (current && joined.length > maxChars) {
        chunks.push(current)
        current = part
      } else {
        current = joined
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** Keeps only checkbox, switch, radio and combobox lines (with their state) from an ARIA snapshot. */
export function extractControlLines(ariaSnapshot: string): string {
  return ariaSnapshot
    .split('\n')
    .map((line) => CONTROL_LINE_PATTERN.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

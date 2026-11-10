import { useState } from 'react'
import { RobotIcon as Robot } from '@phosphor-icons/react'
import type { ChecklistItemStatus } from '../../../types'
import { isHttpUrl } from '../safeUrl'
import { suggestionState, toAnswerStatus, type CardState } from '../state'
import { FLAG_LABEL, type DecisionView, type QuoteView, type FlagType, type SuggestionView } from '../types'
import CodeFound from './CodeFound'
import { RESULT_LABEL } from './OverrideDialog'
import QuoteThumbnail from './QuoteThumbnail'
import ReplaySteps from './ReplaySteps'

export interface SuggestionCardProps {
  suggestion: SuggestionView
  decision: DecisionView | null
  currentStatus: ChecklistItemStatus | undefined
  /** False for a Head Auditor and for a locked audit: the card is read-only. */
  canDecide: boolean
  busy?: boolean
  /** A failed decision, in the server's words. */
  error?: string | null
  onAccept: () => void
  onOverride: () => void
  onKeepMine: () => void
}

const STATE_NOTE: Partial<Record<CardState, string>> = {
  agrees: 'Matches your answer',
  disagrees: 'AI disagrees with your answer',
  new_differs: 'New suggestion differs from current answer',
}

/** A picture exists for a verified quote of a page with a highlight or a screenshot. A code piece never has one. */
function hasPicture(quote: QuoteView, isRepo: boolean): boolean {
  return !isRepo && quote.pageId !== null && quote.verified && (quote.hasHighlight || quote.pageHasScreenshot)
}

function QuoteItem({ quote, isRepo }: { quote: QuoteView; isRepo: boolean }) {
  const label = quote.pageTitle?.trim() || quote.pageUrl || 'Page'
  const picture = hasPicture(quote, isRepo)
  return (
    <li className="space-y-1.5 py-2">
      <blockquote className="border-l-2 border-slate-200 pl-3 text-sm italic text-slate-600">&ldquo;{quote.quoteText}&rdquo;</blockquote>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!quote.verified && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">Quote not found in the page</span>}
        {quote.pageUrl &&
          (isHttpUrl(quote.pageUrl) ? (
            <a
              href={quote.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded break-all text-blue-600 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {label}
            </a>
          ) : (
            <span className="break-all text-slate-500">{label}</span>
          ))}
        {picture && !quote.hasHighlight && <span className="text-slate-400">Full page</span>}
      </div>
      {picture && <QuoteThumbnail quoteId={quote.id} />}
    </li>
  )
}

/** The commit comes with the suggestion listing; without it the note stays general. */
function commitNote(commitSha: string | null): string {
  return commitSha ? `Based on the code at commit ${commitSha.slice(0, 7)}, not on the live app.` : 'Based on code, not on the live app.'
}

interface ListedFlag {
  type: FlagType
  reason: string | null
}

/**
 * The flags worth listing: a flag whose reason only repeats the card's reason (a missing_evidence flag
 * carries the AI's own reason) keeps its label and drops the repeated words; one with neither is left out.
 */
function flagsToList(suggestion: SuggestionView): ListedFlag[] {
  const reason = suggestion.reason.trim()
  return suggestion.flags.flatMap((flag): ListedFlag[] => {
    const repeats = flag.reason.trim() === reason
    if (!repeats) return [{ type: flag.type, reason: flag.reason }]
    return FLAG_LABEL[flag.type] ? [{ type: flag.type, reason: null }] : []
  })
}

function DecisionNote({ decision }: { decision: DecisionView }) {
  if (decision.decision === 'accepted') return <p className="text-xs font-medium text-emerald-700">Accepted</p>
  return (
    <div className="text-xs">
      <p className="font-medium text-slate-700">Overridden to {RESULT_LABEL[decision.finalResult]}</p>
      {decision.overrideReason && <p className="text-slate-500">Reason: {decision.overrideReason}</p>}
    </div>
  )
}

export default function SuggestionCard({ suggestion, decision, currentStatus, canDecide, busy = false, error, onAccept, onOverride, onKeepMine }: SuggestionCardProps) {
  const [replaying, setReplaying] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const isRepo = suggestion.source === 'repo'
  const flags = flagsToList(suggestion)
  const state = suggestionState({ suggestion, decision, currentStatus })
  const suggested = suggestion.suggestedResult
  const decided = state === 'accepted' || state === 'overridden'
  const showActions = canDecide && suggested !== null && !decided
  const note = STATE_NOTE[state]
  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium ring-1 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <section aria-label="AI suggestion" className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Robot size={16} weight="fill" className="text-blue-600" aria-hidden="true" />
        {suggested !== null ? (
          <p className="text-sm text-slate-700">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">AI suggestion</span>{' '}
            <span className="font-semibold text-slate-900">{RESULT_LABEL[toAnswerStatus(suggested)]}</span>
          </p>
        ) : (
          <p className="text-sm font-medium text-slate-700">The AI could not suggest an answer</p>
        )}
        {suggestion.flags.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
            <Robot size={12} weight="fill" aria-hidden="true" /> Needs human review
          </span>
        )}
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>

      <p className="text-sm text-slate-600">{suggestion.reason}</p>

      {flags.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-blue-700">
          {flags.map((flag, i) => (
            <li key={`${flag.type}-${i}`}>
              {FLAG_LABEL[flag.type] ? <span className="mr-1.5 rounded bg-blue-100 px-1.5 py-0.5 font-medium">{FLAG_LABEL[flag.type]}</span> : null}
              {flag.reason}
            </li>
          ))}
        </ul>
      )}

      {suggestion.quotes.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {suggestion.quotes.map((quote) => (
            <QuoteItem key={quote.id} quote={quote} isRepo={isRepo} />
          ))}
        </ul>
      )}

      {decided && decision && <DecisionNote decision={decision} />}

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      {isRepo && <p className="text-xs text-slate-500">{commitNote(suggestion.commitSha)}</p>}

      {suggestion.source === 'app' && (
        <div>
          <button type="button" onClick={() => setReplaying(true)} className="rounded text-xs font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Replay steps
          </button>
        </div>
      )}
      {isRepo && suggestion.hasCode && (
        <div>
          <button
            type="button"
            aria-expanded={showCode}
            onClick={() => setShowCode((open) => !open)}
            className="rounded text-xs font-medium text-blue-600 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Code found
          </button>
        </div>
      )}
      {isRepo && suggestion.hasCode && showCode && <CodeFound suggestionId={suggestion.id} />}
      {replaying && <ReplaySteps suggestionId={suggestion.id} onClose={() => setReplaying(false)} />}

      {showActions && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onAccept} className={`${btn} bg-blue-600 text-white ring-blue-600 hover:bg-blue-700`}>
            {state === 'disagrees' ? 'Accept suggestion' : 'Accept'}
          </button>
          {state === 'disagrees' ? (
            <button type="button" disabled={busy} onClick={onKeepMine} className={`${btn} bg-white text-slate-600 ring-slate-200 hover:bg-slate-50`}>
              Keep my answer
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={onOverride} className={`${btn} bg-white text-slate-600 ring-slate-200 hover:bg-slate-50`}>
              Override
            </button>
          )}
        </div>
      )}
    </section>
  )
}

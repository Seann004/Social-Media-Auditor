import { useCallback, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import type { ChecklistItemStatus } from '../../types'
import { EvidenceApiError, postDecision } from './api'
import { RESULT_LABEL, type OverrideDialogProps } from './components/OverrideDialog'
import { responseAction, toAnswerStatus } from './state'
import type { AnswerStatus, AppliedAnswer, DecisionRequest, DecisionView, SuggestedResult, SuggestionView } from './types'
import type { UseEvidenceResult } from './useEvidence'

const FINDINGS_SAVE_MESSAGE = 'Your findings could not be saved, so nothing was decided. Check your connection and try again.'
const GENERIC_MESSAGE = 'The decision could not be saved. Check your connection and try again.'

export interface ResponseFlowOptions {
  projectId: string
  /** True for an auditor on an audit that is not locked. Everyone else keeps the plain save path. */
  canDecide: boolean
  evidence: Pick<UseEvidenceResult, 'suggestionsByItem' | 'decisionsByItem' | 'refresh'>
  /** Text typed in the findings box and not yet saved, or undefined. */
  getUnsavedFindings: (itemId: string) => string | undefined
  /** Page-local follow-up once the decision is saved (findings box, photos). */
  onDecided: (itemId: string, answer: AppliedAnswer, decision: 'accepted' | 'overridden') => void
}

export interface ResponseFlow {
  canDecide: boolean
  /** Handles an answer-button click. False means the flow did not take it: save it the usual way. */
  handleClick: (itemId: string, clicked: ChecklistItemStatus) => Promise<boolean>
  /** The card's Accept. */
  accept: (itemId: string) => Promise<void>
  /** The card's Override, or Keep my answer. */
  openOverride: (itemId: string, mode?: 'override' | 'keep') => void
  isBusy: (itemId: string) => boolean
  /** A failed decision for the card; null while the dialog is open (it shows the error itself). */
  errorFor: (itemId: string) => string | null
  dialogProps: OverrideDialogProps | null
}

interface DialogState {
  itemId: string
  suggestionId: string
  origin: DecisionRequest['origin']
  suggestedResult: SuggestedResult | null
  presetResult?: AnswerStatus
}

class FindingsSaveError extends Error {}

function messageOf(err: unknown): string {
  if (err instanceof FindingsSaveError) return FINDINGS_SAVE_MESSAGE
  return err instanceof EvidenceApiError ? err.message : GENERIC_MESSAGE
}

export function useResponseFlow(options: ResponseFlowOptions): ResponseFlow {
  const { projectId, canDecide, evidence, getUnsavedFindings, onDecided } = options
  const responses = useStore((s) => s.responses)
  const [busyItems, setBusyItems] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [dialog, setDialog] = useState<DialogState | null>(null)
  // A ref as well as state: a second click in the same tick must see the first one.
  const inFlight = useRef(new Set<string>())

  const statusOf = (itemId: string): ChecklistItemStatus | undefined => responses[`${projectId}__${itemId}`]?.status
  const suggestionOf = (itemId: string): SuggestionView | null => evidence.suggestionsByItem.get(itemId) ?? null
  const decisionOf = (itemId: string): DecisionView | null => evidence.decisionsByItem.get(itemId) ?? null

  const setError = (itemId: string, message: string | null): void =>
    setErrors((prev) => {
      const { [itemId]: _dropped, ...rest } = prev
      return message === null ? rest : { ...rest, [itemId]: message }
    })

  const submit = useCallback(
    async (itemId: string, suggestionId: string, body: DecisionRequest): Promise<boolean> => {
      if (inFlight.current.has(itemId)) return false
      inFlight.current.add(itemId)
      setBusyItems((prev) => new Set(prev).add(itemId))
      setError(itemId, null)
      try {
        const unsaved = getUnsavedFindings(itemId)
        if (unsaved !== undefined) {
          try {
            await useStore.getState().saveFindings(projectId, itemId, unsaved)
          } catch (err) {
            console.error('[useResponseFlow] Could not save findings before the decision:', err)
            throw new FindingsSaveError()
          }
        }
        const { decision, answer } = await postDecision(suggestionId, body)
        const store = useStore.getState()
        store.applyServerAnswer(projectId, itemId, { status: answer.status, findings: answer.findings })
        try {
          await store.refreshAfterAnswer(projectId)
        } catch (err) {
          // The decision is saved; only the score and project status are stale until the next load.
          console.error('[useResponseFlow] Could not refresh compliance after the decision:', err)
        }
        onDecided(itemId, answer, decision.decision)
        void evidence.refresh()
        setDialog((current) => (current?.itemId === itemId ? null : current))
        return true
      } catch (err) {
        setError(itemId, messageOf(err))
        return false
      } finally {
        inFlight.current.delete(itemId)
        setBusyItems((prev) => {
          const next = new Set(prev)
          next.delete(itemId)
          return next
        })
      }
    },
    [projectId, getUnsavedFindings, onDecided, evidence],
  )

  const handleClick = async (itemId: string, clicked: ChecklistItemStatus): Promise<boolean> => {
    if (!canDecide) return false
    const suggestion = suggestionOf(itemId)
    const decision = decisionOf(itemId)
    const next = responseAction({ suggestion, decision, currentStatus: statusOf(itemId), clicked })
    if (next.action === 'save' || !next.suggestionId) return false
    if (next.action === 'accept') {
      await submit(itemId, next.suggestionId, { decision: 'accepted', origin: 'answer_button' })
      return true
    }
    setError(itemId, null)
    setDialog({
      itemId,
      suggestionId: next.suggestionId,
      origin: 'answer_button',
      suggestedResult: suggestionResultFor(next.suggestionId, suggestion, decision),
      presetResult: clicked as AnswerStatus,
    })
    return true
  }

  const accept = async (itemId: string): Promise<void> => {
    const suggestion = suggestionOf(itemId)
    if (!canDecide || !suggestion || suggestion.suggestedResult === null) return
    await submit(itemId, suggestion.id, { decision: 'accepted', origin: 'card' })
  }

  const openOverride = (itemId: string, mode: 'override' | 'keep' = 'override'): void => {
    const suggestion = suggestionOf(itemId)
    if (!canDecide || !suggestion || suggestion.suggestedResult === null) return
    const current = statusOf(itemId)
    const keep = mode === 'keep' && current !== undefined && current !== 'needs_review' && current !== 'not_started'
    setError(itemId, null)
    setDialog({
      itemId,
      suggestionId: suggestion.id,
      origin: 'card',
      suggestedResult: suggestion.suggestedResult,
      presetResult: keep ? (current as AnswerStatus) : undefined,
    })
  }

  const dialogProps: OverrideDialogProps | null = dialog
    ? {
        suggestedLabel: dialog.suggestedResult ? RESULT_LABEL[toAnswerStatus(dialog.suggestedResult)] : 'no answer',
        presetResult: dialog.presetResult,
        excludeResult: dialog.suggestedResult ? toAnswerStatus(dialog.suggestedResult) : undefined,
        busy: busyItems.has(dialog.itemId),
        error: errors[dialog.itemId] ?? null,
        onCancel: () => {
          setError(dialog.itemId, null)
          setDialog(null)
        },
        onConfirm: (finalResult, reason) =>
          void submit(dialog.itemId, dialog.suggestionId, {
            decision: 'overridden',
            origin: dialog.origin,
            finalResult,
            overrideReason: reason,
          }),
      }
    : null

  return {
    canDecide,
    handleClick,
    accept,
    openOverride,
    isBusy: (itemId) => busyItems.has(itemId),
    errorFor: (itemId) => (dialog?.itemId === itemId ? null : (errors[itemId] ?? null)),
    dialogProps,
  }
}

/** The AI result of the suggestion a decision will be posted against (it may be an older one than the card's). */
function suggestionResultFor(suggestionId: string, suggestion: SuggestionView | null, decision: DecisionView | null): SuggestedResult | null {
  if (suggestion && suggestion.id === suggestionId) return suggestion.suggestedResult
  return decision && decision.suggestionId === suggestionId ? decision.suggestedResult : null
}

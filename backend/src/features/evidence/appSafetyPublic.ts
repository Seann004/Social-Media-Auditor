/** Rule: nothing public. Anything that could publish needs a visibly private audience in its own form. */
import type { AppElement, AppView } from './appTypes.js'
import { AUDIENCE_CONTROL, FINAL_ACTION, PUBLIC_AUDIENCE, PERSON_ACTION, PUBLIC_REPLY, PUBLISH_ACTION, SAFE_NAVIGATION } from './appSafetyWords.js'
import { isAuthForm, isComposerSubmit, isDirectThread, isMediaInput, isPrivateOption, isTextBox, sameGroup, type TargetContext } from './appSafetyTargets.js'

/** Only controls that say they are the audience (or the options of one) count as proof of privacy. */
function isAudienceControl(element: AppElement): boolean {
  if (element.role === 'link') return false
  if (AUDIENCE_CONTROL.test(element.name) || AUDIENCE_CONTROL.test(element.role)) return true
  return (element.role === 'radio' || element.role === 'option') && AUDIENCE_CONTROL.test(element.contextText)
}

function selectedText(element: AppElement): string[] {
  const texts: string[] = []
  if (element.state.checked === true || element.state.selected === true) texts.push(element.name)
  if (element.role === 'combobox' && element.state.value !== undefined) texts.push(element.state.value)
  return texts
}

/** A public word on a selected control, or on any button (a button that is not pressed may still be the current audience). */
function showsPublic(element: AppElement): boolean {
  if (selectedText(element).some((text) => PUBLIC_AUDIENCE.test(text) || PUBLISH_ACTION.test(text))) return true
  return element.role === 'button' && PUBLIC_AUDIENCE.test(element.name)
}

/** True only when the control's own form, dialog or composer shows a private audience and nothing public. */
export function audienceIsPrivate(view: AppView, publish: AppElement): boolean {
  if (publish.groupId === null) return false
  const group = view.elements.filter((candidate) => candidate.groupId === publish.groupId)
  const isPrivate = group.some((candidate) => isAudienceControl(candidate) && selectedText(candidate).some(isPrivateOption))
  return isPrivate && !group.some(showsPublic)
}

export type PublishCheck = { ok: true } | { ok: false; reason: string }

/**
 * Only a name that is a person word (Send, Message, Reply) is a message to the proven test account the
 * own-accounts rule already checked, and such a name is neither a publish word nor form-ending.
 * Naming a target exempts nothing: a form-ending name always needs a private audience.
 */
export function checkPublishing(name: string, element: AppElement, view: AppView, ctx: TargetContext): PublishCheck {
  // Choosing the audience is not publishing; the control itself is always allowed.
  if (isAudienceControl(element)) return { ok: true }
  const submit = isComposerSubmit(element, view)
  if (SAFE_NAVIGATION.test(name) && !submit) return { ok: true }
  const isPrivate = audienceIsPrivate(view, element)
  if (PUBLIC_REPLY.test(name)) {
    return isPrivate || isDirectThread(element, view, ctx)
      ? { ok: true }
      : { ok: false, reason: 'A reply or comment is visible to everyone who can see the thread, and the page does not show a private audience or a direct message.' }
  }
  if (PUBLISH_ACTION.test(name)) {
    return isPrivate ? { ok: true } : { ok: false, reason: 'This could publish something, and the audience is not clearly private.' }
  }
  const final = name.trim() === '' || FINAL_ACTION.test(name) || (submit && !PERSON_ACTION.test(name))
  if (!final || isAuthForm(view, element)) return { ok: true }
  if (element.groupId === null) return { ok: false, reason: 'Cannot tell what this button submits, so it is not pressed.' }
  const mates = sameGroup(view, element)
  const composes = mates.some((other) => isTextBox(other) || isMediaInput(other))
  if (!composes || isPrivate) return { ok: true }
  return { ok: false, reason: 'This could publish what is in the form, and the audience is not clearly private.' }
}

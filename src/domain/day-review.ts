import { addDays, localDateKey } from './calendar-dates'
import { editDocument } from './workspace-immutable'
import type { Data, WorkspaceDocument } from './workspace-types'

export function isReviewDateKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

/** A review belongs to the following day's ritual, including archived daily drafts. */
export function isDayReviewed(document: WorkspaceDocument, dateKey: string): boolean {
  if (document.fields['daily.reviewedDate'] === dateKey) return true
  const history = (document.fields.ritualHistory ?? {}) as Data
  const day = history[addDays(dateKey, 1)] as Data | undefined
  const daily = day?.daily as Data | undefined
  return daily?.['daily.reviewedDate'] === dateKey
}

/** Changing a past day's review preserves tasks, navigation and ritual drafts. */
export function setDayReviewed(
  document: WorkspaceDocument,
  dateKey: string,
  reviewed: boolean,
  today = localDateKey(),
): WorkspaceDocument {
  if (document.fields.workspaceDate !== today) throw new Error('The day changed. Reopen Home.')
  if (!isReviewDateKey(dateKey) || dateKey >= today) throw new Error('Choose a past day to review.')
  if (isDayReviewed(document, dateKey) === reviewed) return document
  return editDocument(document, (draft) => {
    const history = (draft.fields.ritualHistory ?? {}) as Data
    const ritualDate = addDays(dateKey, 1)
    const day = history[ritualDate] as Data | undefined
    if (!reviewed) {
      if (draft.fields['daily.reviewedDate'] === dateKey) delete draft.fields['daily.reviewedDate']
      // Date travel can leave the same review in both the active draft and its archive.
      const daily = day?.daily as Data | undefined
      if (daily?.['daily.reviewedDate'] === dateKey) delete daily['daily.reviewedDate']
      return
    }
    if (dateKey === addDays(today, -1)) {
      draft.fields['daily.reviewedDate'] = dateKey
      return
    }
    history[ritualDate] = {
      ...day,
      daily: { ...((day?.daily ?? {}) as Data), 'daily.reviewedDate': dateKey },
    }
    draft.fields.ritualHistory = history
  })
}

export function markDayReviewed(document: WorkspaceDocument, dateKey: string, today = localDateKey()) {
  return setDayReviewed(document, dateKey, true, today)
}

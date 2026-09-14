import type { WorkspaceDocument } from './workspace-types'
import { editDocument } from './workspace-immutable'
import { localDateKey, mondayOf } from './calendar-dates'

// Completion belongs to the local day/week; reopening keeps an unfinished draft's step.
export function openPendingPlanning(document: WorkspaceDocument, today = localDateKey()): WorkspaceDocument {
  return editDocument(document, (draft) => {
    if (today === mondayOf(today) && draft.fields['weekly.completedWeek'] !== today)
      draft.fields.view = 'weekly-planning'
    else if (draft.fields['daily.completedDate'] !== today) draft.fields.view = 'planning'
  })
}
export function completeWeeklyPlanning(
  document: WorkspaceDocument,
  today = localDateKey(),
): WorkspaceDocument {
  const completed = editDocument(document, (draft) => {
    draft.fields['weekly.completedWeek'] = mondayOf(today)
    draft.fields.view = 'home'
  })
  return today === mondayOf(today) ? openPendingPlanning(completed, today) : completed
}

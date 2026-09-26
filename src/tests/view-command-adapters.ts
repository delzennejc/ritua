// Test fixtures use view-shaped data for readable scenarios. Production commands take documents.
import { normalize, project } from '../domain/workspace-projection'
import type { Fields, WorkspaceDocument } from '../domain/workspace-types'
type ViewResult<R> = R extends WorkspaceDocument
  ? Fields
  : R extends { document: WorkspaceDocument }
    ? Omit<R, 'document'> & { fields: Fields }
    : R
function inViews<A extends unknown[], R>(command: (document: WorkspaceDocument, ...args: A) => R) {
  return (fields: Fields, ...args: A): ViewResult<R> => {
    const document = normalize(fields)
    const result = command(document, ...args)
    if (result === document) return fields as ViewResult<R>
    if (result && typeof result === 'object' && 'entities' in result)
      return project(result as unknown as WorkspaceDocument) as ViewResult<R>
    if (result && typeof result === 'object' && 'document' in result) {
      const { document, ...rest } = result
      return { ...rest, fields: project(document as WorkspaceDocument) } as ViewResult<R>
    }
    return result as ViewResult<R>
  }
}
import { renameWorkspaceArea as renameWorkspaceAreaDocument } from '../domain/area-commands'
export const renameWorkspaceArea = inViews(renameWorkspaceAreaDocument)
import { colorWorkspaceArea as colorWorkspaceAreaDocument } from '../domain/area-commands'
export const colorWorkspaceArea = inViews(colorWorkspaceAreaDocument)
import { archiveWorkspaceArea as archiveWorkspaceAreaDocument } from '../domain/area-commands'
export const archiveWorkspaceArea = inViews(archiveWorkspaceAreaDocument)
import { deleteWorkspaceArea as deleteWorkspaceAreaDocument } from '../domain/area-commands'
export const deleteWorkspaceArea = inViews(deleteWorkspaceAreaDocument)
import { moveWorkspaceBacklog as moveWorkspaceBacklogDocument } from '../domain/backlog-commands'
export const moveWorkspaceBacklog = inViews(moveWorkspaceBacklogDocument)
import { moveWorkspacePanelBacklog as moveWorkspacePanelBacklogDocument } from '../domain/backlog-commands'
export const moveWorkspacePanelBacklog = inViews(moveWorkspacePanelBacklogDocument)
import { editWorkspaceCalendar as editWorkspaceCalendarDocument } from '../domain/calendar-commands'
export const editWorkspaceCalendar = inViews(editWorkspaceCalendarDocument)
import { createCalendarSession as createCalendarSessionDocument } from '../domain/calendar-sessions'
export const createCalendarSession = inViews(createCalendarSessionDocument)
import { updateCalendarSession as updateCalendarSessionDocument } from '../domain/calendar-sessions'
export const updateCalendarSession = inViews(updateCalendarSessionDocument)
import { addSessionTask as addSessionTaskDocument } from '../domain/calendar-sessions'
export const addSessionTask = inViews(addSessionTaskDocument)
import { linkSessionTask as linkSessionTaskDocument } from '../domain/calendar-sessions'
export const linkSessionTask = inViews(linkSessionTaskDocument)
import { moveSessionTask as moveSessionTaskDocument } from '../domain/calendar-sessions'
export const moveSessionTask = inViews(moveSessionTaskDocument)
import { removeCalendarSession as removeCalendarSessionDocument } from '../domain/calendar-sessions'
export const removeCalendarSession = inViews(removeCalendarSessionDocument)
import { restoreCalendarSession as restoreCalendarSessionDocument } from '../domain/calendar-sessions'
export const restoreCalendarSession = inViews(restoreCalendarSessionDocument)
import { reassignMissedTasksToToday as reassignMissedTasksToTodayDocument } from '../domain/daily-planning'
export const reassignMissedTasksToToday = inViews(reassignMissedTasksToTodayDocument)
import { openPendingPlanning as openPendingPlanningDocument } from '../domain/planning-entry'
export const openPendingPlanning = inViews(openPendingPlanningDocument)
import { completeWeeklyPlanning as completeWeeklyPlanningDocument } from '../domain/planning-entry'
export const completeWeeklyPlanning = inViews(completeWeeklyPlanningDocument)
import { removeWorkspaceProject as removeWorkspaceProjectDocument } from '../domain/project-commands'
export const removeWorkspaceProject = inViews(removeWorkspaceProjectDocument)
import { undoWorkspaceProjectRemoval as undoWorkspaceProjectRemovalDocument } from '../domain/project-commands'
export const undoWorkspaceProjectRemoval = inViews(undoWorkspaceProjectRemovalDocument)
import { editWorkspaceProject as editWorkspaceProjectDocument } from '../domain/project-commands'
export const editWorkspaceProject = inViews(editWorkspaceProjectDocument)
import { moveWorkspaceTaskArea as moveWorkspaceTaskAreaDocument } from '../domain/task-area'
export const moveWorkspaceTaskArea = inViews(moveWorkspaceTaskAreaDocument)
import { undoWorkspaceTaskArea as undoWorkspaceTaskAreaDocument } from '../domain/task-area'
export const undoWorkspaceTaskArea = inViews(undoWorkspaceTaskAreaDocument)
import { executeTaskCommand as executeTaskCommandDocument } from '../domain/task-commands'
export const executeTaskCommand = inViews(executeTaskCommandDocument)
import { toggleWorkspaceTaskCompletion as toggleWorkspaceTaskCompletionDocument } from '../domain/task-completion'
export const toggleWorkspaceTaskCompletion = inViews(toggleWorkspaceTaskCompletionDocument)
import { orderCompletionReferences as orderCompletionReferencesDocument } from '../domain/task-completion'
export const orderCompletionReferences = inViews(orderCompletionReferencesDocument)
import { createWorkspaceTasks as createWorkspaceTasksDocument } from '../domain/task-creation'
export const createWorkspaceTasks = inViews(createWorkspaceTasksDocument)
import { deleteWorkspaceTask as deleteWorkspaceTaskDocument } from '../domain/task-deletion'
export const deleteWorkspaceTask = inViews(deleteWorkspaceTaskDocument)
import { deleteWorkspaceTasks as deleteWorkspaceTasksDocument } from '../domain/task-deletion'
export const deleteWorkspaceTasks = inViews(deleteWorkspaceTasksDocument)
import { undoWorkspaceTaskDeletion as undoWorkspaceTaskDeletionDocument } from '../domain/task-deletion'
export const undoWorkspaceTaskDeletion = inViews(undoWorkspaceTaskDeletionDocument)
import { executeTaskDetailCommand as executeTaskDetailCommandDocument } from '../domain/task-detail-commands'
export const executeTaskDetailCommand = inViews(executeTaskDetailCommandDocument)
import { mutateWorkspaceTask as mutateWorkspaceTaskDocument } from '../domain/task-editing'
export const mutateWorkspaceTask = inViews(mutateWorkspaceTaskDocument)
import { updateWorkspaceTaskTiming as updateWorkspaceTaskTimingDocument } from '../domain/task-editing'
export const updateWorkspaceTaskTiming = inViews(updateWorkspaceTaskTimingDocument)
import { editWorkspaceTask as editWorkspaceTaskDocument } from '../domain/task-editing'
export const editWorkspaceTask = inViews(editWorkspaceTaskDocument)
import { changeWorkspaceRecurrence as changeWorkspaceRecurrenceDocument } from '../domain/task-recurrence'
export const changeWorkspaceRecurrence = inViews(changeWorkspaceRecurrenceDocument)
import { changeWorkspaceSessionRecurrence as changeWorkspaceSessionRecurrenceDocument } from '../domain/session-recurrence'
export const changeWorkspaceSessionRecurrence = inViews(changeWorkspaceSessionRecurrenceDocument)
import { changeWorkspaceSessionColor as changeWorkspaceSessionColorDocument } from '../domain/session-recurrence'
export const changeWorkspaceSessionColor = inViews(changeWorkspaceSessionColorDocument)
import { deleteWorkspaceSession as deleteWorkspaceSessionDocument } from '../domain/session-recurrence'
export const deleteWorkspaceSession = inViews(deleteWorkspaceSessionDocument)
import { extendSessionRecurrences as extendSessionRecurrencesDocument } from '../domain/session-recurrence'
export const extendSessionRecurrences = inViews(extendSessionRecurrencesDocument)
import { undoWorkspaceSessionDeletion as undoWorkspaceSessionDeletionDocument } from '../domain/session-recurrence'
export const undoWorkspaceSessionDeletion = inViews(undoWorkspaceSessionDeletionDocument)
import { moveScheduledTask as moveScheduledTaskDocument } from '../domain/task-scheduling'
export const moveScheduledTask = inViews(moveScheduledTaskDocument)
import { promoteWorkspaceTask as promoteWorkspaceTaskDocument } from '../domain/task-scheduling'
export const promoteWorkspaceTask = inViews(promoteWorkspaceTaskDocument)
import { moveWorkspaceTaskToBacklog as moveWorkspaceTaskToBacklogDocument } from '../domain/task-scheduling'
export const moveWorkspaceTaskToBacklog = inViews(moveWorkspaceTaskToBacklogDocument)
import { changeWorkspaceField as changeWorkspaceFieldDocument } from '../domain/workspace-commands'
export const changeWorkspaceField = inViews(changeWorkspaceFieldDocument)
import { detachInactiveReferences as detachInactiveReferencesDocument } from '../domain/workspace-organization'
export const detachInactiveReferences = inViews(detachInactiveReferencesDocument)
import { restoreInactiveReferences as restoreInactiveReferencesDocument } from '../domain/workspace-organization'
export const restoreInactiveReferences = inViews(restoreInactiveReferencesDocument)
import { restoreArea as restoreAreaDocument } from '../domain/workspace-organization'
export const restoreArea = inViews(restoreAreaDocument)
import { restoreProject as restoreProjectDocument } from '../domain/workspace-organization'
export const restoreProject = inViews(restoreProjectDocument)

import { workspaceStore, replaceWorkspaceFields } from './workspace-store'
import { toggleWorkspaceTaskCompletion } from '../../../domain/task-completion'
import { reassignMissedTasksToToday } from '../../../domain/daily-planning'
import { detachInactiveReferences, restoreInactiveReferences, restoreArea, restoreProject, type RemovedReference } from '../../../domain/workspace-organization'
export function detachInactiveTaskReferences(ids: string[]) {
  const result = detachInactiveReferences(workspaceStore.getState().fields, ids)
  replaceWorkspaceFields(result.fields)
  return result.removed
}
export function undoInactiveTaskReferences(removed: RemovedReference[]) { replaceWorkspaceFields(restoreInactiveReferences(workspaceStore.getState().fields, removed)) }
export function restoreArchivedArea(id: string) { replaceWorkspaceFields(restoreArea(workspaceStore.getState().fields, id)) }
export function restoreArchivedProject(id: string) { replaceWorkspaceFields(restoreProject(workspaceStore.getState().fields, id)) }
export function toggleTaskCompletion(taskId: string) {
  replaceWorkspaceFields(toggleWorkspaceTaskCompletion(workspaceStore.getState().fields, taskId))
}
export function carryOverMissedTasks(taskIds: string[], today: string) {
  replaceWorkspaceFields(reassignMissedTasksToToday(workspaceStore.getState().fields, taskIds, today))
}

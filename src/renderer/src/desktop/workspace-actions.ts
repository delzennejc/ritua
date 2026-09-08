import { workspaceStore, replaceWorkspaceFields } from './workspace-store'
import { detachInactiveReferences, restoreInactiveReferences, restoreArea, restoreProject, type RemovedReference } from '../../../domain/workspace-organization'
export function detachInactiveTaskReferences(ids: string[]) {
  const result = detachInactiveReferences(workspaceStore.getState().fields, ids)
  replaceWorkspaceFields(result.fields)
  return result.removed
}
export function undoInactiveTaskReferences(removed: RemovedReference[]) { replaceWorkspaceFields(restoreInactiveReferences(workspaceStore.getState().fields, removed)) }
export function restoreArchivedArea(id: string) { replaceWorkspaceFields(restoreArea(workspaceStore.getState().fields, id)) }
export function restoreArchivedProject(id: string) { replaceWorkspaceFields(restoreProject(workspaceStore.getState().fields, id)) }

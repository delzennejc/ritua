import { moveTaskToTodayBoard, type TodayBoardStatus } from '../../../domain/today-board'
import {
  createTodayStatusUndo,
  undoTodayStatus,
  type TodayStatusUndo,
} from '../../../domain/today-board-undo'
import { getWorkspaceDocument, replaceWorkspaceDocument } from './workspace-store'
import { reportActionError } from './ActionErrors'

export type TodayStatusUndoNotice = { id: number; taskId: string; message: string; undo: TodayStatusUndo }
let notice: TodayStatusUndoNotice | null = null
let serial = 0
const listeners = new Set<() => void>()
const publish = () => listeners.forEach((listener) => listener())

export function subscribeTodayStatusUndo(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function getTodayStatusUndo() {
  return notice
}
export function dismissTodayStatusUndo(id?: number) {
  if (id !== undefined && notice?.id !== id) return
  notice = null
  publish()
}
export function undoTodayStatusAction(id?: number) {
  const current = notice
  if (!current || (id !== undefined && id !== current.id)) return false
  const before = getWorkspaceDocument()
  const after = undoTodayStatus(before, current.undo)
  if (after === before) {
    dismissTodayStatusUndo(current.id)
    reportActionError('This status change can no longer be undone because the task or its schedule changed.')
    return false
  }
  replaceWorkspaceDocument(after)
  dismissTodayStatusUndo(current.id)
  return true
}

/** Updates canonical status while preserving scheduling and session references. */
export function changeTodayTaskStatus(taskId: string, status: TodayBoardStatus) {
  const before = getWorkspaceDocument()
  const after = moveTaskToTodayBoard(before, taskId, status)
  if (after === before) return false
  const undo = createTodayStatusUndo(before, after, taskId)
  replaceWorkspaceDocument(after)
  if (!undo.patches.length) return false
  const label =
    status === 'todo'
      ? 'Todo'
      : status === 'in-progress'
        ? 'In Progress'
        : status === 'to-review'
          ? 'To Review'
          : 'Done'
  notice = { id: ++serial, taskId, message: `Moved to ${label}.`, undo }
  publish()
  return true
}

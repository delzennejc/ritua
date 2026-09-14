import { restoreBoardOrder, restoreBacklogOrder } from '../../../domain/workspace-gesture'
import type { RemovedReference } from '../../../domain/workspace-organization'
import {
  getWorkspaceDocument,
  getWorkspaceFields,
  replaceWorkspaceDocument,
  selectWorkspaceFields,
} from './workspace-store'
import { toggleWorkspaceTaskCompletion } from '../../../domain/task-completion'
import { reassignMissedTasksToToday } from '../../../domain/daily-planning'
import {
  detachInactiveReferences,
  restoreInactiveReferences,
  restoreArea,
  restoreProject,
} from '../../../domain/workspace-organization'
import { executeTaskCommand, type TaskCommand } from '../../../domain/task-commands'
import { profileActor } from './profile-actor'
import { localDateKey } from '../../../domain/calendar-dates'
import { editWorkspaceCalendar } from '../../../domain/calendar-commands'
import type { CalendarEvent } from '../../../domain/models'
import { workspaceCollections } from '../../../domain/workspace-collections'
import { moveWorkspaceBacklog, moveWorkspacePanelBacklog } from '../../../domain/backlog-commands'
import { executeTaskDetailCommand, type TaskDetailCommand } from '../../../domain/task-detail-commands'
import { createWorkspaceTasks, type CreateTaskRequest } from '../../../domain/task-creation'
import {
  promoteWorkspaceTask,
  moveWorkspaceTaskToBacklog,
  type PromoteTask,
  type BacklogDestination,
} from '../../../domain/task-scheduling'
export function detachInactiveTaskReferences(ids: string[]) {
  const result = detachInactiveReferences(getWorkspaceDocument(), ids)
  replaceWorkspaceDocument(result.document)
  return result.removed
}
export function undoInactiveTaskReferences(removed: RemovedReference[]) {
  replaceWorkspaceDocument(restoreInactiveReferences(getWorkspaceDocument(), removed))
}
export function restoreArchivedArea(id: string) {
  replaceWorkspaceDocument(restoreArea(getWorkspaceDocument(), id))
}
export function restoreArchivedProject(id: string) {
  replaceWorkspaceDocument(restoreProject(getWorkspaceDocument(), id))
}
export function toggleTaskCompletion(taskId: string) {
  replaceWorkspaceDocument(toggleWorkspaceTaskCompletion(getWorkspaceDocument(), taskId))
}
export function carryOverMissedTasks(taskIds: string[], today: string) {
  replaceWorkspaceDocument(reassignMissedTasksToToday(getWorkspaceDocument(), taskIds, today))
}

export function dispatchTaskCommand(command: TaskCommand) {
  const now = new Date()
  const fields = executeTaskCommand(getWorkspaceDocument(), command, {
    now,
    today: localDateKey(now),
    actor: profileActor(),
  })
  replaceWorkspaceDocument(fields)
  return selectWorkspaceFields(fields)
}
export function toggleTaskSubtask(taskId: string, subtaskId: string) {
  dispatchTaskCommand({ type: 'task.subtask.toggle', taskId, subtaskId })
}

export function updateCalendarEvents(
  update: CalendarEvent[] | ((events: CalendarEvent[]) => CalendarEvent[]),
) {
  const current = getWorkspaceDocument()
  replaceWorkspaceDocument(
    editWorkspaceCalendar(
      current,
      typeof update === 'function' ? update(workspaceCollections(getWorkspaceFields()).events) : update,
    ),
  )
}
export function restoreBoardLocations(
  snapshot: Pick<ReturnType<typeof workspaceCollections>, 'tasks' | 'datedTasksByDate'>,
) {
  replaceWorkspaceDocument(restoreBoardOrder(getWorkspaceDocument(), snapshot))
}
export function restoreBacklogCollections(snapshot: {
  groups: ReturnType<typeof workspaceCollections>['backlogGroups']
  objectives: ReturnType<typeof workspaceCollections>['weeklyObjectives']
}) {
  replaceWorkspaceDocument(restoreBacklogOrder(getWorkspaceDocument(), snapshot))
}

export function moveBacklogContext(move: Parameters<typeof moveWorkspaceBacklog>[1]) {
  const fields = moveWorkspaceBacklog(getWorkspaceDocument(), move)
  replaceWorkspaceDocument(fields)
  return workspaceCollections(selectWorkspaceFields(fields))
}
export function movePanelBacklog(
  move: Parameters<typeof moveWorkspacePanelBacklog>[1],
  unavailableTaskIds: string[],
  originTask?: Parameters<typeof moveWorkspacePanelBacklog>[3],
) {
  const fields = moveWorkspacePanelBacklog(getWorkspaceDocument(), move, unavailableTaskIds, originTask)
  replaceWorkspaceDocument(fields)
  return workspaceCollections(selectWorkspaceFields(fields))
}

export function dispatchTaskDetailCommand(command: TaskDetailCommand) {
  const now = new Date()
  const fields = executeTaskDetailCommand(getWorkspaceDocument(), command, {
    now,
    today: localDateKey(now),
    actor: profileActor(),
  })
  replaceWorkspaceDocument(fields)
  return selectWorkspaceFields(fields)
}

export function createTasks(request: CreateTaskRequest) {
  const now = new Date()
  const result = createWorkspaceTasks(getWorkspaceDocument(), request, {
    now,
    today: localDateKey(now),
    actor: profileActor(),
  })
  replaceWorkspaceDocument(result.document)
  return result
}

export function promoteTask(request: PromoteTask) {
  const now = new Date()
  const fields = promoteWorkspaceTask(getWorkspaceDocument(), request, {
    now,
    today: localDateKey(now),
    actor: profileActor(),
  })
  replaceWorkspaceDocument(fields)
  return workspaceCollections(selectWorkspaceFields(fields))
}
export function moveTaskToBacklogList(request: BacklogDestination) {
  const now = new Date()
  const fields = moveWorkspaceTaskToBacklog(getWorkspaceDocument(), request, {
    now,
    today: localDateKey(now),
    actor: profileActor(),
  })
  replaceWorkspaceDocument(fields)
  return workspaceCollections(selectWorkspaceFields(fields))
}

import { restoreBoardOrder, restoreBacklogOrder } from '../../../domain/workspace-gesture'
import type { RemovedReference } from '../../../domain/workspace-organization'
import {
  getWorkspaceDocument,
  getWorkspaceFields,
  queueBulkWorkspaceUpdate,
  queueRecurringTaskUpdate,
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
import {
  executeTaskCommand,
  validateWorkspaceTaskAssignments,
  type TaskCommand,
} from '../../../domain/task-commands'
import { profileActor } from './profile-actor'
import { localDateKey } from '../../../domain/calendar-dates'
import { editWorkspaceCalendar } from '../../../domain/calendar-commands'
import { activityContext } from './activity-context'
import type { CalendarEvent } from '../../../domain/models'
import { workspaceCollections } from '../../../domain/workspace-collections'
import { moveWorkspaceBacklog, moveWorkspacePanelBacklog } from '../../../domain/backlog-commands'
import { executeTaskDetailCommand, type TaskDetailCommand } from '../../../domain/task-detail-commands'
import { selectTask } from '../../../domain/workspace-selectors'
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
  const context = {
    now,
    today: localDateKey(now),
    actor: profileActor(),
    deferSessionPropagation: true,
  }
  const document = getWorkspaceDocument()
  if (command.type === 'task.assign-many' && new Set(command.taskIds).size > 12) {
    const ids = [...new Set(command.taskIds)]
    validateWorkspaceTaskAssignments(document, ids, command.projectId)
    const [first, ...remaining] = ids
    const expected = Object.fromEntries(
      remaining.map((id) => {
        const task = selectTask(document, id)!
        return [id, { objectiveId: task.objectiveId, channel: task.channel }]
      }),
    )
    const fields = executeTaskCommand(document, { ...command, taskIds: [first!] }, context)
    replaceWorkspaceDocument(fields)
    const firstTask = selectTask(fields, first!)
    if (firstTask) queueRecurringTaskUpdate(first!, { objectiveId: firstTask.objectiveId })
    queueBulkWorkspaceUpdate(`task-assign-many:${crypto.randomUUID()}`, {
      type: 'task-assign-many',
      taskIds: remaining,
      projectId: command.projectId,
      expected,
      context: { actor: context.actor, today: context.today, now: now.toISOString() },
    })
    return selectWorkspaceFields(fields)
  }
  const fields = executeTaskCommand(document, command, context)
  replaceWorkspaceDocument(fields)
  if (command.type === 'task.assign' || command.type === 'task.assign-many') {
    const ids = command.type === 'task.assign' ? [command.taskId] : command.taskIds
    for (const taskId of new Set(ids)) {
      const task = selectTask(fields, taskId)
      if (task)
        queueRecurringTaskUpdate(taskId, {
          objectiveId: task.objectiveId,
          ...(command.type === 'task.assign' && command.channel ? { channel: task.channel } : {}),
        })
    }
  }
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
      activityContext(),
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
    deferSessionPropagation: true,
  })
  replaceWorkspaceDocument(fields)
  if (
    command.type === 'subtask.edit' ||
    command.type === 'subtask.add' ||
    command.type === 'subtask.reorder'
  ) {
    const task = selectTask(fields, command.taskId)
    if (task) queueRecurringTaskUpdate(task.id, { subtasks: task.subtasks })
  }
  return selectWorkspaceFields(fields)
}

export function createTasks(request: CreateTaskRequest) {
  const now = new Date()
  const context = {
    now,
    today: localDateKey(now),
    actor: profileActor(),
  }
  const deferred = request.recurrence && request.recurrence.frequency !== 'none'
  const result = createWorkspaceTasks(getWorkspaceDocument(), request, context, {
    firstOnly: Boolean(deferred),
  })
  replaceWorkspaceDocument(result.document)
  if (deferred && result.firstTaskId)
    queueBulkWorkspaceUpdate(`task-create-following:${request.seriesId}`, {
      type: 'task-create-following',
      request,
      firstTaskId: result.firstTaskId,
      context: { actor: context.actor, today: context.today, now: now.toISOString() },
    })
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

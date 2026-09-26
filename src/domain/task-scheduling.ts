import type { Task } from './models'
import { workspaceCollections } from './workspace-collections'
import { createWorkspaceView, applyWorkspaceView } from './workspace-view'
import type { WorkspaceDocument } from './workspace-types'
const selectView = createWorkspaceView()
import { selectTask } from './workspace-selectors'
import { executeTaskCommand, type ActionContext } from './task-commands'
import { taskActivity } from './task-activity'
import { syncedDurationLabel } from './task-editing'
import { timeLabel } from './time-format'
import { commitBoardSessionOrder } from './session-board-order'
type BoardState = { tasks: Task[]; datedTasksByDate: Record<string, Task[]> }
export type BoardMove = BoardState & {
  taskId: string
  sourceDateKey: string
  targetDateKey: string
  targetIndex?: number
  visibleTaskIds?: string[]
}
const clampInsertionIndex = (index: number | undefined, length: number) =>
  Math.max(0, Math.min(length, Number.isFinite(index) ? index! : length))

const reorderVisibleSlots = (
  dateTasks: Task[],
  taskId: string,
  visibleTaskIds: string[],
  targetIndex?: number,
) => {
  const visibleIdSet = new Set(visibleTaskIds)
  const visibleSlots: number[] = []
  const visibleTasks: Task[] = []

  dateTasks.forEach((task, index) => {
    if (!visibleIdSet.has(task.id)) return
    visibleSlots.push(index)
    visibleTasks.push(task)
  })

  const sourceIndex = visibleTasks.findIndex((task) => task.id === taskId)
  if (sourceIndex === -1) return { dateTasks, moved: false }

  const movedTask = visibleTasks[sourceIndex]
  const remainingVisibleTasks = visibleTasks.filter((task) => task.id !== taskId)
  const insertionIndex = clampInsertionIndex(targetIndex, remainingVisibleTasks.length)

  if (sourceIndex === insertionIndex) {
    return { dateTasks, movedTask, moved: false }
  }

  const reorderedVisibleTasks = [
    ...remainingVisibleTasks.slice(0, insertionIndex),
    movedTask,
    ...remainingVisibleTasks.slice(insertionIndex),
  ]
  const reorderedTasks = [...dateTasks]
  visibleSlots.forEach((slot, index) => {
    reorderedTasks[slot] = reorderedVisibleTasks[index]
  })

  return { dateTasks: reorderedTasks, movedTask, moved: true }
}

export function moveTaskBetweenDates(
  { tasks, datedTasksByDate, taskId, sourceDateKey, targetDateKey, targetIndex, visibleTaskIds }: BoardMove,
  today: string,
) {
  const tasksForDate = (tasks: Task[], datedTasksByDate: Record<string, Task[]>, dateKey: string) =>
    dateKey === today ? tasks : datedTasksByDate[dateKey] || []

  const withTasksForDate = (state: BoardState, dateKey: string, dateTasks: Task[]) => {
    if (dateKey === today) {
      return { ...state, tasks: dateTasks }
    }

    return {
      ...state,
      datedTasksByDate: {
        ...state.datedTasksByDate,
        [dateKey]: dateTasks,
      },
    }
  }

  const sourceTasks = tasksForDate(tasks, datedTasksByDate, sourceDateKey)
  const sourceIndex = sourceTasks.findIndex((task) => task.id === taskId)

  if (sourceIndex === -1 || !targetDateKey) {
    return { tasks, datedTasksByDate, moved: false }
  }

  const movedTask = sourceTasks[sourceIndex]
  const remainingSourceTasks = sourceTasks.filter((task) => task.id !== taskId)

  if (sourceDateKey === targetDateKey) {
    if (visibleTaskIds?.length) {
      const visibleResult = reorderVisibleSlots(sourceTasks, taskId, visibleTaskIds, targetIndex)

      if (!visibleResult.moved) {
        return {
          tasks,
          datedTasksByDate,
          movedTask: visibleResult.movedTask,
          moved: false,
        }
      }

      const nextState = withTasksForDate({ tasks, datedTasksByDate }, sourceDateKey, visibleResult.dateTasks)
      return { ...nextState, movedTask: visibleResult.movedTask, moved: true }
    }

    const insertionIndex = clampInsertionIndex(targetIndex, remainingSourceTasks.length)
    const reorderedTasks = [
      ...remainingSourceTasks.slice(0, insertionIndex),
      movedTask,
      ...remainingSourceTasks.slice(insertionIndex),
    ]
    const nextState = withTasksForDate({ tasks, datedTasksByDate }, sourceDateKey, reorderedTasks)

    return { ...nextState, movedTask, moved: sourceIndex !== insertionIndex }
  }

  const targetTasks = tasksForDate(tasks, datedTasksByDate, targetDateKey).filter(
    (task) => task.id !== taskId,
  )
  const insertionIndex = clampInsertionIndex(targetIndex, targetTasks.length)
  const nextTargetTasks = [
    ...targetTasks.slice(0, insertionIndex),
    movedTask,
    ...targetTasks.slice(insertionIndex),
  ]
  const withoutSource = withTasksForDate({ tasks, datedTasksByDate }, sourceDateKey, remainingSourceTasks)
  const nextState = withTasksForDate(withoutSource, targetDateKey, nextTargetTasks)

  return { ...nextState, movedTask, moved: true }
}

export function moveScheduledTask(
  document: WorkspaceDocument,
  move: Omit<BoardMove, keyof BoardState> & { syncEventDate?: boolean },
  today: string,
) {
  const current = workspaceCollections(selectView(document))
  const result = moveTaskBetweenDates(
    { tasks: current.tasks, datedTasksByDate: current.datedTasksByDate, ...move },
    today,
  )
  if (!result.moved) return { document, moved: false }
  const events =
    move.syncEventDate === false
      ? current.events
      : current.events.map((event) =>
          ('taskId' in event ? (event.taskId ?? event.id) : event.id) === move.taskId &&
          (event.dateKey ?? today) === move.sourceDateKey
            ? { ...event, dateKey: move.targetDateKey }
            : event,
        )
  const next = applyWorkspaceView(document, {
    ...current,
    tasks: result.tasks,
    datedTasksByDate: result.datedTasksByDate,
    events,
  })
  return {
    document:
      move.syncEventDate === false ? next : commitBoardSessionOrder(next, move.taskId, move.sourceDateKey),
    moved: true,
  }
}

export type PromoteTask = {
  taskId: string
  dateKey: string
  targetIndex?: number
  start?: number
  end?: number
  accent: string
  destination?: { channel?: string; objectiveId?: string | null }
}
export function promoteWorkspaceTask(
  document: WorkspaceDocument,
  request: PromoteTask,
  context: ActionContext,
): WorkspaceDocument {
  const source = selectTask(document, request.taskId)
  if (!source || !request.dateKey) return document
  const timed = Number.isFinite(request.start) && Number.isFinite(request.end)
  const minutes = timed ? request.end! - request.start! : Math.max(source.minutes || 0, 30)
  const task = {
    ...source,
    minutes,
    accent: request.accent,
    time: source.time || null,
    ...(request.destination?.channel ? { channel: request.destination.channel } : {}),
    ...(timed
      ? { time: timeLabel(request.start!), durationLabel: syncedDurationLabel(source, minutes) }
      : {}),
  }
  return executeTaskCommand(
    document,
    {
      type: 'task.move',
      taskId: source.id,
      lane: request.dateKey === context.today ? 'today' : `date:${request.dateKey}`,
      index: request.targetIndex,
      preparedTask: task,
      ...(request.destination ? { projectId: request.destination.objectiveId || null } : {}),
      ...(timed
        ? {
            schedule: { dateKey: request.dateKey, start: request.start!, end: request.end! },
            activity: taskActivity(context, 'schedule', 'updated the schedule'),
          }
        : {}),
    },
    context,
  )
}
export type BacklogDestination = {
  taskId: string
  groupLabel: string
  referenceTaskId?: string
  after?: boolean
  channel?: string
  projectId?: string | null
}
export function moveWorkspaceTaskToBacklog(
  document: WorkspaceDocument,
  request: BacklogDestination,
  context: ActionContext,
): WorkspaceDocument {
  const current = workspaceCollections(selectView(document))
  const group = current.backlogGroups.find((item) => item.label === request.groupLabel)
  if (!group) return document
  const remaining = group.items.filter((item) => item.id !== request.taskId)
  const reference = remaining.findIndex((item) => item.id === request.referenceTaskId)
  return executeTaskCommand(
    document,
    {
      type: 'task.move',
      taskId: request.taskId,
      lane: `backlog:${group.id}`,
      index: reference < 0 ? remaining.length : reference + (request.after ? 1 : 0),
      channel: request.channel,
      ...(request.projectId !== undefined ? { projectId: request.projectId } : {}),
      activity: taskActivity(context, 'backlog', `moved this to ${request.groupLabel}`),
    },
    context,
  )
}

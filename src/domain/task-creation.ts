import type { Recurrence } from './models'
import type { WorkspaceDocument } from './workspace'
import { executeTaskCommand, type ActionContext } from './task-commands'
import { recurrenceDateKeys } from './recurrence'
import { addDays } from './calendar-dates'
import { moveTaskToTodayBoard, type TodayBoardStatus } from './today-board'
export type CreateTaskRequest = {
  seriesId: string
  area: string
  accent: string
  dateKey: string
  minutes: number
  objectiveId?: string
  recurrence?: Recurrence
  title: string
  schedule?: { start: number; end: number }
  prepend?: boolean
  todayStatus?: TodayBoardStatus
}
export function createWorkspaceTasks(
  document: WorkspaceDocument,
  request: CreateTaskRequest,
  context: ActionContext,
  options: { firstOnly?: boolean; skipExisting?: boolean } = {},
) {
  const dates = recurrenceDateKeys(
    request.dateKey,
    request.recurrence,
    addDays(request.dateKey > context.today ? request.dateKey : context.today, 365),
  )
  const recurring =
    dates.length > 1 || Boolean(request.recurrence?.frequency && request.recurrence.frequency !== 'none')
  const existingIds = options.skipExisting
    ? new Set(document.entities.filter((entity) => entity.kind === 'task').map((entity) => entity.id))
    : new Set<string>()
  const occurrences = (options.firstOnly ? dates.slice(0, 1) : dates).map((date, index) => ({
    date,
    lane: date === context.today ? ('today' as const) : (`date:${date}` as const),
    task: {
      id: recurring ? `${request.seriesId}-${index + 1}` : request.seriesId,
      title: request.title,
      minutes: request.minutes,
      time: null,
      channel: request.area,
      complete: false,
      accent: request.accent,
      ...(request.objectiveId ? { objectiveId: request.objectiveId } : {}),
      ...(recurring
        ? {
            recurrence: request.recurrence,
            recurrenceIndex: index,
            recurrenceSeriesId: request.seriesId,
            recurrenceStartDateKey: request.dateKey,
          }
        : {}),
    },
  }))
  const tasks = occurrences.filter(({ task }) => !existingIds.has(task.id))
  let next = executeTaskCommand(
    document,
    {
      type: 'task.create',
      tasks,
      placement: request.prepend ? 'first' : 'before-completed',
      referencePrefix: 'objective',
    },
    context,
  )
  if (request.schedule) {
    for (const { date, task } of tasks) {
      next = executeTaskCommand(
        next,
        { type: 'task.schedule', taskId: task.id, dateKey: date, ...request.schedule },
        context,
      )
    }
  }
  if (request.todayStatus && tasks[0]) {
    next = moveTaskToTodayBoard(next, tasks[0].task.id, request.todayStatus, context.now)
  }
  return {
    document: next,
    recurring,
    firstTaskId: occurrences[0]?.task.id,
  }
}

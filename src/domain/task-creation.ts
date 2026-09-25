import type { Recurrence } from './models'
import type { WorkspaceDocument } from './workspace'
import { executeTaskCommand, type ActionContext } from './task-commands'
import { recurrenceDateKeys } from './recurrence'
import { addDays } from './calendar-dates'
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
}
export function createWorkspaceTasks(
  document: WorkspaceDocument,
  request: CreateTaskRequest,
  context: ActionContext,
) {
  const dates = recurrenceDateKeys(
    request.dateKey,
    request.recurrence,
    addDays(request.dateKey > context.today ? request.dateKey : context.today, 365),
  )
  const recurring =
    dates.length > 1 || Boolean(request.recurrence?.frequency && request.recurrence.frequency !== 'none')
  const tasks = dates.map((date, index) => ({
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
    for (const [index, { task }] of tasks.entries()) {
      next = executeTaskCommand(
        next,
        { type: 'task.schedule', taskId: task.id, dateKey: dates[index]!, ...request.schedule },
        context,
      )
    }
  }
  return {
    document: next,
    recurring,
    firstTaskId: tasks[0]?.task.id,
  }
}

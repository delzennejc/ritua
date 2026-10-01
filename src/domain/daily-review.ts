import { addDays, dateFromKey, localDateKey } from './calendar-dates'
import { taskContent, selectTask } from './workspace-selectors'
import { toggleWorkspaceTaskCompletion } from './task-completion'
import { moveWorkspaceTaskArea } from './task-area'
import { editDocument } from './workspace-immutable'
import { pushTaskActivity, type ActivityContext } from './task-activity'
import type { Data, WorkspaceDocument } from './workspace-types'
import type { CalendarEvent } from './models'
import { taskTimeTotals } from './task-time'
import { isDayReviewed, markDayReviewed } from './day-review'

export function dailyReviewCompleted(document: WorkspaceDocument, today = localDateKey()): boolean {
  return isDayReviewed(document, addDays(today, -1))
}

/** Review completion and its handoff save together; revisiting never clears completion. */
export function completeDailyReview(document: WorkspaceDocument, today = localDateKey()): WorkspaceDocument {
  if (document.fields.workspaceDate !== today) throw new Error('The day changed. Reopen Daily planning.')
  return editDocument(markDayReviewed(document, addDays(today, -1), today), (draft) => {
    draft.fields.planningStep = 1
  })
}

/** Date-scoped reporting includes session members even when their cards live elsewhere. */
export function dailyReviewTimeData(document: WorkspaceDocument, today = localDateKey()) {
  const yesterday = addDays(today, -1)
  const events = document.entities
    .filter((entity) => entity.kind === 'event')
    .map((entity) => entity.data.content as CalendarEvent)
  const sessionTaskIds = new Set(
    events.flatMap((event) => (event.kind === 'session' && event.dateKey === yesterday ? event.taskIds : [])),
  )
  const tasks = document.entities
    .filter((entity) => {
      if (entity.kind !== 'task') return false
      const task = taskContent(entity)
      return (
        sessionTaskIds.has(task.id) ||
        (task.complete ? task.completedDateKey === yesterday : entity.data.lane === `date:${yesterday}`)
      )
    })
    .map(taskContent)
  return { tasks, events, dateKeys: [yesterday] }
}

/** Six months ending yesterday, omitting the oldest week when it is only partially in range. */
export function dailyReviewActivity(document: WorkspaceDocument, today = localDateKey()) {
  const end = dateFromKey(today)
  const start = new Date(end.getFullYear(), end.getMonth() - 6, 1)
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  start.setDate(Math.min(end.getDate(), lastDay))
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7))
  const dates: string[] = []
  for (let key = localDateKey(start); key < today; key = addDays(key, 1)) dates.push(key)
  return dates.map((dateKey) => {
    const { tasks, events, dateKeys } = dailyReviewTimeData(document, addDays(dateKey, 1))
    const activeTasks = tasks.filter(
      (task) =>
        (task.complete && task.completedDateKey === dateKey) ||
        taskTimeTotals([task], events, { dateKeys, includeEmptySessions: false }).actual > 0,
    )
    const taskCount = activeTasks.length
    const areaBreakdown: { area: string | null; taskCount: number; minutes: number }[] = []
    let mostLoggedArea: string | null = null
    let mostLoggedMinutes = 0
    for (const channel of [...new Set(tasks.map((task) => task.channel))].sort()) {
      const minutes = taskTimeTotals(
        tasks.filter((task) => task.channel === channel),
        events,
        {
          dateKeys,
          includeEmptySessions: false,
        },
      ).actual
      const count = activeTasks.filter((task) => task.channel === channel).length
      if (count || minutes) areaBreakdown.push({ area: channel || null, taskCount: count, minutes })
      if (channel && minutes > mostLoggedMinutes) {
        mostLoggedArea = channel
        mostLoggedMinutes = minutes
      }
    }
    const unassignedMinutes = taskTimeTotals([], events, { dateKeys }).actual
    if (unassignedMinutes) {
      const unassigned = areaBreakdown.find((entry) => entry.area === null)
      if (unassigned) unassigned.minutes += unassignedMinutes
      else areaBreakdown.push({ area: null, taskCount: 0, minutes: unassignedMinutes })
    }
    areaBreakdown.sort((a, b) => b.minutes - a.minutes || (a.area || '').localeCompare(b.area || ''))
    return {
      dateKey,
      taskCount,
      minutes: taskTimeTotals(tasks, events, { dateKeys }).actual,
      mostLoggedArea,
      areaBreakdown,
    }
  })
}

/** Include unfinished work so the review can correct yesterday's record. */
export function dailyReviewTasks(document: WorkspaceDocument, today = localDateKey()) {
  const yesterday = addDays(today, -1)
  const order = (document.fields['daily.reviewOrder'] ?? []) as string[]
  const ranks = new Map(order.map((id, index) => [id, index]))
  return document.entities
    .filter((e) => {
      if (e.kind !== 'task') return false
      const task = taskContent(e)
      return task.complete
        ? task.completedDateKey === yesterday
        : e.data.lane === `date:${yesterday}` || ranks.has(e.id)
    })
    .sort(
      (a, b) =>
        (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
        Number(a.data.position) - Number(b.data.position),
    )
    .map(taskContent)
}

export type DailyReviewMove = {
  taskId: string
  areaId?: string
  accent?: string
  complete: boolean
  beforeTaskId?: string
  unlinkFromProject?: boolean
}

/** One atomic review correction; a visual area/status lane never reschedules a task. */
export function changeDailyReviewTask(
  input: WorkspaceDocument,
  move: DailyReviewMove,
  context: ActivityContext,
): WorkspaceDocument {
  const today = localDateKey(context.now)
  if (input.fields.workspaceDate !== today) throw new Error('The day changed. Reopen Daily planning.')
  const review = dailyReviewTasks(input, today)
  const original = review.find((task) => task.id === move.taskId)
  if (!original) throw new Error('This task is no longer in yesterday’s review.')
  let next = input
  if (move.areaId) {
    const area = input.entities.find((e) => e.kind === 'area' && e.id === move.areaId)?.data.content as
      | Data
      | undefined
    if (!area) throw new Error('This area no longer exists.')
    if (original.channel !== area.label) {
      const moved = moveWorkspaceTaskArea(
        next,
        move.taskId,
        String(area.label),
        String(move.accent || area.accent || 'violet'),
        Boolean(move.unlinkFromProject),
        context,
      )
      if (!moved) throw new Error('Confirm removing this task from its project before changing its area.')
      next = moved.document
    }
  }
  if (original.complete !== move.complete)
    next = toggleWorkspaceTaskCompletion(next, move.taskId, context.now, {
      completedDateKey: addDays(today, -1),
    })
  return editDocument(next, (document) => {
    const order = review.filter((t) => t.id !== move.taskId).map((t) => t.id)
    const index =
      move.complete && !original.complete ? 0 : move.beforeTaskId ? order.indexOf(move.beforeTaskId) : -1
    order.splice(index < 0 ? order.length : index, 0, move.taskId)
    document.fields['daily.reviewOrder'] = order
    if (original.complete !== move.complete)
      pushTaskActivity(
        selectTask(document, move.taskId)!,
        context,
        'completion',
        move.complete ? 'marked this complete for yesterday' : 'reopened this task',
      )
  })
}

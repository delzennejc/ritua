import { calendarTaskId } from './task-calendar'
import { collectionCommand } from './workspace-collection-command'
import type { WorkspaceDocument } from './workspace-types'
import type { Task } from './models'
import type { Fields } from './workspace-types'
import type { Recurrence } from './models'
import type { ScheduledTaskEvent } from './models'

import { workspaceCollections } from './workspace-collections'
import { addDays } from './calendar-dates'
import { recurrenceDateKeys } from './recurrence'
import { freshOccurrence } from './recurring-workspace'
import { taskFromJson } from './workspace-selectors'
import { insertBeforeCompletedTasks, orderTasksByTime } from './tasks'

type Occurrence = { dateKey: string; task: Task }
function singleTask(task: Task): Task {
  const result = { ...task }
  delete result.recurrence
  delete result.recurrenceIndex
  delete result.recurrenceSeriesId
  delete result.recurrenceStartDateKey
  return result
}

/** Replace future occurrences as one edit, preserving completed history and individually edited work. */
function changeWorkspaceRecurrenceView(
  fields: Fields,
  taskId: string,
  recurrence: Recurrence,
  context: {
    today: string
    seriesId: string
    prepareTask(task: Task): Task
  },
) {
  let next = workspaceCollections(fields)
  const { today, seriesId } = context
  const entries: Occurrence[] = [
    ...next.tasks.map((task) => ({ dateKey: today, task })),
    ...Object.entries(next.datedTasksByDate).flatMap(([dateKey, tasks]) =>
      tasks.map((task) => ({ dateKey, task })),
    ),
  ]
  const selected = entries.find((entry) => entry.task.id === taskId) ?? {
    dateKey: today,
    task: next.backlogGroups.flatMap((group) => group.items).find((task) => task.id === taskId),
  }
  if (!selected.task) return { fields, activeTaskId: undefined }
  const selectedTask = selected.task,
    oldSeries = selectedTask.recurrenceSeriesId
  const start = selected.dateKey < today ? today : selected.dateKey
  const belongs = (task: Task) => (oldSeries ? task.recurrenceSeriesId === oldSeries : task.id === taskId)
  const future = entries.filter(
    (entry) => belongs(entry.task) && entry.dateKey >= start && !entry.task.complete,
  )
  const recurring = recurrence.frequency !== 'none'
  const dates = recurring
    ? recurrenceDateKeys(start, recurrence, addDays(start, 365))
    : selected.dateKey >= today && !selectedTask.complete
      ? [selected.dateKey]
      : []
  const template = singleTask(context.prepareTask(selectedTask))
  const reused = new Set<string>()
  const occurrences: Occurrence[] = []
  dates.forEach((dateKey, index) => {
    if (entries.some((entry) => entry.dateKey === dateKey && entry.task.complete && belongs(entry.task)))
      return
    const existing = future.find((entry) => entry.dateKey === dateKey && !reused.has(entry.task.id))
    if (existing) reused.add(existing.task.id)
    const task = existing ? singleTask(existing.task) : taskFromJson(freshOccurrence(template))
    occurrences.push({
      dateKey,
      task: {
        ...task,
        id: existing?.task.id ?? `${seriesId}-date-${dateKey}`,
        ...(recurring
          ? {
              recurrence,
              recurrenceSeriesId: seriesId,
              recurrenceStartDateKey: start,
              recurrenceIndex: index,
            }
          : {}),
      },
    })
  })
  const workFields = ['title', 'minutes', 'time', 'channel', 'objectiveId', 'subtasks'] as const
  const hasWork = (task: Task) =>
    task.recurrenceEdited ||
    workFields.some((key) => JSON.stringify(task[key]) !== JSON.stringify(template[key])) ||
    task.notes ||
    task.media?.length ||
    task.comments?.length ||
    task.actualMinutes ||
    task.activity?.length ||
    task.subtasks?.some((item) => item.complete)
  for (const entry of future)
    if (!reused.has(entry.task.id) && hasWork(entry.task))
      occurrences.push({ ...entry, task: singleTask(entry.task) })
  const removed = new Set(future.map((entry) => entry.task.id))
  if (!entries.some((entry) => entry.task.id === taskId)) removed.add(taskId)
  const retained = new Set(occurrences.map((entry) => entry.task.id))
  const originalEvents = new Map<string, ScheduledTaskEvent>()
  for (const event of next.events) {
    const id = calendarTaskId(event)
    if (id && !originalEvents.has(id)) originalEvents.set(id, event as ScheduledTaskEvent)
  }
  const deleted = new Set([...removed].filter((id) => !retained.has(id)))
  for (const collection of ['archivedObjectives', 'weekly.accomplishedObjectives'])
    for (const project of (next[collection] ?? []) as import('./workspace-types').Data[])
      project.tasks = ((project.tasks ?? []) as import('./workspace-types').Data[]).filter(
        (member) => !deleted.has(String(member.taskId ?? member.id)),
      )
  next.events = next.events.map((event) =>
    event.kind === 'session' ? { ...event, taskIds: event.taskIds.filter((id) => !deleted.has(id)) } : event,
  )
  if (oldSeries) next.recurrenceStops[oldSeries] = true
  if (recurring) {
    next.recurrenceDefinitions[seriesId] = {
      task: {
        ...taskFromJson(freshOccurrence(template)),
        recurrence,
        recurrenceSeriesId: seriesId,
        recurrenceStartDateKey: start,
        recurrenceIndex: 0,
      },
      event: originalEvents.get(selectedTask.id) ?? null,
    }
    next.recurrenceProgress[seriesId] = addDays(start, 365)
  }
  next.tasks = next.tasks.filter((task) => !removed.has(task.id))
  next.datedTasksByDate = Object.fromEntries(
    Object.entries(next.datedTasksByDate).map(([date, tasks]) => [
      date,
      tasks.filter((task) => !removed.has(task.id)),
    ]),
  )
  for (const occurrence of occurrences) {
    const tasks =
      occurrence.dateKey === today ? next.tasks : (next.datedTasksByDate[occurrence.dateKey] ?? [])
    const updated = occurrence.task.time
      ? orderTasksByTime([...tasks, occurrence.task])
      : insertBeforeCompletedTasks(tasks, occurrence.task)
    if (occurrence.dateKey === today) next.tasks = updated
    else next.datedTasksByDate[occurrence.dateKey] = updated
  }
  next.backlogGroups = next.backlogGroups.map((group) => ({
    ...group,
    items: group.items.filter((task) => !removed.has(task.id)),
  }))
  next.events = next.events.filter((event) => !deleted.has(calendarTaskId(event) ?? ''))
  for (const occurrence of occurrences) {
    if (next.events.some((event) => calendarTaskId(event) === occurrence.task.id)) continue
    const source = originalEvents.get(occurrence.task.id) ?? originalEvents.get(selectedTask.id)
    if (!source || !occurrence.task.time) continue
    const event: ScheduledTaskEvent & { recurrenceSeriesId?: string } = {
      ...source,
      kind: source.kind as ScheduledTaskEvent['kind'],
      id: occurrence.task.id,
      ...(source.taskId ? { taskId: occurrence.task.id } : {}),
      dateKey: occurrence.dateKey,
      title: occurrence.task.title,
      complete: Boolean(occurrence.task.complete),
    }
    delete event.recurrenceSeriesId
    if (occurrence.task.recurrenceSeriesId) event.recurrenceSeriesId = occurrence.task.recurrenceSeriesId
    occurrence.task.minutes = event.end - event.start
    next.events.push(event)
  }
  next.weeklyObjectives = next.weeklyObjectives.map((project) => ({
    ...project,
    tasks: [
      ...(project.tasks ?? []).filter((task) => !removed.has(task.taskId ?? task.id)),
      ...occurrences
        .filter((entry) => entry.task.objectiveId === project.id)
        .map(({ task }) => ({
          id: `objective-${task.id}`,
          taskId: task.id,
          title: task.title,
          minutes: task.minutes,
          complete: Boolean(task.complete),
        })),
    ],
  }))
  return {
    fields: next,
    activeTaskId: removed.has(taskId)
      ? (occurrences.find((entry) => entry.task.id === taskId)?.task.id ?? occurrences[0]?.task.id ?? null)
      : undefined,
  }
}
export function changeWorkspaceRecurrence(
  document: WorkspaceDocument,
  taskId: string,
  recurrence: Recurrence,
  context: {
    today: string
    seriesId: string
    prepareTask(task: Task): Task
  },
) {
  return collectionCommand(document, (fields) =>
    changeWorkspaceRecurrenceView(fields, taskId, recurrence, context),
  )
}

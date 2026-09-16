import { CURRENT_DATE_KEY } from './dates.js'
import { currentDayMinute } from './time.js'
import { calendarEventOnDate } from '../../../../domain/calendar-time'

export const CALENDAR_DAY_MINUTES = 24 * 60
export const CALENDAR_DRAG_TYPE = 'calendar-schedulable'
export const CALENDAR_HOUR_HEIGHT = 60
export const CALENDAR_MIN_EVENT_MINUTES = 15
export const CALENDAR_SNAP_MINUTES = 5
export const COMPLETION_CLUSTER_MINUTES = 15

export const snapCalendarMinutes = (minutes) =>
  Math.round(minutes / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES

export const clampCalendarStart = (start, duration, allowOvernight = false) =>
  Math.max(0, Math.min(CALENDAR_DAY_MINUTES - (allowOvernight ? CALENDAR_SNAP_MINUTES : duration), start))

export const clampCalendarEnd = (end, start, maxEnd = CALENDAR_DAY_MINUTES) =>
  Math.max(start + CALENDAR_MIN_EVENT_MINUTES, Math.min(maxEnd, end))

export const calendarEndAfterResize = ({ start, end, deltaY, scrollDelta = 0, maxEnd }) =>
  clampCalendarEnd(
    snapCalendarMinutes(end + ((deltaY + scrollDelta) / CALENDAR_HOUR_HEIGHT) * 60),
    start,
    maxEnd,
  )

export const calendarStartAfterMove = ({
  start,
  duration,
  deltaY,
  scrollDelta = 0,
  allowOvernight = false,
}) =>
  clampCalendarStart(
    snapCalendarMinutes(start + ((deltaY + scrollDelta) / CALENDAR_HOUR_HEIGHT) * 60),
    duration,
    allowOvernight,
  )

export const calendarStartAtPointer = ({ pointerY, timelineTop, duration }) =>
  clampCalendarStart(snapCalendarMinutes(((pointerY - timelineTop) / CALENDAR_HOUR_HEIGHT) * 60), duration)

export const firstAvailableCalendarStart = (events, duration, preferredStart = 8 * 60) => {
  const requestedDuration = Number.isFinite(duration) ? duration : CALENDAR_MIN_EVENT_MINUTES
  const resolvedDuration = Math.max(
    CALENDAR_MIN_EVENT_MINUTES,
    Math.min(CALENDAR_DAY_MINUTES, requestedDuration),
  )
  const sortedEvents = events
    .filter(
      (event) => event.kind !== 'shutdown' && Number.isFinite(event.start) && Number.isFinite(event.end),
    )
    .map((event) => ({
      start: Math.max(0, Math.min(CALENDAR_DAY_MINUTES, event.start)),
      end: Math.max(0, Math.min(CALENDAR_DAY_MINUTES, event.end)),
    }))
    .filter((event) => event.end > event.start)
    .sort((first, second) => first.start - second.start || first.end - second.end)
  let candidate = Math.max(0, Math.min(CALENDAR_DAY_MINUTES, preferredStart))
  if (candidate + resolvedDuration > CALENDAR_DAY_MINUTES) return null

  for (const event of sortedEvents) {
    if (event.end <= candidate) continue
    if (event.start >= candidate + resolvedDuration) return candidate

    candidate = Math.ceil(event.end / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES
    if (candidate + resolvedDuration > CALENDAR_DAY_MINUTES) return null
  }

  return candidate + resolvedDuration <= CALENDAR_DAY_MINUTES ? candidate : null
}

export const nextAvailableCalendarStart = (events, duration, dateKey, { taskId, now = new Date() } = {}) => {
  const preferredStart =
    dateKey === CURRENT_DATE_KEY
      ? Math.ceil(currentDayMinute(now) / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES
      : 8 * 60
  const dayEvents = events
    .filter((event) => !taskId || (event.taskId ?? event.id) !== taskId)
    .map((event) => calendarEventOnDate(event, dateKey, CURRENT_DATE_KEY))
    .filter(Boolean)
  return firstAvailableCalendarStart(dayEvents, duration, preferredStart)
}

export const ongoingCalendarSession = (events, dateKey, now = new Date()) => {
  if (dateKey !== CURRENT_DATE_KEY) return undefined
  const minute = currentDayMinute(now)
  return events.find(
    (event) =>
      event.kind === 'session' && event.dateKey === dateKey && event.start <= minute && minute < event.end,
  )
}

const eventsOverlap = (first, second) => first.start < second.end && second.start < first.end

const layoutOverlapGroup = (group) => {
  const columns = []
  const positioned = group.map((calendarEvent) => {
    let column = columns.findIndex((items) => items.at(-1).end <= calendarEvent.start)

    if (column === -1) {
      column = columns.length
      columns.push([])
    }

    columns[column].push(calendarEvent)
    return { calendarEvent, column }
  })
  const columnCount = columns.length

  return positioned.map(({ calendarEvent, column }) => {
    let columnSpan = 1

    for (let nextColumn = column + 1; nextColumn < columnCount; nextColumn += 1) {
      if (columns[nextColumn].some((otherEvent) => eventsOverlap(calendarEvent, otherEvent))) break
      columnSpan += 1
    }

    return {
      calendarEvent,
      column,
      columnCount,
      columnSpan,
    }
  })
}

export function layoutCalendarEvents(events) {
  const sortedEvents = [...events].sort(
    (first, second) =>
      first.start - second.start ||
      second.end - first.end ||
      String(first.id).localeCompare(String(second.id)),
  )
  const groups = []
  let currentGroup = []
  let currentGroupEnd = -1

  sortedEvents.forEach((calendarEvent) => {
    if (currentGroup.length && calendarEvent.start >= currentGroupEnd) {
      groups.push(currentGroup)
      currentGroup = []
      currentGroupEnd = -1
    }

    currentGroup.push(calendarEvent)
    currentGroupEnd = Math.max(currentGroupEnd, calendarEvent.end)
  })

  if (currentGroup.length) groups.push(currentGroup)
  return groups.flatMap(layoutOverlapGroup)
}

export function groupTaskCompletions(tasks, clusterMinutes = COMPLETION_CLUSTER_MINUTES) {
  const completionItems = tasks.flatMap((task) => [
    ...(task.complete && Number.isFinite(task.completedAtMinute)
      ? [
          {
            ...task,
            completionKey: `task:${task.id}`,
            completionKind: 'task',
          },
        ]
      : []),
    ...(task.subtasks || [])
      .filter((subtask) => subtask.complete && Number.isFinite(subtask.completedAtMinute))
      .map((subtask) => ({
        ...subtask,
        completionKey: `subtask:${task.id}:${subtask.id}`,
        completionKind: 'subtask',
        parentTitle: task.title,
      })),
  ])
  const completions = completionItems
    .map((task, index) => ({
      task,
      index,
      minute: Math.max(0, Math.min(CALENDAR_DAY_MINUTES - 1, task.completedAtMinute)),
    }))
    .sort((first, second) => first.minute - second.minute || first.index - second.index)
  const groups = []

  completions.forEach((completion) => {
    const currentGroup = groups.at(-1)

    if (currentGroup && completion.minute - currentGroup.startedAtMinute <= clusterMinutes) {
      currentGroup.completedAtMinute = completion.minute
      currentGroup.tasks.push(completion.task)
      return
    }

    groups.push({
      startedAtMinute: completion.minute,
      completedAtMinute: completion.minute,
      tasks: [completion.task],
    })
  })

  return groups
}

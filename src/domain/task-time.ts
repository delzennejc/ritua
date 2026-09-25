import type { CalendarEvent, CalendarSession } from './models'

type TaskTime = {
  id?: string
  actualMinutes?: number | null
}

type TimeScope = {
  dateKeys?: readonly string[]
  includeEmptySessions?: boolean
}

export function taskWorkedMinutes(task: TaskTime, events: readonly CalendarEvent[] = []): number {
  if (events.some((event) => event.kind === 'session' && event.taskIds.includes(task.id ?? ''))) return 0
  return task.actualMinutes ?? 0
}

/** Split a Session evenly across its members for Area/Project filters, never using task estimates.
 * Assign spare whole minutes by stable ID so filtering and reordering preserve the total. */
export function sessionMinutesForTasks(session: CalendarSession, taskIds: ReadonlySet<string>): number {
  const members = [...new Set(session.taskIds)].sort()
  if (!members.length) return 0
  const duration = Math.max(0, session.end - session.start)
  const share = Math.floor(duration / members.length)
  const remainder = duration % members.length
  return members.reduce(
    (total, id, index) => total + (taskIds.has(id) ? share + (index < remainder ? 1 : 0) : 0),
    0,
  )
}

export function taskTimeTotals(
  tasks: readonly TaskTime[],
  events: readonly CalendarEvent[] = [],
  scope: TimeScope = {},
) {
  const seen = new Set<string>()
  const unique = tasks.filter((task) => {
    if (!task.id) return true
    if (seen.has(task.id)) return false
    seen.add(task.id)
    return true
  })
  const seenSessions = new Set<string>()
  const actual = events.reduce(
    (total, event) => {
      if (event.kind !== 'session' || seenSessions.has(event.id)) return total
      seenSessions.add(event.id)
      if (scope.dateKeys && !scope.dateKeys.includes(event.dateKey)) return total
      return (
        total +
        (event.taskIds.length
          ? sessionMinutesForTasks(event, seen)
          : scope.includeEmptySessions === false
            ? 0
            : Math.max(0, event.end - event.start))
      )
    },
    unique.reduce((total, task) => total + taskWorkedMinutes(task, events), 0),
  )
  return { actual }
}

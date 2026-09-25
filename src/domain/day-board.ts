import type { Task, TaskCollections } from './models'
import { calendarTaskId } from './task-calendar'
import { timeLabel } from './time-format'

/** Read-only board cards. Calendar references never create additional task entities. */
export function dayBoardTasks(
  { tasks, datedTasksByDate, events }: Pick<TaskCollections, 'tasks' | 'datedTasksByDate' | 'events'>,
  today: string,
): Record<string, Task[]> {
  const days = { ...datedTasksByDate, [today]: tasks }
  const canonical = new Map(
    Object.values(days)
      .flat()
      .map((task) => [task.id, task]),
  )
  const starts = new Map<string, Map<string, number>>()
  for (const event of events) {
    const taskId = calendarTaskId(event)
    if (!taskId || !canonical.has(taskId)) continue
    const date = event.dateKey || today
    const day = starts.get(date) ?? new Map<string, number>()
    day.set(taskId, Math.min(day.get(taskId) ?? Infinity, event.start))
    starts.set(date, day)
  }
  for (const [date, timing] of starts) {
    const cards = new Map((days[date] || []).map((task) => [task.id, task]))
    for (const [id, start] of timing) {
      const task = canonical.get(id)!
      const time = timeLabel(start)
      cards.set(id, task.time === time ? task : { ...task, time })
    }
    days[date] = [...cards.values()]
  }
  return days
}

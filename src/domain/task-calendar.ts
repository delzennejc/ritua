import type { CalendarEvent } from './models'
import type { Data, WorkspaceDocument } from './workspace-types'
import { taskContent } from './workspace-selectors'
import { timeLabel, minutesLabel } from './time-format'

export function calendarTaskId(event: CalendarEvent): string | undefined {
  return event.kind === 'session' || event.kind === 'shutdown' ? undefined : (event.taskId ?? event.id)
}

export function nextTaskBlockId(taskId: string, eventIds: Iterable<string>): string {
  const ids = new Set(eventIds)
  if (!ids.has(taskId)) return taskId
  let index = 2
  while (ids.has(`${taskId}:block:${index}`)) index++
  return `${taskId}:block:${index}`
}

/** Calendar blocks share one task. Timing is always the sum of its retained blocks. */
export function syncTaskCalendarTiming(document: WorkspaceDocument, taskId: string) {
  const entity = document.entities.find((e) => e.kind === 'task' && e.id === taskId)
  if (!entity) return
  const task = taskContent(entity)
  const blocks = document.entities
    .filter((e) => e.kind === 'event' && e.data.taskId === taskId)
    .map((e) => e.data.content as Data)
  const dateKey =
    entity.data.lane === 'today' ? document.fields.workspaceDate : String(entity.data.lane).slice(5)
  const starts = blocks
    .filter((block) => (block.dateKey || document.fields.workspaceDate) === dateKey)
    .map((block) => Number(block.start))
  task.time = starts.length ? timeLabel(Math.min(...starts)) : null
  task.minutes = blocks.reduce((total, block) => total + Number(block.end) - Number(block.start), 0)
  if (task.durationLabel) {
    const planned = minutesLabel(task.minutes)
    task.durationLabel = task.durationLabel.includes('/')
      ? `${task.actualMinutes != null ? minutesLabel(task.actualMinutes) : task.durationLabel.split('/')[0]!.trim()} / ${planned}`
      : planned
  }
}

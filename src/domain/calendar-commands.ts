import type { CalendarEvent } from './models'
import type { WorkspaceDocument, Data, Entity } from './workspace-types'
import { editDocument, equalJson } from './workspace-immutable'
import { taskContent } from './workspace-selectors'
import { orderTasksByTime } from './tasks'
import { timeLabel } from './time-format'
import { syncedDurationLabel } from './task-editing'

/** Calendar edits own task timing; callers never need to patch task lists as well. */
export function editWorkspaceCalendar(input: WorkspaceDocument, events: CalendarEvent[]): WorkspaceDocument {
  return editDocument(input, (doc) => {
    const previous = new Map(doc.entities.filter((e) => e.kind === 'event').map((e) => [e.id, e]))
    const tasksById = new Map(doc.entities.filter((e) => e.kind === 'task').map((e) => [e.id, e]))
    const changedLanes = new Set<string>()
    const nextEvents: Entity[] = events.map((event, position) => {
      const task = event.kind === 'session' ? undefined : tasksById.get(event.id)
      const content: Data = { ...event }
      if (task) {
        delete content.title
        delete content.complete
      }
      const next: Entity = {
        kind: 'event',
        id: event.id,
        data: { content, position, taskId: task?.id ?? null, derived: task ? ['title', 'complete'] : [] },
      }
      const before = previous.get(event.id)
      if (
        equalJson(before?.data.content, content) &&
        before?.data.position === position &&
        before?.data.taskId === next.data.taskId &&
        equalJson(before?.data.derived, next.data.derived)
      )
        return before!
      if (
        task &&
        event.kind !== 'session' &&
        event.kind !== 'shutdown' &&
        !equalJson(before?.data.content, content)
      ) {
        const dateKey = event.dateKey || String(doc.fields.workspaceDate)
        const lane = dateKey === doc.fields.workspaceDate ? 'today' : `date:${dateKey}`
        changedLanes.add(String(task.data.lane))
        changedLanes.add(lane)
        if (task.data.lane !== lane) {
          task.data.position = [...tasksById.values()].filter((e) => e.data.lane === lane).length
          task.data.lane = lane
          if (lane.startsWith('date:'))
            doc.fields.dateKeys = [...new Set([...(doc.fields.dateKeys as string[]), dateKey])]
        }
        const value = taskContent(task)
        value.time = timeLabel(event.start)
        value.minutes = event.end - event.start
        value.durationLabel = syncedDurationLabel(value, value.minutes)
      }
      return next
    })
    const retained = new Set(events.map((e) => e.id))
    for (const [id, before] of previous)
      if (!retained.has(id) && before.data.taskId) {
        const task = tasksById.get(String(before.data.taskId))
        if (task) taskContent(task).time = null
      }
    for (const lane of changedLanes) {
      const tasks = [...tasksById.values()]
        .filter((e) => e.data.lane === lane)
        .sort((a, b) => Number(a.data.position) - Number(b.data.position))
      const positions = new Map(orderTasksByTime(tasks.map(taskContent)).map((task, i) => [task.id, i]))
      for (const task of tasks) task.data.position = positions.get(task.id)!
    }
    const oldEvents = doc.entities.filter((e) => e.kind === 'event')
    if (nextEvents.length !== oldEvents.length || nextEvents.some((e, i) => e !== oldEvents[i]))
      doc.entities = [...doc.entities.filter((e) => e.kind !== 'event'), ...nextEvents]
  })
}

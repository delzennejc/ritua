import { editDocument } from './workspace-immutable'
import type { WorkspaceDocument } from './workspace'
import { taskFromJson } from './workspace-selectors'
import { addDays, localDateKey } from './calendar-dates'
import { completedTasksLast } from './tasks'
import { type Data } from './workspace'

// Move the reviewed lane as one edit so dates, calendar blocks and project views agree.

// Move the reviewed lane as one edit so dates, calendar blocks and project views agree.
export function reassignMissedTasksToToday(
  input: WorkspaceDocument,
  taskIds: string[],
  today = localDateKey(),
): WorkspaceDocument {
  const yesterday = addDays(today, -1)
  return editDocument(input, (document) => {
    const yesterdayTasks = new Map(
      document.entities
        .filter((entity) => entity.kind === 'task' && entity.data.lane === `date:${yesterday}`)
        .map((entity) => [entity.id, entity]),
    )
    const missed = [...new Set(taskIds)].flatMap((id) => {
      const task = yesterdayTasks.get(id)
      return task ? [task] : []
    })
    if (!missed.length) return

    const todayTasks = document.entities
      .filter((entity) => entity.kind === 'task' && entity.data.lane === 'today')
      .sort((a, b) => Number(a.data.position) - Number(b.data.position))
    const ordered = completedTasksLast(
      [...todayTasks, ...missed].map((entity) => taskFromJson(entity.data.content)),
    ) as Data[]
    const positions = new Map(ordered.map((task, index) => [task.id, index]))
    for (const task of [...todayTasks, ...missed]) {
      task.data.lane = 'today'
      task.data.position = positions.get(task.id)!
    }

    const movedIds = new Set(missed.map((task) => task.id))
    for (const event of document.entities.filter((entity) => entity.kind === 'event')) {
      const content = event.data.content as Data
      if (movedIds.has(String(event.data.taskId)) && content.dateKey === yesterday) content.dateKey = today
    }
    return
  })
}

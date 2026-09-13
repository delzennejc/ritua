import { addDays, localDateKey } from './calendar-dates'
import { completedTasksLast } from './tasks'
import { normalize, project, type Data, type Fields } from './workspace'

// Move the reviewed lane as one edit so dates, calendar blocks and project views agree.
export function reassignMissedTasksToToday(fields: Fields, taskIds: string[], today = localDateKey()): Fields {
  const yesterday = addDays(today, -1)
  const document = normalize(fields)
  const yesterdayTasks = new Map(document.entities
    .filter(entity => entity.kind === 'task' && entity.data.lane === `date:${yesterday}`)
    .map(entity => [entity.id, entity]))
  const missed = [...new Set(taskIds)].flatMap(id => {
    const task = yesterdayTasks.get(id)
    return task ? [task] : []
  })
  if (!missed.length) return fields

  const todayTasks = document.entities
    .filter(entity => entity.kind === 'task' && entity.data.lane === 'today')
    .sort((a, b) => Number(a.data.position) - Number(b.data.position))
  const ordered = completedTasksLast([...todayTasks, ...missed].map(entity => entity.data.content)) as Data[]
  const positions = new Map(ordered.map((task, index) => [task.id, index]))
  for (const task of [...todayTasks, ...missed]) {
    task.data.lane = 'today'
    task.data.position = positions.get(task.id)!
  }

  const movedIds = new Set(missed.map(task => task.id))
  for (const event of document.entities.filter(entity => entity.kind === 'event')) {
    const content = event.data.content as Data
    if (movedIds.has(String(event.data.taskId)) && content.dateKey === yesterday) content.dateKey = today
  }
  return project(document)
}

import { localDateKey } from './calendar-dates'
import { orderTasksByTime, setTaskCompletionInObjectiveMirrors, toggleTaskInTasks } from './tasks'
import { normalize, project, type Data, type Entity, type Fields } from './workspace'

const content = (entity: Entity) => entity.data.content as Data
const items = (value: Fields[string] | undefined) => (value ?? []) as Data[]
const timeLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

// Completion and its calendar consequences are one workspace edit, shared by every view.
export function toggleWorkspaceTaskCompletion(fields: Fields, taskId: string, now = new Date()): Fields {
  const document = normalize(fields)
  const source = document.entities.find(entity => entity.kind === 'task' && entity.id === taskId)
  if (!source) return fields
  const complete = !content(source).complete
  const minute = now.getHours() * 60 + now.getMinutes()
  const lane = document.entities
    .filter(entity => entity.kind === 'task' && entity.data.lane === source.data.lane)
    .sort((a, b) => Number(a.data.position) - Number(b.data.position))
  const toggled = toggleTaskInTasks(lane.map(content), taskId, minute) as Data[]
  const byId = new Map(lane.map(entity => [entity.id, entity]))
  toggled.forEach((task, position) => {
    const entity = byId.get(String(task.id))!
    entity.data.content = task
    entity.data.position = position
  })

  content(source).completedDateKey = complete ? localDateKey(now) : null

  if (complete) {
    const today = localDateKey(now)
    const workspaceDate = String(fields.workspaceDate ?? today)
    const dateFor = (event: Entity) => String(content(event).dateKey || workspaceDate)
    const taskDate = (task: Entity) => task.data.lane === 'today' ? workspaceDate : String(task.data.lane).replace(/^date:/, '')
    const event = document.entities.find(entity => entity.kind === 'event' && entity.data.taskId === taskId && content(entity).kind !== 'shutdown')
    if (event && dateFor(event) === today && taskDate(source) === today) {
      const start = Number(content(event).start)
      const end = Number(content(event).end)
      const delta = minute - end
      // Never turn an early check-off into a zero/negative block, or retime another day.
      if (minute > start && Math.abs(delta) <= 3 * 60 && delta !== 0) {
        content(event).end = minute
        content(source).time = timeLabel(start)
        content(source).minutes = minute - start

        const tasks = new Map(document.entities.filter(entity => entity.kind === 'task').map(entity => [entity.id, entity]))
        const following = document.entities.filter(entity => {
          if (entity.kind !== 'event' || entity.id === event.id || dateFor(entity) !== today || content(entity).kind === 'shutdown') return false
          const task = tasks.get(String(entity.data.taskId))
          return task && !content(task).complete && taskDate(task) === today && Number(content(entity).start) >= end
        })
        // Keep the remaining blocks together, preserving durations and gaps up to midnight.
        const shift = Math.min(delta, ...following.map(entity => 1440 - Number(content(entity).end)))
        for (const next of following) {
          const block = content(next)
          block.start = Number(block.start) + shift
          block.end = Number(block.end) + shift
          const task = tasks.get(String(next.data.taskId))!
          content(task).time = timeLabel(Number(block.start))
          content(task).minutes = Number(block.end) - Number(block.start)
        }
        const ordered = orderTasksByTime(lane.sort((a, b) => Number(a.data.position) - Number(b.data.position)).map(content)) as Data[]
        ordered.forEach((task, position) => { byId.get(String(task.id))!.data.position = position })
      }
    }
    // Actual time records the final calendar block, including when no retiming was needed.
    if (event) content(source).actualMinutes = Number(content(event).end) - Number(content(event).start)
  }

  // Reorder project references using the same completion/reopen behavior as task lanes.
  const result = project(document)
  for (const collection of ['weeklyObjectives', 'archivedObjectives', 'weekly.accomplishedObjectives']) {
    const ordered = setTaskCompletionInObjectiveMirrors(items(fields[collection]), taskId, complete) as Data[]
    const projected = new Map(items(result[collection]).map(objective => [objective.id, objective]))
    result[collection] = ordered.map(objective => {
      const current = projected.get(objective.id)!
      if (!Array.isArray(objective.tasks)) return current
      const members = new Map(items(current.tasks).map(task => [task.id, task]))
      return { ...current, tasks: items(objective.tasks).map(task => {
        const member = { ...task, ...members.get(task.id) }
        delete member.incompletePosition
        if (task.incompletePosition) member.incompletePosition = task.incompletePosition
        return member
      }) }
    })
  }
  return project(normalize(result))
}

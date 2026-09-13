import { insertBeforeCompletedTasks } from './tasks'
import { normalize, project, validateDocument, type Data, type Fields } from './workspace'

export const DEFAULT_SESSION_MINUTES = 180
export interface SessionDraft {
  id: string
  title: string
  dateKey: string
  start: number
  end?: number
}

// Sessions are independent calendar events containing ordered canonical task references.
// They never move, copy, or estimate the tasks they contain.
export function createCalendarSession(fields: Fields, draft: SessionDraft): Fields {
  const session: Data = { id: draft.id, dateKey: draft.dateKey, start: draft.start, title: draft.title.trim(), kind: 'session',
    end: draft.end ?? Math.min(1440, draft.start + DEFAULT_SESSION_MINUTES), taskIds: [] }
  if ((fields.events as Data[]).some(event => event.id === draft.id)) throw new Error('Session already exists')
  const next = { ...fields, events: [...fields.events as Data[], session] }
  validateDocument(normalize(next))
  return next
}

export function updateCalendarSession(fields: Fields, id: string, patch: Partial<Pick<SessionDraft, 'title' | 'dateKey' | 'start' | 'end'>> & { taskIds?: string[] }): Fields {
  const next = { ...fields, events: (fields.events as Data[]).map(event => event.id === id && event.kind === 'session'
    ? { ...event, ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}) } : event) }
  validateDocument(normalize(next))
  return next
}

export function addSessionTask(fields: Fields, sessionId: string, task: { id: string; title: string }): Fields {
  const session = (fields.events as Data[]).find(event => event.id === sessionId && event.kind === 'session')
  if (!session || !task.title.trim()) return fields
  const document = normalize(fields)
  if (document.entities.some(entity => entity.kind === 'task' && entity.id === task.id)) throw new Error('Task already exists')
  const area = (fields.areas as Data[])[0]
  const dateKey = String(session.dateKey)
  const lane = dateKey === fields.workspaceDate ? 'today' : `date:${dateKey}`
  document.entities.push({ kind: 'task', id: task.id, data: { lane,
    position: document.entities.filter(entity => entity.kind === 'task' && entity.data.lane === lane).length,
    content: { id: task.id, title: task.title.trim(), channel: area?.label ?? 'Work', accent: area?.accent ?? 'violet', complete: false, minutes: 0, time: null },
  } })
  if (lane !== 'today') document.fields.dateKeys = [...new Set([...document.fields.dateKeys as string[], dateKey])]
  const event = document.entities.find(entity => entity.kind === 'event' && entity.id === sessionId)!
  const content = event.data.content as Data
  content.taskIds = [...content.taskIds as string[], task.id]
  const laneTasks = document.entities.filter(entity => entity.kind === 'task' && entity.data.lane === lane)
    .sort((a, b) => Number(a.data.position) - Number(b.data.position))
  const created = laneTasks.find(entity => entity.id === task.id)!
  const ordered = insertBeforeCompletedTasks(laneTasks.filter(entity => entity !== created).map(entity => entity.data.content), created.data.content) as Data[]
  ordered.forEach((content, position) => { laneTasks.find(entity => entity.id === content.id)!.data.position = position })
  validateDocument(document)
  return project(document)
}

// Link existing canonical work without moving its lane, schedule, or Area.
export function linkSessionTask(fields: Fields, sessionId: string, taskId: string): Fields {
  const session = (fields.events as Data[]).find(event => event.id === sessionId && event.kind === 'session')
  if (!session || (session.taskIds as string[]).includes(taskId)) return fields
  if (!normalize(fields).entities.some(entity => entity.kind === 'task' && entity.id === taskId)) return fields
  return updateCalendarSession(fields, sessionId, { taskIds: [...session.taskIds as string[], taskId] })
}

// A completion belongs to its actual day, even when a session or task is moved later.
export function calendarCompletionTasks(dayTasks: Data[], canonicalTasks: Data[], dateKey: string): Data[] {
  const result = new Map(dayTasks.map(task => [String(task.id), task.completedDateKey && task.completedDateKey !== dateKey
    ? { ...task, complete: false } : task]))
  for (const task of canonicalTasks) {
    if (task.complete && task.completedDateKey === dateKey) result.set(String(task.id), task)
  }
  return [...result.values()]
}

// Reordering, transferring, and dragging out change membership in one atomic edit.
export function moveSessionTask(fields: Fields, sourceId: string, taskId: string, targetId: string | null, beforeId: string | null = null): Fields {
  const events = fields.events as Data[]
  const source = events.find(event => event.kind === 'session' && event.id === sourceId)
  const target = targetId ? events.find(event => event.kind === 'session' && event.id === targetId) : null
  if (!source || !(source.taskIds as string[]).includes(taskId) || (targetId && !target)) return fields
  const next = { ...fields, events: events.map(event => {
    if (event !== source && event !== target) return event
    const taskIds = (event.taskIds as string[]).filter(id => id !== taskId)
    if (event === target) {
      const index = beforeId ? taskIds.indexOf(beforeId) : -1
      taskIds.splice(index < 0 ? taskIds.length : index, 0, taskId)
    }
    return { ...event, taskIds }
  }) }
  validateDocument(normalize(next))
  return next
}

import type { WorkspaceDocument, Data } from './workspace-types'
import { editDocument } from './workspace-immutable'
import { validateDocument } from './workspace-validation'
import { taskContent } from './workspace-selectors'
import { insertBeforeCompletedTasks } from './tasks'
import { reconcileSessionBoards } from './session-board-order'

export const DEFAULT_SESSION_MINUTES = 180
export interface SessionDraft {
  id: string
  title: string
  dateKey: string
  start: number
  end?: number
}
const sessionEntity = (document: WorkspaceDocument, id: string) =>
  document.entities.find(
    (e) => e.kind === 'event' && e.id === id && (e.data.content as Data).kind === 'session',
  )
function editSessions(input: WorkspaceDocument, edit: (document: WorkspaceDocument) => void) {
  const next = editDocument(input, (document) => {
    edit(document)
    reconcileSessionBoards(input, document)
  })
  validateDocument(next)
  return next
}
export function createCalendarSession(input: WorkspaceDocument, draft: SessionDraft): WorkspaceDocument {
  return editSessions(input, (document) => {
    if (document.entities.some((e) => e.kind === 'event' && e.id === draft.id))
      throw new Error('Session already exists')
    document.entities.push({
      kind: 'event',
      id: draft.id,
      data: {
        position: document.entities.filter((e) => e.kind === 'event').length,
        taskId: null,
        derived: [],
        content: {
          ...draft,
          title: draft.title.trim(),
          kind: 'session',
          end: draft.end ?? Math.min(1440, draft.start + DEFAULT_SESSION_MINUTES),
          taskIds: [],
        },
      },
    })
  })
}
export function updateCalendarSession(
  input: WorkspaceDocument,
  id: string,
  patch: Partial<Pick<SessionDraft, 'title' | 'dateKey' | 'start' | 'end'>> & { taskIds?: string[] },
): WorkspaceDocument {
  return editSessions(input, (document) => {
    const event = sessionEntity(document, id)
    if (event) {
      event.data.content = {
        ...(event.data.content as Data),
        ...patch,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      }
    }
  })
}
export function addSessionTask(
  input: WorkspaceDocument,
  sessionId: string,
  task: { id: string; title: string },
): WorkspaceDocument {
  return editSessions(input, (document) => {
    const event = sessionEntity(document, sessionId)
    if (!event || !task.title.trim()) return
    if (document.entities.some((e) => e.kind === 'task' && e.id === task.id))
      throw new Error('Task already exists')
    const session = event.data.content as Data
    const area = document.entities
      .filter((e) => e.kind === 'area')
      .sort((a, b) => Number(a.data.position) - Number(b.data.position))[0]?.data.content as Data | undefined
    const dateKey = String(session.dateKey),
      lane = dateKey === document.fields.workspaceDate ? 'today' : `date:${dateKey}`
    const content = {
      id: task.id,
      title: task.title.trim(),
      channel: area?.label ?? 'Work',
      accent: area?.accent ?? 'violet',
      complete: false,
      minutes: 0,
      time: null,
    }
    const tasks = document.entities
      .filter((e) => e.kind === 'task' && e.data.lane === lane)
      .sort((a, b) => Number(a.data.position) - Number(b.data.position))
    const ordered = insertBeforeCompletedTasks(
      tasks.map(taskContent),
      content as ReturnType<typeof taskContent>,
    )
    const positions = new Map(ordered.map((task, i) => [task.id, i]))
    tasks.forEach((e) => {
      e.data.position = positions.get(e.id)!
    })
    document.entities.push({
      kind: 'task',
      id: task.id,
      data: { content, lane, position: positions.get(task.id)! },
    })
    if (lane !== 'today')
      document.fields.dateKeys = [...new Set([...(document.fields.dateKeys as string[]), dateKey])]
    session.taskIds = [...(session.taskIds as string[]), task.id]
  })
}
export function linkSessionTask(
  input: WorkspaceDocument,
  sessionId: string,
  taskId: string,
): WorkspaceDocument {
  const event = sessionEntity(input, sessionId),
    session = event?.data.content as Data | undefined
  if (
    !session ||
    (session.taskIds as string[]).includes(taskId) ||
    !input.entities.some((e) => e.kind === 'task' && e.id === taskId)
  )
    return input
  return updateCalendarSession(input, sessionId, { taskIds: [...(session.taskIds as string[]), taskId] })
}
export function unlinkTaskFromSessions(input: WorkspaceDocument, taskId: string): WorkspaceDocument {
  return editSessions(input, (document) => {
    for (const event of document.entities) {
      if (event.kind !== 'event') continue
      const content = event.data.content as Data
      if (content.kind !== 'session' || !(content.taskIds as string[]).includes(taskId)) continue
      content.taskIds = (content.taskIds as string[]).filter((id) => id !== taskId)
    }
  })
}
// A completion belongs to its actual day, even when a session or task is moved later.
export function calendarCompletionTasks(dayTasks: Data[], canonicalTasks: Data[], dateKey: string): Data[] {
  const result = new Map(
    dayTasks.map((task) => [
      String(task.id),
      task.completedDateKey && task.completedDateKey !== dateKey ? { ...task, complete: false } : task,
    ]),
  )
  for (const task of canonicalTasks) {
    if (task.complete && task.completedDateKey === dateKey) result.set(String(task.id), task)
  }
  return [...result.values()]
}

export function moveSessionTask(
  input: WorkspaceDocument,
  sourceId: string,
  taskId: string,
  targetId: string | null,
  beforeId: string | null = null,
): WorkspaceDocument {
  return editSessions(input, (document) => {
    const source = sessionEntity(document, sourceId),
      target = targetId ? sessionEntity(document, targetId) : null
    if (
      !source ||
      !(source.data.content as Data).taskIds ||
      !((source.data.content as Data).taskIds as string[]).includes(taskId) ||
      (targetId && !target)
    )
      return
    for (const event of new Set([source, target])) {
      if (!event) continue
      const content = event.data.content as Data,
        ids = (content.taskIds as string[]).filter((id) => id !== taskId)
      if (event === target) {
        const index = beforeId ? ids.indexOf(beforeId) : -1
        ids.splice(index < 0 ? ids.length : index, 0, taskId)
      }
      content.taskIds = ids
    }
  })
}
export function removeCalendarSession(input: WorkspaceDocument, id: string): WorkspaceDocument {
  return editSessions(input, (document) => {
    document.entities = document.entities.filter((e) => e !== sessionEntity(document, id))
  })
}
export function restoreCalendarSession(
  input: WorkspaceDocument,
  session: Data,
  position: number,
): WorkspaceDocument {
  return editSessions(input, (document) => {
    if (document.entities.some((e) => e.kind === 'event' && e.id === session.id)) return
    const taskIds = new Set(document.entities.filter((e) => e.kind === 'task').map((e) => e.id))
    const events = document.entities
      .filter((e) => e.kind === 'event')
      .sort((a, b) => Number(a.data.position) - Number(b.data.position))
    const restored = {
      kind: 'event' as const,
      id: String(session.id),
      data: {
        content: { ...session, taskIds: (session.taskIds as string[]).filter((id) => taskIds.has(id)) },
        taskId: null,
        derived: [],
        position,
      },
    }
    events.splice(Math.min(position, events.length), 0, restored)
    events.forEach((e, i) => {
      e.data.position = i
    })
    document.entities.push(restored)
  })
}

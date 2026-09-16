import { syncTaskCalendarTiming } from './task-calendar'
import { editDocument } from './workspace-immutable'
import type { Entity } from './workspace'
import type { WorkspaceDocument } from './workspace'
import { taskContent } from './workspace-selectors'
import { localDateKey } from './calendar-dates'
import { orderTasksByTime, setTaskCompletionInObjectiveMirrors, toggleTaskInTasks } from './tasks'
import { type Data } from './workspace'
import { documentSessions, orderSessionBoardLanes, sessionLane } from './session-board-order'

const content = (entity: Entity) => entity.data.content as Data
const timeLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

// Completion and its calendar consequences are one workspace edit, shared by every view.
export function toggleWorkspaceTaskCompletion(
  input: WorkspaceDocument,
  taskId: string,
  now = new Date(),
): WorkspaceDocument {
  return editDocument(input, (document) => {
    const source = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (!source) return
    const complete = !content(source).complete
    const minute = now.getHours() * 60 + now.getMinutes()
    const lane = document.entities
      .filter((entity) => entity.kind === 'task' && entity.data.lane === source.data.lane)
      .sort((a, b) => Number(a.data.position) - Number(b.data.position))
    const toggled = toggleTaskInTasks(lane.map(taskContent), taskId, minute) as Data[]
    const byId = new Map(lane.map((entity) => [entity.id, entity]))
    toggled.forEach((task, position) => {
      const entity = byId.get(String(task.id))!
      entity.data.content = task
      entity.data.position = position
    })

    content(source).completedDateKey = complete ? localDateKey(now) : null

    if (complete) {
      const today = localDateKey(now)
      const workspaceDate = String(document.fields.workspaceDate ?? today)
      const dateFor = (event: Entity) => String(content(event).dateKey || workspaceDate)
      const taskDate = (task: Entity) =>
        task.data.lane === 'today' ? workspaceDate : String(task.data.lane).replace(/^date:/, '')
      const blocks = document.entities.filter(
        (entity) =>
          entity.kind === 'event' && entity.data.taskId === taskId && content(entity).kind !== 'shutdown',
      )
      const event = blocks
        .filter((block) => dateFor(block) === today && Number(content(block).start) < minute)
        .sort((a, b) => Number(content(b).start) - Number(content(a).start))[0]
      if (event && dateFor(event) === today && taskDate(source) === today) {
        const start = Number(content(event).start)
        const end = Number(content(event).end)
        const delta = minute - end
        // Never turn an early check-off into a zero/negative block, or retime another day.
        if (minute > start && Math.abs(delta) <= 3 * 60 && delta !== 0) {
          content(event).end = minute
          content(source).time = timeLabel(start)
          content(source).minutes = minute - start

          const tasks = new Map(
            document.entities.filter((entity) => entity.kind === 'task').map((entity) => [entity.id, entity]),
          )
          const following = document.entities.filter((entity) => {
            if (
              entity.kind !== 'event' ||
              entity.id === event.id ||
              dateFor(entity) !== today ||
              content(entity).kind === 'shutdown'
            )
              return false
            const task = tasks.get(String(entity.data.taskId))
            return (
              task &&
              !content(task).complete &&
              taskDate(task) === today &&
              Number(content(entity).start) >= end
            )
          })
          // Keep the remaining blocks together, preserving durations and gaps up to midnight.
          const shift = Math.min(delta, ...following.map((entity) => 1440 - Number(content(entity).end)))
          for (const next of following) {
            const block = content(next)
            block.start = Number(block.start) + shift
            block.end = Number(block.end) + shift
            const task = tasks.get(String(next.data.taskId))!
            content(task).time = timeLabel(Number(block.start))
            syncTaskCalendarTiming(document, task.id)
          }
          const ordered = orderTasksByTime(
            lane.sort((a, b) => Number(a.data.position) - Number(b.data.position)).map(taskContent),
          ) as Data[]
          ordered.forEach((task, position) => {
            byId.get(String(task.id))!.data.position = position
          })
        }
      }
      if (blocks.length) {
        content(source).actualMinutes = blocks.reduce(
          (total, block) => total + Number(content(block).end) - Number(content(block).start),
          0,
        )
        syncTaskCalendarTiming(document, taskId)
      }
    }

    orderCompletionReferences(document, taskId, complete)
    // The board already applies completion and restores the previous active position on undo.
    // Persist that same order in the session so every view animates the same canonical change.
    const ranks = new Map(toggled.map((task, index) => [String(task.id), index]))
    for (const session of documentSessions(document)) {
      if (session.taskIds.includes(taskId))
        session.taskIds.sort((a, b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity))
    }
    if (
      documentSessions(document).some(
        (session) => sessionLane(document, session.dateKey) === source.data.lane,
      )
    )
      orderSessionBoardLanes(document, new Set([String(source.data.lane)]))
  })
}

/** Completion ordering changes reference metadata, never task copies. */
export function orderCompletionReferences(
  document: WorkspaceDocument,
  taskId: string,
  complete: boolean,
): void {
  const tasks = new Map(document.entities.filter((e) => e.kind === 'task').map((e) => [e.id, taskContent(e)]))
  for (const owner of document.entities.filter((e) => e.kind === 'project')) {
    const links = owner.data.links as Data[]
    // The existing ordering rule works on tiny reference records; content stays canonical.
    const members = links.map((link) => ({
      id: String(link.id),
      title: '',
      taskId: String(link.taskId),
      complete: link.taskId === taskId ? !complete : Boolean(tasks.get(String(link.taskId))?.complete),
      ...((link.extra as Data) || {}),
    }))
    const ordered = setTaskCompletionInObjectiveMirrors(
      [{ id: owner.id, title: '', tasks: members }],
      taskId,
      complete,
    )[0]!.tasks!
    const byId = new Map(links.map((link) => [link.id, link]))
    owner.data.links = ordered.map((member) => {
      const link = byId.get(member.id)!
      const extra = { ...(link.extra as Data) }
      delete extra.incompletePosition
      if (member.incompletePosition) extra.incompletePosition = member.incompletePosition
      link.extra = extra
      link.keys = [
        ...new Set([
          ...(link.keys as string[]).filter((key) => key !== 'incompletePosition'),
          ...(member.incompletePosition ? ['incompletePosition'] : []),
        ]),
      ]
      return link
    })
  }
}

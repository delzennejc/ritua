import { editDocument } from './workspace-immutable'
import { validTaskSchedule } from './calendar-time'
import { orderCompletionReferences } from './task-completion'
import type { Activity, Task, TaskLocation } from './models'
import type { Data, Entity, WorkspaceDocument } from './workspace'
import { taskContent } from './workspace-selectors'
import { toggleSubtaskInTasks, orderTasksByTime, completeUndatedTaskInTasks } from './tasks'
import { nextTaskBlockId, syncTaskCalendarTiming } from './task-calendar'
import { activityWithCreation, taskActivity } from './task-activity'
import {
  detachSessionMembership,
  documentSessions,
  orderSessionBoardLanes,
  sessionLane,
} from './session-board-order'

export interface ActionContext {
  today: string
  actor: string
  now: Date
}
export type TaskCommand =
  | {
      type: 'task.create'
      tasks: { task: Task; lane: TaskLocation }[]
      placement?: 'first' | 'last' | 'before-completed'
      referencePrefix?: string
    }
  | { type: 'task.assign'; taskId: string; projectId: string | null; channel?: string }
  | { type: 'task.assign-many'; taskIds: string[]; projectId: string }
  | { type: 'task.subtask.toggle'; taskId: string; subtaskId: string }
  | { type: 'task.complete-undated'; taskId: string; activity?: Activity }
  | {
      type: 'task.move'
      taskId: string
      lane: TaskLocation
      index?: number
      channel?: string
      projectId?: string | null
      preparedTask?: Task
      schedule?: { dateKey: string; start: number; end: number }
      activity?: Activity
    }
  | { type: 'task.schedule'; taskId: string; dateKey: string; start: number; end: number; eventId?: string }
  | { type: 'task.unschedule'; taskId: string; eventId?: string }

function taskEntity(doc: WorkspaceDocument, id: string) {
  return doc.entities.find((e) => e.kind === 'task' && e.id === id)
}
const taskLane = (doc: WorkspaceDocument, lane: string) =>
  doc.entities
    .filter((e) => e.kind === 'task' && e.data.lane === lane)
    .sort((a, b) => Number(a.data.position) - Number(b.data.position))
function setLane(doc: WorkspaceDocument, entity: Entity, lane: TaskLocation, index?: number) {
  if (
    lane.startsWith('backlog:') &&
    !(doc.fields.backlogGroups as Data[]).some((g) => `backlog:${g.id}` === lane)
  )
    throw new Error('Task list no longer exists')
  if (lane.startsWith('date:'))
    doc.fields.dateKeys = [...new Set([...((doc.fields.dateKeys as string[]) ?? []), lane.slice(5)])]
  const previous = String(entity.data.lane)
  const target = taskLane(doc, lane).filter((e) => e.id !== entity.id)
  const position = Math.max(0, Math.min(index ?? target.length, target.length))
  entity.data.lane = lane
  target.splice(position, 0, entity)
  target.forEach((e, i) => {
    e.data.position = i
  })
  if (previous !== lane)
    taskLane(doc, previous).forEach((e, i) => {
      e.data.position = i
    })
}
function assign(doc: WorkspaceDocument, task: Task, projectId: string | null, prefix?: string) {
  const owners = doc.entities.filter((e) => e.kind === 'project' && e.data.collection === 'weeklyObjectives')
  const owner = projectId ? owners.find((e) => (e.data.content as Data).id === projectId) : undefined
  if (projectId && (!owner || (owner.data.content as Data).complete))
    throw new Error('Choose an active project')
  if (owner && String((owner.data.content as Data).channel || 'Ritua') !== String(task.channel || 'Ritua'))
    throw new Error('Choose a project in the task’s Area')
  if (
    owner &&
    task.objectiveId === projectId &&
    (owner.data.links as Data[]).some((link) => link.taskId === task.id)
  )
    return
  const existing = owners.flatMap((e) => e.data.links as Data[]).find((link) => link.taskId === task.id)
  for (const e of owners) e.data.links = (e.data.links as Data[]).filter((link) => link.taskId !== task.id)
  if (owner) {
    owner.data.hasTasks = true
    ;(owner.data.links as Data[]).push(
      existing ?? {
        id: `${prefix ?? projectId}-${task.id}`,
        taskId: task.id,
        keys: ['id', 'taskId', 'title', 'minutes', 'complete'],
        extra: {},
      },
    )
    if (task.minutes === undefined) task.minutes = 0
    task.objectiveId = projectId
  } else delete task.objectiveId
}
function appendActivity(task: Task, activity: Activity, context: ActionContext) {
  task.activity = [...activityWithCreation(task, context), activity]
}
function activity(context: ActionContext, suffix: string, label: string): Activity {
  return taskActivity(context, suffix, label)
}
function schedule(
  doc: WorkspaceDocument,
  entity: Entity,
  dateKey: string,
  start: number,
  end: number,
  eventId?: string,
) {
  if (!validTaskSchedule(start, end)) throw new Error('Invalid task schedule')
  const task = taskContent(entity)
  detachSessionMembership(doc, entity.id)
  if (
    eventId &&
    !doc.entities.some((e) => e.kind === 'event' && e.id === eventId && e.data.taskId === entity.id)
  )
    throw new Error('Calendar block no longer exists')
  const id =
    eventId ??
    nextTaskBlockId(
      entity.id,
      doc.entities.filter((e) => e.kind === 'event').map((e) => e.id),
    )
  doc.entities = doc.entities.filter((e) => e.kind !== 'event' || e.id !== id)
  doc.entities.push({
    kind: 'event',
    id,
    data: {
      position: doc.entities.filter((e) => e.kind === 'event').length,
      taskId: entity.id,
      derived: ['title', 'complete'],
      content: {
        id,
        ...(id !== entity.id ? { taskId: entity.id } : {}),
        dateKey,
        start,
        end,
        color: task.accent || 'violet',
      },
    },
  })
  syncTaskCalendarTiming(doc, entity.id)
  const lane = taskLane(doc, String(entity.data.lane))
  const positions = new Map(orderTasksByTime(lane.map(taskContent)).map((t, i) => [t.id, i]))
  lane.forEach((e) => {
    e.data.position = positions.get(e.id)!
  })
  orderSessionBoardLanes(doc, new Set([String(entity.data.lane)]))
}

/** All ownership, location and calendar consequences are applied before projecting any view. */
export function executeTaskCommand(
  input: WorkspaceDocument,
  command: TaskCommand,
  context: ActionContext,
): WorkspaceDocument {
  return editDocument(input, (doc) => {
    if (command.type === 'task.assign-many') {
      for (const taskId of new Set(command.taskIds)) {
        const entity = taskEntity(doc, taskId)
        if (!entity) throw new Error('Task no longer exists')
        assign(doc, taskContent(entity), command.projectId)
      }
      return
    }
    if (command.type === 'task.create') {
      for (const { task: input, lane } of command.tasks) {
        if (taskEntity(doc, input.id)) throw new Error('Task already exists')
        const task = structuredClone(input)
        delete task.todayStatus
        const entity: Entity = { kind: 'task', id: task.id, data: { content: task, lane, position: 0 } }
        const existing = taskLane(doc, lane)
        const incompleteEnd = existing.findIndex((e) => taskContent(e).complete)
        doc.entities.push(entity)
        setLane(
          doc,
          entity,
          lane,
          command.placement === 'first'
            ? 0
            : command.placement === 'before-completed' && incompleteEnd >= 0
              ? incompleteEnd
              : existing.length,
        )
        if (task.objectiveId) assign(doc, task, task.objectiveId, command.referencePrefix)
      }
      const sessionLanes = new Set(documentSessions(doc).map((session) => sessionLane(doc, session.dateKey)))
      // Explicit top insertion preserves the board's existing order, including session groups.
      if (command.placement !== 'first')
        orderSessionBoardLanes(
          doc,
          new Set(command.tasks.map(({ lane }) => lane).filter((lane) => sessionLanes.has(lane))),
        )
      return
    }
    const entity = taskEntity(doc, command.taskId)
    if (!entity) return
    let task = taskContent(entity)
    switch (command.type) {
      case 'task.assign':
        if (command.channel) task.channel = command.channel
        if (!Number.isFinite(task.minutes)) task.minutes = 30
        assign(doc, task, command.projectId)
        break
      case 'task.subtask.toggle':
        entity.data.content = toggleSubtaskInTasks(
          [task],
          task.id,
          command.subtaskId,
          context.now.getHours() * 60 + context.now.getMinutes(),
        )[0]!
        break
      case 'task.complete-undated': {
        if (!String(entity.data.lane).startsWith('backlog:') || task.complete) return
        if (command.activity) appendActivity(task, command.activity, context)
        const completed = completeUndatedTaskInTasks(
          taskLane(doc, 'today').map(taskContent),
          task,
          context.now.getHours() * 60 + context.now.getMinutes(),
        )
        const result = completed.find((t) => t.id === task.id)!
        result.completedDateKey = context.today
        entity.data.content = result
        setLane(
          doc,
          entity,
          'today',
          completed.findIndex((t) => t.id === task.id),
        )
        orderCompletionReferences(doc, task.id, true)
        return
      }
      case 'task.move': {
        if (entity.data.lane !== command.lane) detachSessionMembership(doc, entity.id)
        if (command.preparedTask) {
          task = { ...task, ...command.preparedTask, id: task.id }
          entity.data.content = task
        }
        if (command.channel) task.channel = command.channel
        if (command.projectId !== undefined) assign(doc, task, command.projectId)
        setLane(doc, entity, command.lane, command.index)
        if (command.lane.startsWith('backlog:')) {
          task.time = null
          doc.entities = doc.entities.filter((e) => e.kind !== 'event' || e.data.taskId !== task.id)
        }
        if (command.activity) appendActivity(task, command.activity, context)
        if (command.schedule)
          schedule(doc, entity, command.schedule.dateKey, command.schedule.start, command.schedule.end)
        break
      }
      case 'task.schedule': {
        setLane(doc, entity, command.dateKey === context.today ? 'today' : `date:${command.dateKey}`)
        schedule(doc, entity, command.dateKey, command.start, command.end, command.eventId)
        appendActivity(task, activity(context, 'schedule', 'updated the schedule'), context)
        break
      }
      case 'task.unschedule':
        detachSessionMembership(doc, task.id)
        doc.entities = doc.entities.filter(
          (e) =>
            e.kind !== 'event' ||
            e.data.taskId !== task.id ||
            (command.eventId !== undefined && e.id !== command.eventId),
        )
        syncTaskCalendarTiming(doc, task.id)
        appendActivity(task, activity(context, 'unschedule', 'removed this from the calendar'), context)
        orderSessionBoardLanes(doc, new Set([String(entity.data.lane)]))
        break
    }
    return
  })
}

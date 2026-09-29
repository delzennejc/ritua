import { copyRecord, editDocument } from './workspace-immutable'
import { minutesLabel } from './time-format'
import type { Data, Entity, WorkspaceDocument } from './workspace-types'
import type { Task } from './models'

import { activityWithCreation } from './task-activity'
import { taskContent } from './workspace-selectors'
import { orderTasksByTime } from './tasks'
import { orderSessionBoardLanes } from './session-board-order'

/** A task's content is changed once; project and calendar views derive from that record. */
export function mutateWorkspaceTask(
  input: WorkspaceDocument,
  taskId: string,
  mutate: (task: Task) => Task,
  propagateSubtasks = false,
): WorkspaceDocument {
  return editDocument(input, (document) => {
    const entity = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (!entity) return
    const next = mutate(taskContent(entity))
    if (next.id !== taskId) throw new Error('Task editing cannot change identity')
    entity.data.content = next
    if (propagateSubtasks) propagateSessionTaskProperties(document, entity, { subtasks: next.subtasks }, {})
    return
  })
}

export function updateWorkspaceTaskTiming(
  input: WorkspaceDocument,
  taskId: string,
  time: string | null,
  minutes?: number,
): WorkspaceDocument {
  return editDocument(input, (document) => {
    const entity = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (!entity) return
    const task = taskContent(entity)
    entity.data.content = {
      ...task,
      time,
      ...(minutes === undefined ? {} : { minutes, durationLabel: syncedDurationLabel(task, minutes) }),
    }
    const lane = document.entities.filter(
      (item) => item.kind === 'task' && item.data.lane === entity.data.lane,
    )
    const positions = new Map(
      orderTasksByTime(
        lane.sort((a, b) => Number(a.data.position) - Number(b.data.position)).map(taskContent),
      ).map((task, index) => [task.id, index]),
    )
    for (const item of lane) item.data.position = positions.get(item.id)!
    orderSessionBoardLanes(document, new Set([String(entity.data.lane)]))
    return
  })
}

export function syncedDurationLabel(task: Task, minutes: number): string | undefined {
  if (!task.durationLabel) return task.durationLabel
  const planned = minutesLabel(minutes)
  if (!task.durationLabel.includes('/')) return planned
  const actual =
    task.actualMinutes !== undefined
      ? minutesLabel(task.actualMinutes)
      : task.durationLabel.split('/')[0]!.trim()
  return `${actual} / ${planned}`
}

export function editWorkspaceTask(
  input: WorkspaceDocument,
  taskId: string,
  patch: Partial<Omit<Task, 'id'>>,
  context: {
    actor: string
    now: Date
    unlinkFromProject?: boolean
    deferSessionPropagation?: boolean
  },
): WorkspaceDocument {
  return editDocument(input, (document) => {
    const entity = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (!entity) return
    const task = taskContent(entity)
    const blocks = document.entities.filter((e) => e.kind === 'event' && e.data.taskId === taskId)
    if (patch.minutes !== undefined && blocks.length > 1)
      throw new Error('Edit individual calendar blocks to change scheduled time')
    const next = { ...task, ...patch }
    if (task.durationLabel) {
      if (!task.durationLabel.includes('/')) {
        if (patch.minutes !== undefined) next.durationLabel = minutesLabel(next.minutes)
      } else {
        const [previousActual, previousPlanned] = task.durationLabel.split('/').map((part) => part.trim())
        next.durationLabel = `${patch.actualMinutes === undefined ? previousActual : minutesLabel(next.actualMinutes)} / ${patch.minutes === undefined ? previousPlanned : minutesLabel(next.minutes)}`
      }
    }
    if (patch.notes !== undefined && patch.notes !== task.notes) {
      const withCreation = activityWithCreation(task, context)
      if (withCreation.at(-1)?.kind !== 'note-edited')
        next.activity = [
          ...withCreation,
          {
            id: `activity-${context.now.getTime()}-note`,
            kind: 'note-edited',
            label: `${context.actor} edited the note`,
            time: 'now',
          },
        ]
    }
    if (context.unlinkFromProject) {
      delete next.objectiveId
      for (const owner of document.entities.filter(
        (entity) => entity.kind === 'project' && entity.data.collection === 'weeklyObjectives',
      ))
        owner.data.links = (owner.data.links as Data[]).filter((link) => link.taskId !== taskId)
    }
    entity.data.content = next
    if (!context.deferSessionPropagation) propagateSessionTaskProperties(document, entity, patch, context)
    extendTaskReferences(
      document,
      taskId,
      Object.keys(patch).filter(
        (key) =>
          ['title', 'minutes', 'actualMinutes'].includes(key) &&
          patch[key as keyof typeof patch] !== undefined,
      ),
    )
    for (const event of document.entities.filter(
      (entity) => entity.kind === 'event' && entity.data.taskId === taskId,
    )) {
      const content = event.data.content as Data
      if (patch.channel !== undefined) content.color = patch.accent ?? task.accent ?? 'violet'
      if (patch.minutes !== undefined) content.end = Number(content.start) + Number(patch.minutes)
    }
    return
  })
}

/** Apply a queued series edit against the latest canonical document after the current task is visible. */
export function propagateWorkspaceSessionTaskProperties(
  input: WorkspaceDocument,
  taskId: string,
  patch: Partial<Omit<Task, 'id'>>,
  context: { unlinkFromProject?: boolean } = {},
): WorkspaceDocument {
  return editDocument(input, (document) => {
    const selected = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (selected) propagateSessionTaskProperties(document, selected, patch, context)
  })
}

/** Keep a recurring session's task definition and later copies aligned with a property edit. */
export function propagateSessionTaskProperties(
  document: WorkspaceDocument,
  selected: Entity,
  patch: Partial<Omit<Task, 'id'>>,
  context: { unlinkFromProject?: boolean },
) {
  const properties = [
    'title',
    'channel',
    'accent',
    'objectiveId',
    'minutes',
    'notes',
    'media',
    'subtasks',
  ] as const
  const changed = properties.filter((key) => Object.hasOwn(patch, key))
  if (!changed.length) return
  const sessions = document.entities.filter(
    (entity) =>
      entity.kind === 'event' &&
      (entity.data.content as Data).kind === 'session' &&
      ((entity.data.content as Data).taskIds as string[]).includes(selected.id) &&
      typeof (entity.data.content as Data).recurrenceSeriesId === 'string',
  )
  const source = sessions[0]
  if (!source) return
  const sourceSession = source.data.content as Data
  const seriesId = String(sourceSession.recurrenceSeriesId)
  const sourceIndex = (sourceSession.taskIds as string[]).indexOf(selected.id)
  const sourceTask = taskContent(selected)
  const definition = ((document.fields.sessionRecurrenceDefinitions ?? {}) as Data)[seriesId] as
    | Data
    | undefined
  const templates = (definition?.tasks ?? []) as Data[]
  const generatedPrefix = `${source.id}-task-`
  const generatedIndex = selected.id.startsWith(generatedPrefix)
    ? Number(selected.id.slice(generatedPrefix.length)) - 1
    : -1
  const markedIndex = sourceTask.sessionRecurrenceTaskId
    ? templates.findIndex(
        (template) => template.sessionRecurrenceTaskId === sourceTask.sessionRecurrenceTaskId,
      )
    : -1
  const templateIndex = markedIndex >= 0 ? markedIndex : generatedIndex >= 0 ? generatedIndex : sourceIndex
  if (templateIndex < 0 || templateIndex >= templates.length) return // Ad-hoc tasks are local.
  const marker = String(
    sourceTask.sessionRecurrenceTaskId ??
      templates[templateIndex]!.sessionRecurrenceTaskId ??
      `${seriesId}-task-${templateIndex + 1}`,
  )
  sourceTask.sessionRecurrenceTaskId = marker
  const apply = (target: Data, template = false) => {
    for (const key of changed) {
      const value = sourceTask[key]
      if (value === undefined) delete target[key]
      else if (key === 'subtasks')
        target.subtasks = repeatedSubtasks(value as Data[], (target.subtasks ?? []) as Data[], template)
      else target[key] = copyRecord(value as Data[keyof Data])
    }
    if (patch.minutes !== undefined && target.durationLabel) {
      const label = syncedDurationLabel(target as Task, Number(patch.minutes))
      if (label === undefined) delete target.durationLabel
      else target.durationLabel = label
    }
    if (patch.channel !== undefined && context.unlinkFromProject) delete target.objectiveId
    target.sessionRecurrenceTaskId = marker
  }
  const updatedTemplates = templates.map((template, index) => {
    if (index !== templateIndex) return template
    const next = copyRecord(template)
    apply(next, true)
    return next
  })
  ;((document.fields.sessionRecurrenceDefinitions ?? {}) as Data)[seriesId] = {
    ...definition,
    tasks: updatedTemplates,
  }
  const taskEntities = new Map(
    document.entities.filter((entity) => entity.kind === 'task').map((entity) => [entity.id, entity]),
  )
  for (const session of sessionsInSeries(document, seriesId, String(sourceSession.dateKey))) {
    if (session.id === source.id) continue
    const ids = (session.data.content as Data).taskIds as string[]
    const matchingId = ids.find((id) => {
      const entity = taskEntities.get(id)
      return (
        entity &&
        (taskContent(entity).sessionRecurrenceTaskId === marker ||
          (!taskContent(entity).sessionRecurrenceTaskId && id === `${session.id}-task-${templateIndex + 1}`))
      )
    })
    if (!matchingId) continue
    const target = taskEntities.get(matchingId)!
    const task = taskContent(target) as Data
    apply(task)
    extendTaskReferences(
      document,
      matchingId,
      changed.filter((key) => key === 'title' || key === 'minutes'),
    )
    if (changed.includes('objectiveId') || (patch.channel !== undefined && context.unlinkFromProject))
      syncTaskProjectLink(document, matchingId, task)
  }
}

function repeatedSubtasks(source: Data[], previous: Data[], template: boolean): Data[] {
  const existing = new Map(previous.map((item) => [item.id, item]))
  return source.map((item) => {
    const prior = existing.get(item.id)
    const next = copyRecord(item)
    next.complete = template ? false : (prior?.complete ?? false)
    for (const key of ['actualMinutes', 'completedAtMinute']) {
      if (template || prior?.[key] === undefined) delete next[key]
      else next[key] = prior[key]
    }
    return next
  })
}

function syncTaskProjectLink(document: WorkspaceDocument, taskId: string, task: Data) {
  const projects = document.entities.filter(
    (entity) => entity.kind === 'project' && entity.data.collection === 'weeklyObjectives',
  )
  const existing = projects
    .flatMap((project) => project.data.links as Data[])
    .find((link) => link.taskId === taskId)
  const owner = projects.find((project) => (project.data.content as Data).id === task.objectiveId)
  if (owner && (owner.data.links as Data[]).some((link) => link.taskId === taskId)) return
  for (const project of projects)
    project.data.links = (project.data.links as Data[]).filter((link) => link.taskId !== taskId)
  if (!task.objectiveId) return
  if (!owner) {
    delete task.objectiveId
    return
  }
  owner.data.hasTasks = true
  ;(owner.data.links as Data[]).push(
    existing ?? {
      id: `objective-${taskId}`,
      taskId,
      keys: ['id', 'taskId', 'title', 'minutes', 'complete'],
      extra: {},
    },
  )
}

function sessionsInSeries(document: WorkspaceDocument, seriesId: string, fromDate: string) {
  return document.entities.filter((entity) => {
    if (entity.kind !== 'event') return false
    const session = entity.data.content as Data
    return (
      session.kind === 'session' &&
      session.recurrenceSeriesId === seriesId &&
      String(session.dateKey) >= fromDate
    )
  })
}

function extendTaskReferences(document: WorkspaceDocument, taskId: string, keys: string[]) {
  for (const owner of document.entities.filter((entity) => entity.kind === 'project')) {
    for (const link of owner.data.links as Data[])
      if (link.taskId === taskId) link.keys = [...new Set([...(link.keys as string[]), ...keys])]
  }
}

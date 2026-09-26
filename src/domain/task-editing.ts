import { editDocument } from './workspace-immutable'
import { minutesLabel } from './time-format'
import type { WorkspaceDocument } from './workspace-types'
import type { Task } from './models'

import { type Data } from './workspace'
import { activityWithCreation } from './task-activity'
import { taskContent } from './workspace-selectors'
import { orderTasksByTime } from './tasks'
import { orderSessionBoardLanes } from './session-board-order'

/** A task's content is changed once; project and calendar views derive from that record. */
export function mutateWorkspaceTask(
  input: WorkspaceDocument,
  taskId: string,
  mutate: (task: Task) => Task,
): WorkspaceDocument {
  return editDocument(input, (document) => {
    const entity = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (!entity) return
    const next = mutate(taskContent(entity))
    if (next.id !== taskId) throw new Error('Task editing cannot change identity')
    entity.data.content = next
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

function extendTaskReferences(document: WorkspaceDocument, taskId: string, keys: string[]) {
  for (const owner of document.entities.filter((entity) => entity.kind === 'project')) {
    for (const link of owner.data.links as Data[])
      if (link.taskId === taskId) link.keys = [...new Set([...(link.keys as string[]), ...keys])]
  }
}

import { editDocument, copyRecord } from './workspace-immutable'
import type { Entity } from './workspace-types'
import type { Json } from './workspace-types'
import type { WorkspaceDocument } from './workspace-types'
import { type Data } from './workspace'
import { taskContent } from './workspace-selectors'

export type DeletionScope = 'single' | 'following'
type RemovedLink = { ownerId: string; index: number; value: Data }
type RemovedSessionMember = { sessionId: string; index: number; taskId: string }
export type TaskDeletionUndo = {
  entities: Entity[]
  projectLinks: RemovedLink[]
  sessionMembers: RemovedSessionMember[]
  stoppedSeriesId: string | null
  previousSeriesStop: Json | undefined
}

/** Delete canonical work and every reference in one edit, retaining only what Undo needs. */
export function deleteWorkspaceTask(
  input: WorkspaceDocument,
  taskId: string,
  scope: DeletionScope = 'single',
) {
  return deleteWorkspaceTasks(input, [taskId], scope)
}
export function deleteWorkspaceTasks(
  input: WorkspaceDocument,
  taskIds: string[],
  scope: DeletionScope = 'single',
) {
  const taskId = taskIds[0]

  let undo!: TaskDeletionUndo
  let deletedIds!: Set<string>
  let following = false
  const result = editDocument(input, (document) => {
    const selected = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    const task = selected ? taskContent(selected) : undefined
    const seriesId = scope === 'following' ? task?.recurrenceSeriesId : undefined
    deletedIds = new Set(taskIds)
    if (seriesId && Number.isFinite(task?.recurrenceIndex)) {
      for (const entity of document.entities) {
        if (entity.kind !== 'task') continue
        const candidate = taskContent(entity)
        if (
          candidate.recurrenceSeriesId === seriesId &&
          Number(candidate.recurrenceIndex) >= task!.recurrenceIndex!
        )
          deletedIds.add(entity.id)
      }
    }
    const stops = (document.fields.recurrenceStops ?? {}) as Data
    undo = {
      entities: [],
      projectLinks: [],
      sessionMembers: [],
      stoppedSeriesId: seriesId ?? null,
      previousSeriesStop: seriesId ? stops[seriesId] : undefined,
    }
    if (seriesId) document.fields.recurrenceStops = { ...stops, [seriesId]: true }
    document.entities = document.entities.filter((entity) => {
      if (
        (entity.kind === 'task' && deletedIds.has(entity.id)) ||
        (entity.kind === 'event' && deletedIds.has(String(entity.data.taskId)))
      ) {
        undo.entities.push(copyRecord(entity))
        return false
      }
      if (entity.kind === 'project') {
        entity.data.links = (entity.data.links as Data[]).filter((link, index) => {
          if (!deletedIds.has(String(link.taskId))) return true
          undo.projectLinks.push({ ownerId: entity.id, index, value: copyRecord(link) })
          return false
        })
      }
      if (entity.kind === 'event') {
        const content = entity.data.content as Data
        if (content.kind === 'session')
          content.taskIds = (content.taskIds as string[]).filter((id, index) => {
            if (!deletedIds.has(id)) return true
            undo.sessionMembers.push({ sessionId: entity.id, index, taskId: id })
            return false
          })
      }
      return true
    })
    following = Boolean(seriesId)
  })
  return { document: result, undo, deletedIds: [...deletedIds], following }
}

/** Restore removed records in place, leaving subsequent edits and newly created work intact. */
export function undoWorkspaceTaskDeletion(
  input: WorkspaceDocument,
  undo: TaskDeletionUndo,
): WorkspaceDocument {
  return editDocument(input, (document) => {
    for (const saved of [...undo.entities].sort(
      (a, b) =>
        Number(a.kind !== 'task') - Number(b.kind !== 'task') ||
        Number(a.data.position) - Number(b.data.position),
    )) {
      if (document.entities.some((entity) => entity.kind === saved.kind && entity.id === saved.id)) continue
      if (
        saved.kind === 'task' &&
        String(saved.data.lane).startsWith('project:') &&
        !document.entities.some(
          (entity) => entity.kind === 'project' && `project:${entity.id}` === saved.data.lane,
        )
      )
        continue
      if (
        saved.kind === 'event' &&
        saved.data.taskId &&
        !document.entities.some((entity) => entity.kind === 'task' && entity.id === saved.data.taskId)
      )
        continue
      const peers = document.entities
        .filter(
          (entity) =>
            entity.kind === saved.kind && (saved.kind !== 'task' || entity.data.lane === saved.data.lane),
        )
        .sort((a, b) => Number(a.data.position) - Number(b.data.position))
      const restored = copyRecord(saved)
      peers.splice(Math.min(Number(saved.data.position), peers.length), 0, restored)
      peers.forEach((entity, position) => {
        entity.data.position = position
      })
      document.entities.push(restored)
      if (saved.kind === 'task' && String(saved.data.lane).startsWith('date:')) {
        document.fields.dateKeys = [
          ...new Set([...(document.fields.dateKeys as string[]), String(saved.data.lane).slice(5)]),
        ]
      }
    }
    const tasks = new Set(
      document.entities.filter((entity) => entity.kind === 'task').map((entity) => entity.id),
    )
    for (const entry of undo.projectLinks) {
      const owner = document.entities.find(
        (entity) => entity.kind === 'project' && entity.id === entry.ownerId,
      )
      if (!owner || !tasks.has(String(entry.value.taskId))) continue
      const links = owner.data.links as Data[]
      if (!links.some((link) => link.taskId === entry.value.taskId))
        links.splice(Math.min(entry.index, links.length), 0, copyRecord(entry.value))
    }
    for (const entry of undo.sessionMembers) {
      const owner = document.entities.find(
        (entity) => entity.kind === 'event' && entity.id === entry.sessionId,
      )
      const content = owner?.data.content as Data | undefined
      if (content?.kind !== 'session' || !tasks.has(entry.taskId)) continue
      const ids = content.taskIds as string[]
      if (!ids.includes(entry.taskId)) ids.splice(Math.min(entry.index, ids.length), 0, entry.taskId)
    }
    if (undo.stoppedSeriesId) {
      const stops = { ...(document.fields.recurrenceStops as Data) }
      if (undo.previousSeriesStop === undefined) delete stops[undo.stoppedSeriesId]
      else stops[undo.stoppedSeriesId] = undo.previousSeriesStop
      document.fields.recurrenceStops = stops
    }
  })
}

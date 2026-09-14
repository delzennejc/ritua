import type { WorkspaceDocument, Data } from './workspace-types'
import type { Area, RecurrenceDefinition } from './models'
import { editDocument, copyRecord } from './workspace-immutable'
import { taskContent } from './workspace-selectors'
import { deleteWorkspaceTasks } from './task-deletion'
const areaEntity = (doc: WorkspaceDocument, id: string) =>
  doc.entities.find((e) => e.kind === 'area' && e.id === id)
const definitions = (doc: WorkspaceDocument) =>
  (doc.fields.recurrenceDefinitions ?? {}) as Record<string, RecurrenceDefinition>
export function renameWorkspaceArea(
  input: WorkspaceDocument,
  areaId: string,
  nextLabel: string,
): WorkspaceDocument {
  return editDocument(input, (doc) => {
    const entity = areaEntity(doc, areaId),
      label = nextLabel.trim()
    if (!entity || !label) return
    if (
      doc.entities.some(
        (e) =>
          e.kind === 'area' &&
          e.id !== areaId &&
          String((e.data.content as Data).label).localeCompare(label, undefined, {
            sensitivity: 'accent',
          }) === 0,
      )
    )
      throw new Error(`An Area named ${label} already exists.`)
    const area = entity.data.content as Data,
      previous = area.label
    area.label = label
    for (const entity of doc.entities)
      if (entity.kind === 'task' || entity.kind === 'project') {
        const content = entity.data.content as Data
        if (content.channel === previous) content.channel = label
      }
    for (const definition of Object.values(definitions(doc)))
      if (definition.task.channel === previous) definition.task.channel = label
  })
}
export function colorWorkspaceArea(
  input: WorkspaceDocument,
  areaId: string,
  color: Pick<Area, 'accent' | 'color'>,
): WorkspaceDocument {
  return editDocument(input, (doc) => {
    const entity = areaEntity(doc, areaId)
    if (!entity) return
    const area = entity.data.content as Data
    Object.assign(area, color)
    for (const definition of Object.values(definitions(doc)))
      if (definition.task.channel === area.label) {
        definition.task.accent = color.accent
        if (definition.event) definition.event.color = color.accent
      }
  })
}
function resetScope(doc: WorkspaceDocument, areaId: string, projectIds: Set<string>) {
  if (
    doc.fields.taskScope === `area:${areaId}` ||
    projectIds.has(String(doc.fields.taskScope).replace(/^project:/, ''))
  )
    doc.fields.taskScope = 'anytime'
}
export function archiveWorkspaceArea(input: WorkspaceDocument, areaId: string, now: Date): WorkspaceDocument {
  return editDocument(input, (doc) => {
    const entity = areaEntity(doc, areaId)
    if (!entity) return
    const area = entity.data.content as Data
    doc.fields.archivedAreas = [
      ...((doc.fields.archivedAreas ?? []) as Data[]).filter((entry) => (entry.area as Data).id !== areaId),
      { area: copyRecord(area), position: entity.data.position!, archivedAt: now.toISOString() },
    ]
    doc.entities = doc.entities.filter((e) => e !== entity)
    resetScope(
      doc,
      areaId,
      new Set(
        doc.entities
          .filter(
            (e) =>
              e.kind === 'project' &&
              e.data.collection === 'weeklyObjectives' &&
              (e.data.content as Data).channel === area.label,
          )
          .map((e) => String((e.data.content as Data).id)),
      ),
    )
  })
}
export function deleteWorkspaceArea(input: WorkspaceDocument, areaId: string) {
  const area = areaEntity(input, areaId)?.data.content as Data | undefined
  if (!area) return { document: input, deletedTaskIds: [] as string[] }
  const projects = input.entities.filter(
    (e) => e.kind === 'project' && (e.data.content as Data).channel === area.label,
  )
  const projectIds = new Set(
    projects
      .filter((e) => e.data.collection === 'weeklyObjectives')
      .map((e) => String((e.data.content as Data).id)),
  )
  const linkedIds = new Set(
    projects.flatMap((e) => (e.data.links as Data[]).map((link) => String(link.taskId))),
  )
  const deletedTaskIds = input.entities
    .filter(
      (e) =>
        e.kind === 'task' &&
        (taskContent(e).channel === area.label ||
          projectIds.has(taskContent(e).objectiveId ?? '') ||
          linkedIds.has(e.id)),
    )
    .map((e) => e.id)
  const removed = deleteWorkspaceTasks(input, deletedTaskIds).document
  const document = editDocument(removed, (doc) => {
    for (const [id, definition] of Object.entries(definitions(doc)))
      if (definition.task.channel === area.label || projectIds.has(definition.task.objectiveId ?? ''))
        (doc.fields.recurrenceStops as Data)[id] = true
    doc.entities = doc.entities.filter(
      (e) =>
        !(e.kind === 'area' && e.id === areaId) &&
        !(
          e.kind === 'project' &&
          e.data.collection === 'weeklyObjectives' &&
          projectIds.has(String((e.data.content as Data).id))
        ),
    )
    doc.fields.weeklyObjectiveOrder = ((doc.fields.weeklyObjectiveOrder ?? []) as string[]).filter(
      (id) => !projectIds.has(id),
    )
    resetScope(doc, areaId, projectIds)
  })
  return { document, deletedTaskIds }
}

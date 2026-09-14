import { collectionCommand } from './workspace-collection-command'
import { copyRecord } from './workspace-immutable'
import type { WorkspaceDocument } from './workspace-types'
import type { WorkspaceFields } from './workspace-collections'
import type { Task } from './models'
import type { Fields } from './workspace-types'
import type { Project } from './models'

import { workspaceCollections } from './workspace-collections'

type ArchivedProject = Project & {
  archivedSeriesIds: string[]
  archiveWeeklyOrderIndex: number
  archivePosition: number
  archivedAt: string
}
export type ProjectUndo = {
  action: 'archive' | 'delete'
  project: Project
  position: number
  weeklyOrderIndex: number
  linkedTaskIds: string[]
  linkedSeriesIds: string[]
  previousTaskScope: string
  fallbackTaskScope: string
}
function mapLocatedTasks(fields: WorkspaceFields, update: (task: Task) => Task) {
  fields.tasks = fields.tasks.map(update)
  fields.datedTasksByDate = Object.fromEntries(
    Object.entries(fields.datedTasksByDate).map(([date, tasks]) => [date, tasks.map(update)]),
  )
  fields.backlogGroups = fields.backlogGroups.map((group) => ({ ...group, items: group.items.map(update) }))
}

function removeWorkspaceProjectView(
  fields: Fields,
  projectId: string,
  action: ProjectUndo['action'],
  now: Date,
) {
  const next = workspaceCollections(fields)
  const position = next.weeklyObjectives.findIndex((project) => project.id === projectId)
  if (position < 0) return null
  const project = next.weeklyObjectives[position]!
  const area = next.areas.find((area) => area.label === project.channel)
  const undo: ProjectUndo = {
    action,
    project: copyRecord(project),
    position,
    weeklyOrderIndex: next.weeklyObjectiveOrder.indexOf(projectId),
    linkedTaskIds: [],
    linkedSeriesIds: [],
    previousTaskScope: next.taskScope ?? 'anytime',
    fallbackTaskScope: area ? `area:${area.id}` : 'anytime',
  }
  const unlink = (task: Task) => {
    if (task.objectiveId !== projectId) return task
    const next = { ...task }
    delete next.objectiveId
    return next
  }
  mapLocatedTasks(next, (task) => {
    if (task.objectiveId === projectId) undo.linkedTaskIds.push(task.id)
    return unlink(task)
  })
  for (const [id, definition] of Object.entries(next.recurrenceDefinitions)) {
    if (definition.task.objectiveId === projectId) undo.linkedSeriesIds.push(id)
    definition.task = unlink(definition.task)
  }
  next.weeklyObjectives.splice(position, 1)
  next.weeklyObjectiveOrder = next.weeklyObjectiveOrder.filter((id) => id !== projectId)
  if (action === 'archive') {
    const archived: ArchivedProject = {
      ...project,
      archivedSeriesIds: undo.linkedSeriesIds,
      archiveWeeklyOrderIndex: undo.weeklyOrderIndex,
      archivePosition: position,
      archivedAt: now.toISOString(),
    }
    next.archivedObjectives = [...next.archivedObjectives.filter((item) => item.id !== projectId), archived]
  }
  if (next.taskScope === `project:${projectId}`) next.taskScope = undo.fallbackTaskScope
  return { fields: next, undo }
}
export function removeWorkspaceProject(
  document: WorkspaceDocument,
  projectId: string,
  action: ProjectUndo['action'],
  now: Date,
) {
  return collectionCommand(document, (fields) => removeWorkspaceProjectView(fields, projectId, action, now))
}

function undoWorkspaceProjectRemovalView(fields: Fields, undo: ProjectUndo): Fields {
  const next = workspaceCollections(fields),
    projectId = undo.project.id
  const ids = new Set(undo.linkedTaskIds)
  mapLocatedTasks(next, (task) =>
    ids.has(task.id) && !task.objectiveId ? { ...task, objectiveId: projectId } : task,
  )
  for (const id of undo.linkedSeriesIds) {
    const definition = next.recurrenceDefinitions[id]
    if (definition && !definition.task.objectiveId) definition.task.objectiveId = projectId
  }
  const currentTasks = new Map(
    [
      ...next.archivedObjectives
        .flatMap((project) => project.tasks || [])
        .map((task) => ({ ...task, id: task.taskId || task.id })),
      ...next.tasks,
      ...Object.values(next.datedTasksByDate).flat(),
      ...next.backlogGroups.flatMap((group) => group.items),
    ].map((task) => [task.id, task]),
  )
  const restoredProject = structuredClone(undo.project)
  if (restoredProject.tasks)
    restoredProject.tasks = restoredProject.tasks.filter((member) => {
      const id = member.taskId || member.id
      const current = currentTasks.get(id)
      return current ? !current.objectiveId || current.objectiveId === projectId : !ids.has(id)
    })
  if (!next.weeklyObjectives.some((project) => project.id === projectId))
    next.weeklyObjectives.splice(Math.min(undo.position, next.weeklyObjectives.length), 0, restoredProject)
  if (undo.action === 'archive')
    next.archivedObjectives = next.archivedObjectives.filter((project) => project.id !== projectId)
  if (undo.weeklyOrderIndex >= 0 && !next.weeklyObjectiveOrder.includes(projectId))
    next.weeklyObjectiveOrder.splice(
      Math.min(undo.weeklyOrderIndex, next.weeklyObjectiveOrder.length),
      0,
      projectId,
    )
  if (undo.previousTaskScope === `project:${projectId}` && next.taskScope === undo.fallbackTaskScope)
    next.taskScope = undo.previousTaskScope
  return next
}
export function undoWorkspaceProjectRemoval(document: WorkspaceDocument, undo: ProjectUndo) {
  return collectionCommand(document, (fields) => undoWorkspaceProjectRemovalView(fields, undo))
}

/** Project details update canonical linked tasks and recurrence templates in the same operation. */
function editWorkspaceProjectView(
  fields: Fields,
  projectId: string,
  patch: Partial<Project>,
  accent?: string,
): Fields {
  const next = workspaceCollections(fields)
  next.weeklyObjectives = next.weeklyObjectives.map((project) =>
    project.id === projectId ? { ...project, ...patch, id: project.id } : project,
  )
  if (patch.channel) {
    const linkedIds = new Set<string>()
    const update = (task: Task): Task => {
      if (task.objectiveId !== projectId) return task
      linkedIds.add(task.id)
      return {
        ...task,
        channel: patch.channel,
        ...(task.accent !== undefined ? { accent: accent || 'violet' } : {}),
      }
    }
    mapLocatedTasks(next, update)
    for (const definition of Object.values(next.recurrenceDefinitions)) {
      if (definition.task.objectiveId !== projectId) continue
      definition.task = update(definition.task)
      if (definition.event) definition.event.color = accent || 'violet'
    }
    next.events = next.events.map((event) =>
      linkedIds.has(event.id) ? { ...event, color: accent || 'violet' } : event,
    )
  }
  return next
}
export function editWorkspaceProject(
  document: WorkspaceDocument,
  projectId: string,
  patch: Partial<Project>,
  accent?: string,
) {
  return collectionCommand(document, (fields) => editWorkspaceProjectView(fields, projectId, patch, accent))
}

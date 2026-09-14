import type { Entity } from './workspace-types'
import type { Json } from './workspace-types'
import type { WorkspaceDocument } from './workspace-types'
import type { TaskLocation } from './models'
import type { Task, Project } from './models'

/** These selectors consume workspace records already checked at the native boundary. */
export function taskContent(entity: Entity): Task {
  if (entity.kind !== 'task') throw new Error('Expected a task entity')
  return taskFromJson(entity.data.content)
}
export function taskFromJson(value: Json): Task {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string'
  ) {
    throw new Error('Expected task content')
  }
  return value as Task
}
export function projectsFromJson(value: Json | undefined): Project[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Expected projects')
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.id !== 'string' ||
      typeof item.title !== 'string'
    )
      throw new Error('Expected project content')
    return item as Project
  })
}
export function selectTask(document: WorkspaceDocument, id: string): Task | undefined {
  const entity = document.entities.find((entity) => entity.kind === 'task' && entity.id === id)
  return entity ? taskContent(entity) : undefined
}
export function selectTasksInLane(document: WorkspaceDocument, lane: TaskLocation): Task[] {
  return document.entities
    .filter((entity) => entity.kind === 'task' && entity.data.lane === lane)
    .sort((first, second) => Number(first.data.position) - Number(second.data.position))
    .map(taskContent)
}

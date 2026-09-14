import { durableFields, sharedTaskFields } from './workspace-fields'
import type { WorkspaceDocument, Json, Data } from './workspace-types'
import { WorkspaceValidationError } from './workspace-errors'
import { editDocument } from './workspace-immutable'
import { collectionCommand } from './workspace-collection-command'

export type WorkspaceField = (typeof durableFields)[number]
export type TaskProjectionField = 'tasks' | 'datedTasksByDate' | 'backlogGroups' | 'events'
export type EditableWorkspaceField = Exclude<WorkspaceField, TaskProjectionField>
const taskProjections = new Set<string>(['tasks', 'datedTasksByDate', 'backlogGroups', 'events'])
const projectCollections = new Set<string>([
  'weeklyObjectives',
  'archivedObjectives',
  'weekly.accomplishedObjectives',
])

export function changeWorkspaceField(
  document: WorkspaceDocument,
  key: EditableWorkspaceField,
  value: Json,
): WorkspaceDocument {
  if (taskProjections.has(key)) throw new WorkspaceValidationError(`Use a domain command to change ${key}`)
  if (!durableFields.includes(key)) throw new WorkspaceValidationError(`Unknown workspace field ${key}`)
  if (!projectCollections.has(key) && key !== 'areas')
    return editDocument(document, (draft) => {
      draft.fields[key] = value
    })
  if (!Array.isArray(value)) throw new WorkspaceValidationError('Expected collection')
  const tasks = new Map(
    document.entities.filter((e) => e.kind === 'task').map((e) => [e.id, e.data.content as Data]),
  )
  const items =
    key === 'areas'
      ? value
      : (value as Data[]).map((item) => {
          if (!Array.isArray(item.tasks)) return item
          return {
            ...item,
            tasks: (item.tasks as Data[]).map((member) => {
              const canonical = tasks.get(String(member.taskId || member.id))
              if (!canonical) throw new WorkspaceValidationError('Project references missing task')
              const reference: Data = {}
              for (const [key, value] of Object.entries(member)) {
                if (!sharedTaskFields.has(key)) reference[key] = value
                else if (canonical[key] !== undefined) reference[key] = canonical[key]
              }
              return reference
            }),
          }
        })
  return collectionCommand(document, (fields) => ({ ...fields, [key]: items }))
}

import type { Task } from '../../../domain/models'
import type { Data, WorkspaceDocument } from '../../../domain/workspace-types'
import type { createBulkWorkspaceUpdateQueue } from './bulk-workspace-updates'

type TaskPatch = Partial<Omit<Task, 'id'>>

/** Combine rapid property edits before the worker updates the recurring copies. */
export function createRecurringTaskUpdateQueue(
  getDocument: () => WorkspaceDocument,
  bulkUpdates: ReturnType<typeof createBulkWorkspaceUpdateQueue>,
) {
  const pending = new Map<string, TaskPatch>()

  const enqueue = (taskId: string, patch: TaskPatch) => {
    if (!Object.keys(patch).length) return
    const document = getDocument()
    if (
      !document.entities.some((entity) => {
        if (entity.kind !== 'event') return false
        const session = entity.data.content as Data
        return (
          session.kind === 'session' &&
          typeof session.recurrenceSeriesId === 'string' &&
          (session.taskIds as string[]).includes(taskId)
        )
      })
    )
      return
    const merged = { ...(pending.get(taskId) ?? {}), ...patch }
    pending.set(taskId, merged)
    bulkUpdates.enqueue(
      `session-task-properties:${taskId}`,
      { type: 'session-task-properties', taskId, patch: merged },
      true,
      () => {
        if (pending.get(taskId) === merged) pending.delete(taskId)
      },
    )
  }

  return { enqueue }
}

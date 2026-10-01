import { selectTask } from '../../../domain/workspace-selectors'
import type { Data, WorkspaceDocument } from '../../../domain/workspace-types'

export type CompletionTarget = { taskId: string; subtaskId?: string } | { projectId: string }

export function completionTargetKey(target: CompletionTarget) {
  return JSON.stringify(
    'projectId' in target ? ['project', target.projectId] : ['task', target.taskId, target.subtaskId ?? null],
  )
}

export function readCompletionTarget(
  document: WorkspaceDocument,
  target: CompletionTarget,
): boolean | undefined {
  if ('projectId' in target) {
    const project = document.entities.find(
      (entity) => entity.kind === 'project' && (entity.data.content as Data).id === target.projectId,
    )
    return project ? Boolean((project.data.content as Data).complete) : undefined
  }
  const task = selectTask(document, target.taskId)
  if (!task) return undefined
  if (!target.subtaskId) return Boolean(task.complete)
  const subtask = task.subtasks?.find((item) => item.id === target.subtaskId)
  return subtask ? Boolean(subtask.complete) : undefined
}

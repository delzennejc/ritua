import type { Task } from './models'
import { toggleWorkspaceTaskCompletion } from './task-completion'
import { editDocument } from './workspace-immutable'
import type { WorkspaceDocument } from './workspace-types'
import { selectTask } from './workspace-selectors'

export type TodayBoardStatus = 'todo' | 'in-progress' | 'to-review' | 'done'

/** Completed tasks are displayed in Done; absent workflow state means Todo. */
export function todayBoardStatus(task: Task): TodayBoardStatus {
  if (task.complete) return 'done'
  return task.todayStatus ?? 'todo'
}

/**
 * Applies a Today board drop to the canonical task record. Completion effects
 * and workflow status are returned together so callers persist one workspace
 * commit and retain the standard Undo behavior.
 */
export function moveTaskToTodayBoard(
  input: WorkspaceDocument,
  taskId: string,
  status: TodayBoardStatus,
  now = new Date(),
): WorkspaceDocument {
  if (!['todo', 'in-progress', 'to-review', 'done'].includes(status))
    throw new Error('Invalid Today board status')

  const source = input.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
  if (!source) return input

  let next = input
  const task = selectTask(next, taskId)!
  if (status === 'done') {
    if (!task.complete) next = toggleWorkspaceTaskCompletion(next, taskId, now)
    return next
  }

  if (task.complete) next = toggleWorkspaceTaskCompletion(next, taskId, now)
  return editDocument(next, (document) => {
    const entity = document.entities.find((item) => item.kind === 'task' && item.id === taskId)
    if (!entity) return
    const content = entity.data.content as Task
    if (status === 'todo') delete content.todayStatus
    else content.todayStatus = status
    for (const project of document.entities.filter((item) => item.kind === 'project')) {
      const links = project.data.links as { taskId: string; keys: string[] }[]
      for (const link of links) {
        if (link.taskId === taskId && !link.keys.includes('todayStatus'))
          link.keys = [...link.keys, 'todayStatus']
      }
    }
  })
}

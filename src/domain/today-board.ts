import type { Task } from './models'
import { toggleWorkspaceTaskCompletion } from './task-completion'
import { editDocument } from './workspace-immutable'
import type { WorkspaceDocument } from './workspace-types'
import { selectTask } from './workspace-selectors'
import { pushTaskActivity } from './task-activity'

export type TodayBoardStatus = 'todo' | 'in-progress' | 'to-review' | 'done'
export type TodayBoardInsertion = { taskId: string; position: 'before' | 'after' }

const TODAY_BOARD_LABELS: Record<TodayBoardStatus, string> = {
  todo: 'Todo',
  'in-progress': 'In Progress',
  'to-review': 'To Review',
  done: 'Done',
}

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
  insertion?: TodayBoardInsertion,
  actor?: string,
): WorkspaceDocument {
  if (!['todo', 'in-progress', 'to-review', 'done'].includes(status))
    throw new Error('Invalid Today board status')

  const source = input.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
  if (!source) return input

  let next = input
  const task = selectTask(next, taskId)!
  const previousStatus = todayBoardStatus(task)
  if (status === 'done') {
    if (!task.complete) next = toggleWorkspaceTaskCompletion(next, taskId, now)
  } else if (task.complete) next = toggleWorkspaceTaskCompletion(next, taskId, now)
  return editDocument(next, (document) => {
    const entity = document.entities.find((item) => item.kind === 'task' && item.id === taskId)
    if (!entity) return
    const content = entity.data.content as Task
    if (status === 'todo') delete content.todayStatus
    else if (status !== 'done') content.todayStatus = status
    if (actor && previousStatus !== status)
      pushTaskActivity(content, { now, actor }, 'status', `moved this to ${TODAY_BOARD_LABELS[status]}`)
    if (insertion && insertion.taskId !== taskId) {
      const lane = document.entities
        .filter((item) => item.kind === 'task' && item.data.lane === entity.data.lane && item.id !== taskId)
        .sort((a, b) => Number(a.data.position) - Number(b.data.position))
      const anchorIndex = lane.findIndex(
        (item) => item.id === insertion.taskId && todayBoardStatus(item.data.content as Task) === status,
      )
      if (anchorIndex !== -1) {
        lane.splice(anchorIndex + (insertion.position === 'after' ? 1 : 0), 0, entity)
        lane.forEach((item, position) => {
          item.data.position = position
        })
      }
    }
    for (const project of document.entities.filter((item) => item.kind === 'project')) {
      const links = project.data.links as { taskId: string; keys: string[] }[]
      for (const link of links) {
        if (link.taskId === taskId && !link.keys.includes('todayStatus'))
          link.keys = [...link.keys, 'todayStatus']
      }
    }
  })
}

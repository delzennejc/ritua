import type { Task, Subtask, Attachment, Activity } from './models'
import type { WorkspaceDocument } from './workspace'
import { mutateWorkspaceTask } from './task-editing'
import { toggleWorkspaceTaskCompletion } from './task-completion'
import { toggleSubtaskInTasks } from './tasks'
import type { ActionContext } from './task-commands'
import { appendTaskActivity, taskActivity } from './task-activity'

export type TaskDetailCommand =
  | { type: 'subtask.edit'; taskId: string; subtaskId: string; patch: Partial<Omit<Subtask, 'id'>> }
  | { type: 'subtask.add'; taskId: string; subtask: Subtask }
  | { type: 'subtask.reorder'; taskId: string; subtaskId: string; index: number }
  | { type: 'subtask.toggle'; taskId: string; subtaskId: string }
  | { type: 'comment.add'; taskId: string; text: string; attachment?: Attachment | null }
  | { type: 'completion.toggle'; taskId: string }
function withActivity(task: Task, entry: Activity, context: ActionContext): Task {
  return appendTaskActivity(task, entry, context)
}
export function executeTaskDetailCommand(
  document: WorkspaceDocument,
  command: TaskDetailCommand,
  context: ActionContext,
): WorkspaceDocument {
  const next =
    command.type === 'completion.toggle'
      ? toggleWorkspaceTaskCompletion(document, command.taskId, context.now)
      : document
  return mutateWorkspaceTask(next, command.taskId, (task) => {
    const entry = (suffix: string, label: string): Activity => taskActivity(context, suffix, label)
    switch (command.type) {
      case 'subtask.edit':
        return {
          ...task,
          subtasks:
            typeof command.patch.title === 'string' && !command.patch.title.trim()
              ? task.subtasks?.filter((subtask) => subtask.id !== command.subtaskId)
              : task.subtasks?.map((subtask) =>
                  subtask.id === command.subtaskId ? { ...subtask, ...command.patch } : subtask,
                ),
        }
      case 'subtask.add':
        return withActivity(
          { ...task, subtasks: [...(task.subtasks ?? []), command.subtask] },
          entry('subtask', `added the subtask “${command.subtask.title}”`),
          context,
        )
      case 'subtask.reorder': {
        const tasks = [...(task.subtasks ?? [])],
          index = tasks.findIndex((item) => item.id === command.subtaskId)
        if (index < 0) return task
        const [moved] = tasks.splice(index, 1)
        tasks.splice(Math.max(0, Math.min(command.index, tasks.length)), 0, moved!)
        return { ...task, subtasks: tasks }
      }
      case 'subtask.toggle': {
        const subtask = task.subtasks?.find((item) => item.id === command.subtaskId)
        const next = toggleSubtaskInTasks(
          [task],
          task.id,
          command.subtaskId,
          context.now.getHours() * 60 + context.now.getMinutes(),
        )[0]!
        return withActivity(
          next,
          entry(
            'subtask-toggle',
            `marked “${subtask?.title || 'a subtask'}” ${subtask?.complete ? 'incomplete' : 'complete'}`,
          ),
          context,
        )
      }
      case 'comment.add':
        return withActivity(
          {
            ...task,
            comments: [
              ...(task.comments ?? []),
              {
                id: `comment-${context.now.getTime()}`,
                text: command.text,
                attachment: command.attachment || null,
                authorName: context.actor,
                time: 'now',
              },
            ],
          },
          entry('comment', 'commented'),
          context,
        )
      case 'completion.toggle':
        return withActivity(
          task,
          entry('complete', `marked this ${task.complete ? 'complete' : 'incomplete'}`),
          context,
        )
    }
  })
}

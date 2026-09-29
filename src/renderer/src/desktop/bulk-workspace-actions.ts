import type { Area, Project, Recurrence, Task } from '../../../domain/models'
import type { Data, WorkspaceDocument } from '../../../domain/workspace-types'
import { colorWorkspaceArea, propagateWorkspaceAreaRename } from '../../../domain/area-commands'
import { editWorkspaceProject } from '../../../domain/project-commands'
import {
  changeWorkspaceSessionColor,
  changeWorkspaceSessionRecurrence,
} from '../../../domain/session-recurrence'
import { changeWorkspaceRecurrence } from '../../../domain/task-recurrence'
import { executeTaskCommand } from '../../../domain/task-commands'
import { selectTask } from '../../../domain/workspace-selectors'
import { propagateWorkspaceSessionTaskProperties } from '../../../domain/task-editing'
import { createWorkspaceTasks, type CreateTaskRequest } from '../../../domain/task-creation'
import { backlogTaskDetailsAdapter } from '../app/utils/workspace-presenters'

export type BulkWorkspaceAction =
  | {
      type: 'session-recurrence'
      sessionId: string
      recurrence: Recurrence
      context: { today: string; seriesId: string; repeatTasks?: boolean }
    }
  | { type: 'session-color'; sessionId: string; color: string | null }
  | {
      type: 'task-recurrence'
      taskId: string
      recurrence: Recurrence
      context: { today: string; seriesId: string }
      areas: Area[]
    }
  | { type: 'area-rename'; previous: string; label: string }
  | { type: 'area-color'; areaId: string; color: Pick<Area, 'accent' | 'color'> }
  | { type: 'project-area'; projectId: string; patch: Partial<Project>; accent: string }
  | { type: 'session-task-properties'; taskId: string; patch: Partial<Omit<Task, 'id'>> }
  | {
      type: 'task-assign-many'
      taskIds: string[]
      projectId: string
      expected: Record<string, { objectiveId?: Task['objectiveId']; channel?: string }>
      context: { actor: string; today: string; now: string }
    }
  | {
      type: 'task-create-following'
      request: CreateTaskRequest
      firstTaskId: string
      context: { actor: string; today: string; now: string }
    }

export type BulkWorkspaceResult = {
  document: WorkspaceDocument
  activeTaskId?: string | null
}

export function applyBulkWorkspaceAction(
  document: WorkspaceDocument,
  action: BulkWorkspaceAction,
): BulkWorkspaceResult {
  switch (action.type) {
    case 'session-recurrence':
      return {
        document: changeWorkspaceSessionRecurrence(
          document,
          action.sessionId,
          action.recurrence,
          action.context,
        ),
      }
    case 'session-color':
      return { document: changeWorkspaceSessionColor(document, action.sessionId, action.color) }
    case 'task-recurrence':
      return changeWorkspaceRecurrence(document, action.taskId, action.recurrence, {
        ...action.context,
        prepareTask: (task) => backlogTaskDetailsAdapter(task, action.areas),
      })
    case 'area-rename':
      return { document: propagateWorkspaceAreaRename(document, action.previous, action.label) }
    case 'area-color':
      return { document: colorWorkspaceArea(document, action.areaId, action.color) }
    case 'project-area':
      return {
        document: editWorkspaceProject(document, action.projectId, action.patch, action.accent),
      }
    case 'session-task-properties': {
      const source = selectTask(document, action.taskId)
      return {
        document: source
          ? propagateWorkspaceSessionTaskProperties(document, action.taskId, action.patch, {
              unlinkFromProject: Object.hasOwn(action.patch, 'channel') && !source.objectiveId,
            })
          : document,
      }
    }
    case 'task-assign-many': {
      const project = document.entities.find(
        (entity) =>
          entity.kind === 'project' &&
          entity.data.collection === 'weeklyObjectives' &&
          (entity.data.content as Data).id === action.projectId,
      )
      if (!project || (project.data.content as Data).complete) return { document }
      const channel = String((project.data.content as Data).channel)
      const taskIds = action.taskIds.filter((id) => {
        const task = selectTask(document, id)
        const expected = action.expected[id]
        return (
          task &&
          expected &&
          task.objectiveId === expected.objectiveId &&
          task.channel === expected.channel &&
          task.channel === channel
        )
      })
      return {
        document: taskIds.length
          ? executeTaskCommand(
              document,
              { type: 'task.assign-many', taskIds, projectId: action.projectId },
              { ...action.context, now: new Date(action.context.now) },
            )
          : document,
      }
    }
    case 'task-create-following': {
      const source = selectTask(document, action.firstTaskId)
      if (!source || source.recurrence?.frequency === 'none') return { document }
      const event = document.entities.find(
        (entity) => entity.kind === 'event' && entity.data.taskId === action.firstTaskId,
      )
      const eventContent = event?.data.content as Data | undefined
      const request: CreateTaskRequest = {
        ...action.request,
        title: source.title,
        area: source.channel ?? action.request.area,
        accent: source.accent ?? action.request.accent,
        minutes: source.minutes ?? action.request.minutes,
        objectiveId: source.objectiveId ?? undefined,
        recurrence: source.recurrence ?? action.request.recurrence,
        schedule: eventContent
          ? { start: Number(eventContent.start), end: Number(eventContent.end) }
          : undefined,
        todayStatus: undefined,
      }
      return {
        document: createWorkspaceTasks(
          document,
          request,
          { ...action.context, now: new Date(action.context.now) },
          { skipExisting: true },
        ).document,
      }
    }
  }
}

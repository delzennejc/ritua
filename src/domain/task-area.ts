import type { Task } from './models'
import type { WorkspaceDocument, Data } from './workspace-types'
import { selectTask } from './workspace-selectors'
import { editWorkspaceTask } from './task-editing'
import { editDocument, copyRecord } from './workspace-immutable'

type EditContext = { actor: string; now: Date }
export type TaskAreaUndo = {
  task: Task
  channel: string
  previousAreaId?: string
  removedProjectId: string | null
  projectEntries: { index: number; item: Data }[]
}
const areas = (document: WorkspaceDocument) =>
  document.entities.filter((e) => e.kind === 'area').map((e) => e.data.content as Data)
const projects = (document: WorkspaceDocument) =>
  document.entities.filter((e) => e.kind === 'project' && e.data.collection === 'weeklyObjectives')
export function moveWorkspaceTaskArea(
  document: WorkspaceDocument,
  taskId: string,
  channel: string,
  accent: string,
  unlinkFromProject: boolean,
  context: EditContext,
) {
  const task = selectTask(document, taskId),
    area = areas(document).find((a) => a.label === channel)
  if (!task || !area || task.channel === channel) return null
  const owner = projects(document).find((p) => (p.data.content as Data).id === task.objectiveId)
  const removesProject = Boolean(owner && (owner.data.content as Data).channel !== channel)
  if (removesProject && !unlinkFromProject) return null
  const undo: TaskAreaUndo = {
    task: copyRecord(task),
    channel,
    previousAreaId: areas(document).find((a) => a.label === task.channel)?.id as string | undefined,
    removedProjectId: removesProject ? String((owner!.data.content as Data).id) : null,
    projectEntries: removesProject
      ? (owner!.data.links as Data[]).flatMap((item, index) =>
          item.taskId === taskId ? [{ index, item: copyRecord(item) }] : [],
        )
      : [],
  }
  return {
    document: editWorkspaceTask(
      document,
      taskId,
      { channel, accent },
      { ...context, unlinkFromProject: removesProject },
    ),
    undo,
  }
}
export function undoWorkspaceTaskArea(
  input: WorkspaceDocument,
  undo: TaskAreaUndo,
  accent: string,
  context: EditContext,
): WorkspaceDocument {
  const task = selectTask(input, undo.task.id),
    previousArea = areas(input).find((a) => a.id === undo.previousAreaId)
  const owner = projects(input).find((p) => (p.data.content as Data).id === undo.removedProjectId)
  if (
    !task ||
    task.channel !== undo.channel ||
    (task.objectiveId || null) !== (undo.removedProjectId ? null : undo.task.objectiveId || null) ||
    (undo.removedProjectId && !owner)
  )
    return input
  const channel = String(previousArea?.label || undo.task.channel)
  if (owner && (owner.data.content as Data).channel !== channel) return input
  const next = editWorkspaceTask(input, task.id, { channel, accent }, context)
  return editDocument(next, (document) => {
    const current = selectTask(document, task.id)!
    if (undo.task.objectiveId) current.objectiveId = undo.task.objectiveId
    else delete current.objectiveId
    const project = projects(document).find((p) => (p.data.content as Data).id === undo.removedProjectId)
    if (project) {
      const links = project.data.links as Data[]
      for (const entry of undo.projectEntries)
        if (!links.some((link) => link.taskId === task.id))
          links.splice(Math.min(entry.index, links.length), 0, copyRecord(entry.item))
    }
  })
}

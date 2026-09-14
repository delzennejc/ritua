import { collectionCommand } from './workspace-collection-command'
import type { WorkspaceDocument } from './workspace-types'
import type { Task, Project, BacklogGroup } from './models'
import type { Fields } from './workspace'
import { workspaceCollections } from './workspace-collections'
import { moveTaskBetweenBacklogContexts, syncObjectiveTaskOwnership } from './backlog-organization'

type BacklogMove = {
  itemId: string
  targetIndex?: number
  targetData?: { backlogGroupLabel?: string; backlogChannel?: string; backlogObjectiveId?: string }
}
function moveWorkspaceBacklogView(fields: Fields, move: BacklogMove): Fields {
  const current = workspaceCollections(fields)
  const project = current.weeklyObjectives.find((p) => p.id === move.targetData?.backlogObjectiveId)
  if (project?.complete) return fields
  const result = moveTaskBetweenBacklogContexts(
    current.backlogGroups,
    move,
    new Set(current.weeklyObjectives.map((p) => p.id)),
  )
  return result
    ? {
        ...fields,
        backlogGroups: result.groups,
        weeklyObjectives: syncObjectiveTaskOwnership(current.weeklyObjectives, result),
      }
    : fields
}
export function moveWorkspaceBacklog(document: WorkspaceDocument, move: BacklogMove) {
  return collectionCommand(document, (fields) => moveWorkspaceBacklogView(fields, move))
}
function reorderProjectBacklogMirrors(objectives: Project[], groups: BacklogGroup[]) {
  const orderedTaskIdsByProject = new Map<string, string[]>()

  groups.forEach((group) => {
    group.items.forEach((task) => {
      if (!task.objectiveId) return
      const orderedIds = orderedTaskIdsByProject.get(task.objectiveId) || []
      orderedIds.push(task.id)
      orderedTaskIdsByProject.set(task.objectiveId, orderedIds)
    })
  })

  return objectives.map((objective) => {
    const orderedIds = orderedTaskIdsByProject.get(objective.id)
    if (!orderedIds?.length || !objective.tasks?.length) return objective

    const orderedIdSet = new Set(orderedIds)
    const mirrorsByTaskId = new Map(objective.tasks.map((task) => [task.taskId || task.id, task]))
    const reorderedMirrors = orderedIds.map((taskId) => mirrorsByTaskId.get(taskId)).filter(Boolean)
    if (reorderedMirrors.length < 2) return objective

    let mirrorIndex = 0
    return {
      ...objective,
      tasks: objective.tasks.map((task) =>
        orderedIdSet.has(task.taskId || task.id) ? reorderedMirrors[mirrorIndex++]! : task,
      ),
    }
  })
}

function moveWorkspacePanelBacklogView(
  fields: Fields,
  { itemId, targetData, targetIndex }: BacklogMove,
  unavailableTaskIds: string[],
  originTask?: Task,
): Fields {
  const { backlogGroups: groups, weeklyObjectives: objectives } = workspaceCollections(fields)
  const unavailableTaskIdSet = new Set(unavailableTaskIds)
  const currentGroups = groups
  const targetGroupLabel = targetData?.backlogGroupLabel
  const targetObjectiveId = targetData?.backlogObjectiveId || null
  const targetProject = targetObjectiveId
    ? objectives.find((objective) => objective.id === targetObjectiveId)
    : null
  const sourceTask = currentGroups.flatMap((group) => group.items).find((task) => task.id === itemId)
  const dragOriginTask = originTask
  if (
    !sourceTask ||
    !targetGroupLabel ||
    !currentGroups.some((group) => group.label === targetGroupLabel) ||
    (targetObjectiveId && !targetProject)
  )
    return fields

  const previousObjectiveId = sourceTask.objectiveId || null
  const movedTask = {
    ...sourceTask,
    ...(targetProject
      ? {
          channel: targetProject.channel,
          objectiveId: targetProject.id,
        }
      : {
          channel: dragOriginTask?.channel || sourceTask.channel,
        }),
  }
  if (!targetProject) delete movedTask.objectiveId

  const groupsWithoutTask = currentGroups.map((group) => ({
    ...group,
    items: group.items.filter((task) => task.id !== itemId),
  }))
  const nextGroups = groupsWithoutTask.map((group) => {
    if (group.label !== targetGroupLabel) return group
    const belongsToTargetLane = (task: Task) =>
      targetObjectiveId ? task.objectiveId === targetObjectiveId : !task.objectiveId
    const visibleTargetItems = group.items.filter(
      (task) => !unavailableTaskIdSet.has(task.id) && belongsToTargetLane(task),
    )
    const insertionLaneIndex = Math.max(
      0,
      Math.min(
        Number.isFinite(targetIndex) ? targetIndex! : visibleTargetItems.length,
        visibleTargetItems.length,
      ),
    )
    const referenceTask = visibleTargetItems[insertionLaneIndex]
    const lastLaneTask = visibleTargetItems[visibleTargetItems.length - 1]
    const insertionIndex = referenceTask
      ? group.items.findIndex((task) => task.id === referenceTask.id)
      : lastLaneTask
        ? group.items.findIndex((task) => task.id === lastLaneTask.id) + 1
        : group.items.length
    return {
      ...group,
      items: [...group.items.slice(0, insertionIndex), movedTask, ...group.items.slice(insertionIndex)],
    }
  })
  const items = objectives
  const nextObjectives = (() => {
    let nextObjectives = items
    if (previousObjectiveId !== targetObjectiveId) {
      const existingMirror = items
        .flatMap((objective) => objective.tasks || [])
        .find((task) => (task.taskId || task.id) === itemId)
      nextObjectives = items.map((objective) => ({
        ...objective,
        tasks: (objective.tasks || []).filter((task) => (task.taskId || task.id) !== itemId),
      }))
      if (targetObjectiveId) {
        nextObjectives = nextObjectives.map((objective) =>
          objective.id === targetObjectiveId
            ? {
                ...objective,
                tasks: [
                  ...(objective.tasks || []),
                  {
                    ...(existingMirror || {}),
                    id: existingMirror?.id || `objective-${itemId}`,
                    taskId: itemId,
                    title: movedTask.title,
                    minutes: existingMirror?.minutes || movedTask.minutes || 0,
                    complete: Boolean(movedTask.complete),
                  },
                ],
              }
            : objective,
        )
      }
    }
    return reorderProjectBacklogMirrors(nextObjectives, nextGroups)
  })()
  return { ...fields, backlogGroups: nextGroups, weeklyObjectives: nextObjectives }
}
export function moveWorkspacePanelBacklog(
  document: WorkspaceDocument,
  { itemId, targetData, targetIndex }: BacklogMove,
  unavailableTaskIds: string[],
  originTask?: Task,
) {
  return collectionCommand(document, (fields) =>
    moveWorkspacePanelBacklogView(
      fields,
      { itemId, targetData, targetIndex },
      unavailableTaskIds,
      originTask,
    ),
  )
}

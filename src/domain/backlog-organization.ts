import type { Task } from './models'
import type { BacklogGroup } from './models'
import type { Project } from './models'

type Destination = { channel?: string; objectiveId?: string | null }
type BacklogMove = {
  itemId: string
  targetIndex?: number
  targetData?: { backlogGroupLabel?: string; backlogChannel?: string; backlogObjectiveId?: string }
}
export const normalizedChannel = (channel?: string) => channel || 'Ritua'

export const objectiveTaskId = (task: Task) => task.taskId || task.id

export function taskMatchesDestination(item: Task, destination: Destination, knownProjectIds: Set<string>) {
  if (destination.objectiveId) return item.objectiveId === destination.objectiveId
  return (
    normalizedChannel(item.channel) === normalizedChannel(destination.channel) &&
    (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
  )
}

export function moveTaskBetweenBacklogContexts(
  groups: BacklogGroup[],
  move: BacklogMove,
  knownProjectIds: Set<string>,
) {
  const targetData = move.targetData
  const targetGroupLabel = targetData?.backlogGroupLabel
  const targetChannel = targetData?.backlogChannel
  if (!move.itemId || !targetGroupLabel || !targetChannel) return null

  const sourceTask = groups.flatMap((group) => group.items).find((item) => item.id === move.itemId)
  if (!sourceTask) return null

  const destination = {
    channel: normalizedChannel(targetChannel),
    objectiveId: targetData.backlogObjectiveId || null,
  }
  const movedTask = {
    ...sourceTask,
    channel: destination.channel,
  }
  if (destination.objectiveId) movedTask.objectiveId = destination.objectiveId
  else delete movedTask.objectiveId

  let targetTaskIds: string[] = []
  const nextGroups = groups.map((group) => {
    const withoutTask = group.items.filter((item) => item.id !== move.itemId)
    if (group.label !== targetGroupLabel) return { ...group, items: withoutTask }

    const contextItems = withoutTask.filter((item) =>
      taskMatchesDestination(item, destination, knownProjectIds),
    )
    const targetIndex = Math.max(
      0,
      Math.min(
        Number.isFinite(move.targetIndex) ? move.targetIndex! : contextItems.length,
        contextItems.length,
      ),
    )
    let insertionIndex = withoutTask.length
    if (contextItems.length && targetIndex === 0) {
      insertionIndex = withoutTask.findIndex((item) => item.id === contextItems[0].id)
    } else if (contextItems.length && targetIndex < contextItems.length) {
      insertionIndex = withoutTask.findIndex((item) => item.id === contextItems[targetIndex].id)
    } else if (contextItems.length) {
      insertionIndex =
        withoutTask.findIndex((item) => item.id === contextItems[contextItems.length - 1].id) + 1
    }

    const items = [...withoutTask.slice(0, insertionIndex), movedTask, ...withoutTask.slice(insertionIndex)]
    targetTaskIds = items
      .filter((item) => taskMatchesDestination(item, destination, knownProjectIds))
      .map((item) => item.id)
    return { ...group, items }
  })

  return {
    groups: nextGroups,
    movedTask,
    targetObjectiveId: destination.objectiveId,
    targetTaskIds,
  }
}

export function syncObjectiveTaskOwnership(
  objectives: Project[],
  {
    movedTask,
    targetObjectiveId,
    targetTaskIds,
  }: { movedTask: Task; targetObjectiveId: string | null; targetTaskIds: string[] },
) {
  const existingMirror = objectives
    .flatMap((objective) => objective.tasks || [])
    .find((task) => objectiveTaskId(task) === movedTask.id)
  const mirror = existingMirror || {
    id: `objective-${movedTask.id}`,
    taskId: movedTask.id,
    title: movedTask.title,
    minutes: movedTask.minutes || 0,
    complete: Boolean(movedTask.complete),
  }
  const withoutMovedTask = objectives.map((objective) => ({
    ...objective,
    tasks: (objective.tasks || []).filter((task) => objectiveTaskId(task) !== movedTask.id),
  }))
  if (!targetObjectiveId) return withoutMovedTask

  return withoutMovedTask.map((objective) => {
    if (objective.id !== targetObjectiveId) return objective

    const tasks = [...(objective.tasks || [])]
    const movedIndex = targetTaskIds.indexOf(movedTask.id)
    const nextTaskId = targetTaskIds
      .slice(movedIndex + 1)
      .find((taskId) => tasks.some((task) => objectiveTaskId(task) === taskId))
    const previousTaskId = [...targetTaskIds]
      .slice(0, Math.max(0, movedIndex))
      .reverse()
      .find((taskId) => tasks.some((task) => objectiveTaskId(task) === taskId))
    let insertionIndex = tasks.length
    if (nextTaskId) {
      insertionIndex = tasks.findIndex((task) => objectiveTaskId(task) === nextTaskId)
    } else if (previousTaskId) {
      insertionIndex = tasks.findIndex((task) => objectiveTaskId(task) === previousTaskId) + 1
    }
    tasks.splice(insertionIndex, 0, mirror)
    return { ...objective, tasks }
  })
}

export function reorderedItems<T extends { id: string }>(
  items: T[],
  move: { itemId: string; targetIndex: number },
) {
  const sourceIndex = items.findIndex((item) => item.id === move.itemId)
  if (sourceIndex === -1) return items

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)
  const targetIndex = Math.max(0, Math.min(move.targetIndex, nextItems.length))
  nextItems.splice(targetIndex, 0, movedItem)
  return nextItems
}

export function reorderProjectSubset(
  objectives: Project[],
  projectIds: string[],
  move: { itemId: string; targetIndex: number },
) {
  const projectIdSet = new Set(projectIds)
  const projects = objectives.filter((objective) => projectIdSet.has(objective.id))
  const nextProjects = reorderedItems(projects, move)
  let replacementIndex = 0

  return objectives.map((objective) =>
    projectIdSet.has(objective.id) ? nextProjects[replacementIndex++] : objective,
  )
}

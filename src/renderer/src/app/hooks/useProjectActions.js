import { editWorkspaceProject } from '../../../../domain/project-commands'
import { dispatchTaskCommand } from '../../desktop/workspace-actions'
import { areaAccentForLabel } from '../utils/workspace-presenters.js'
import { profileActor } from '../../desktop/profile-actor'
import { removeWorkspaceProject, undoWorkspaceProjectRemoval } from '../../../../domain/project-commands'
import { getWorkspaceFields, getWorkspaceDocument } from '../../desktop/workspace-store'
import { toggleTaskCompletion } from '../../desktop/workspace-actions'

export function useProjectActions({
  setWeeklyObjectives,
  tasks,
  datedTasksByDate,
  backlogGroups,
  areas,
  weeklyObjectives,
  setToast,
  setWeeklyObjectiveOrder,
  publishActionDocument,
  closeObjectiveDetails,
  projectActionRevisionRef,
  setTaskDeletionUndo,
  setTaskAreaUndo,
  setProjectActionUndo,
  projectActionUndo,
  activeObjective,
  completeUndatedTaskToday,
}) {
  const updateObjectiveFromDetails = (objectiveId, patch) => {
    publishActionDocument(
      editWorkspaceProject(
        getWorkspaceDocument(),
        objectiveId,
        patch,
        patch.channel ? areaAccentForLabel(patch.channel, areas) : undefined,
      ),
    )
  }

  const addObjectiveCommentFromDetails = (objectiveId, text, attachment) => {
    const comment = {
      id: `project-comment-${Date.now()}`,
      text,
      attachment: attachment || null,
      authorName: profileActor(),
      time: 'now',
    }

    setWeeklyObjectives((objectives) =>
      objectives.map((objective) =>
        objective.id === objectiveId
          ? { ...objective, comments: [...(objective.comments || []), comment] }
          : objective,
      ),
    )
  }

  const toggleObjectiveFromDetails = (objectiveId) => {
    const objective = weeklyObjectives.find((item) => item.id === objectiveId)
    if (!objective) return
    const complete = !objective.complete
    setWeeklyObjectives((items) =>
      items.map((objective) => (objective.id === objectiveId ? { ...objective, complete } : objective)),
    )
    setToast(complete ? 'Project completed.' : 'Project reopened.')
  }

  const removeObjectiveFromWeekFromDetails = (objectiveId) => {
    setWeeklyObjectives((items) =>
      items.map((objective) =>
        objective.id === objectiveId ? { ...objective, focusedThisWeek: false } : objective,
      ),
    )
    setWeeklyObjectiveOrder((objectiveIds) => objectiveIds.filter((id) => id !== objectiveId))
    setToast('Project removed from this week.')
  }

  const moveProjectOutOfActiveDetails = (objectiveId, action) => {
    const result = removeWorkspaceProject(getWorkspaceDocument(), objectiveId, action, new Date())
    if (!result) return
    publishActionDocument(result.document)
    closeObjectiveDetails()
    projectActionRevisionRef.current += 1
    setTaskDeletionUndo(null)
    setTaskAreaUndo(null)
    setProjectActionUndo({
      undo: result.undo,
      id: projectActionRevisionRef.current,
      message: `${result.undo.project.title} ${action === 'archive' ? 'archived' : 'deleted'}.`,
    })
  }

  const undoProjectAction = () => {
    if (!projectActionUndo) return
    publishActionDocument(undoWorkspaceProjectRemoval(getWorkspaceDocument(), projectActionUndo.undo))
    setProjectActionUndo(null)
  }

  const toggleObjectiveTaskFromDetails = (objectiveId, objectiveTaskId, canonicalTaskId) => {
    const objectiveTask = activeObjective?.tasks?.find(
      (task) => task.id === objectiveTaskId || task.taskId === canonicalTaskId,
    )
    const canonicalTask = canonicalTaskId
      ? tasks.find((task) => task.id === canonicalTaskId) ||
        Object.values(datedTasksByDate)
          .flat()
          .find((task) => task.id === canonicalTaskId) ||
        backlogGroups.flatMap((group) => group.items).find((task) => task.id === canonicalTaskId)
      : null
    const complete = !(canonicalTask?.complete ?? objectiveTask?.complete)

    if (complete && canonicalTaskId && completeUndatedTaskToday(canonicalTaskId)) {
      return
    }

    toggleTaskCompletion(canonicalTaskId || objectiveTask?.taskId || objectiveTaskId)

    setToast(complete ? 'Project task completed.' : 'Project task reopened.')
  }

  const addObjectiveTaskFromDetails = (objectiveId, title) => {
    const objective = weeklyObjectives.find((item) => item.id === objectiveId)
    if (!objective || objective.complete) return

    const taskId = `backlog-${Date.now()}`
    const task = {
      id: taskId,
      title,
      channel: objective.channel,
      objectiveId,
      complete: false,
    }

    const group = getWorkspaceFields().backlogGroups.find((item) => item.label === 'Anytime')
    if (!group) return
    dispatchTaskCommand({
      type: 'task.create',
      tasks: [{ task, lane: `backlog:${group.id}` }],
      placement: 'before-completed',
    })
    setToast(`${title} added to Anytime.`)
  }
  return {
    updateObjectiveFromDetails,
    addObjectiveCommentFromDetails,
    toggleObjectiveFromDetails,
    removeObjectiveFromWeekFromDetails,
    moveProjectOutOfActiveDetails,
    undoProjectAction,
    toggleObjectiveTaskFromDetails,
    addObjectiveTaskFromDetails,
  }
}

import { dispatchTaskDetailCommand } from '../../desktop/workspace-actions'
import { moveWorkspaceTaskArea, undoWorkspaceTaskArea } from '../../../../domain/task-area'

import { editWorkspaceTask } from '../../../../domain/task-editing'
import { areaAccentForLabel } from '../utils/workspace-presenters.js'

import { useTaskRecurrence } from './useTaskRecurrence.js'
import { profileActor } from '../../desktop/profile-actor'
import { toggleTaskCompletion } from '../../desktop/workspace-actions'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from '../../../../domain/task-deletion'
import { selectTask } from '../../../../domain/workspace-selectors'
import {
  getWorkspaceFields,
  getWorkspaceDocument,
  replaceWorkspaceDocument,
} from '../../desktop/workspace-store'

export function useTaskDetailsActions({
  areas,
  boardStateRef,
  setToast,
  setTaskDeletionUndo,
  setProjectActionUndo,
  taskAreaRevisionRef,
  setTaskAreaUndo,
  taskAreaUndo,
  setActiveTaskId,
  activeTask,
  completeUndatedTaskToday,
  pendingScheduleDrop,
  setPendingScheduleDrop,
  objectiveDetailsTaskFocusIdRef,
  closeTaskDetails,
  taskDeletionRevisionRef,
  taskDeletionUndo,
}) {
  const updateTaskFromDetails = (taskId, patch, { unlinkFromProject = false } = {}) => {
    const fields = editWorkspaceTask(
      getWorkspaceDocument(),
      taskId,
      patch.channel ? { ...patch, accent: areaAccentForLabel(patch.channel, areas) } : patch,
      { actor: profileActor(), now: new Date(), unlinkFromProject },
    )
    replaceWorkspaceDocument(fields)
    boardStateRef.current = getWorkspaceFields()
  }

  const moveTaskToArea = (taskId, channel, { unlinkFromProject = false } = {}) => {
    const result = moveWorkspaceTaskArea(
      getWorkspaceDocument(),
      taskId,
      channel,
      areaAccentForLabel(channel, areas),
      unlinkFromProject,
      { actor: profileActor(), now: new Date() },
    )
    if (!result) return
    replaceWorkspaceDocument(result.document)
    setToast('')
    setTaskDeletionUndo(null)
    setProjectActionUndo(null)
    taskAreaRevisionRef.current += 1
    setTaskAreaUndo({
      id: taskAreaRevisionRef.current,
      ...result.undo,
      message: `${result.undo.task.title} moved to ${channel}.`,
    })
  }

  const undoTaskAreaMove = () => {
    if (!taskAreaUndo) return
    const previousArea = areas.find((area) => area.id === taskAreaUndo.previousAreaId)
    const fields = undoWorkspaceTaskArea(
      getWorkspaceDocument(),
      taskAreaUndo,
      areaAccentForLabel(previousArea?.label || taskAreaUndo.task.channel, areas),
      { actor: profileActor(), now: new Date() },
    )
    replaceWorkspaceDocument(fields)
    setTaskAreaUndo(null)
    setToast('')
  }

  const { updateTaskRecurrenceFromDetails } = useTaskRecurrence({
    boardStateRef,
    areas,
    setActiveTaskId,
  })

  const toggleTaskFromDetails = (taskId) => {
    const complete = !activeTask?.complete
    const activityEntry = {
      id: `activity-${Date.now()}`,
      label: `${profileActor()} marked this ${complete ? 'complete' : 'incomplete'}`,
      time: 'now',
    }

    if (complete && completeUndatedTaskToday(taskId, { activityEntry })) return

    dispatchTaskDetailCommand({ type: 'completion.toggle', taskId })
    setToast(complete ? 'Task completed.' : 'Task reopened.')
  }

  const deleteTaskFromDetails = (taskId, scope = 'single') => {
    const document = getWorkspaceDocument()
    const task = selectTask(document, taskId)
    if (!task) return
    const taskTitle = task.title
    const result = deleteWorkspaceTask(document, taskId, scope)
    replaceWorkspaceDocument(result.document)
    boardStateRef.current = getWorkspaceFields()
    const removedPendingDrop = result.deletedIds.includes(pendingScheduleDrop?.taskId)
      ? pendingScheduleDrop
      : null
    if (removedPendingDrop) setPendingScheduleDrop(null)
    if (result.deletedIds.includes(objectiveDetailsTaskFocusIdRef.current))
      objectiveDetailsTaskFocusIdRef.current = null
    if (result.deletedIds.includes(activeTask?.id)) closeTaskDetails()
    taskDeletionRevisionRef.current += 1
    setProjectActionUndo(null)
    setTaskAreaUndo(null)
    setTaskDeletionUndo({
      undo: result.undo,
      pendingScheduleDrop: removedPendingDrop,
      id: taskDeletionRevisionRef.current,
      message: result.following
        ? `${taskTitle || 'Task'} and following tasks deleted.`
        : `${taskTitle || 'Task'} deleted.`,
    })
  }

  const undoTaskDeletion = () => {
    if (!taskDeletionUndo) return
    const fields = undoWorkspaceTaskDeletion(getWorkspaceDocument(), taskDeletionUndo.undo)
    replaceWorkspaceDocument(fields)
    boardStateRef.current = getWorkspaceFields()
    if (taskDeletionUndo.pendingScheduleDrop)
      setPendingScheduleDrop((pending) => pending || taskDeletionUndo.pendingScheduleDrop)
    setTaskDeletionUndo(null)
  }

  const toggleScheduledTaskFromBacklog = toggleTaskCompletion

  const toggleSubtaskFromDetails = (taskId, subtaskId) =>
    dispatchTaskDetailCommand({ type: 'subtask.toggle', taskId, subtaskId })
  const updateSubtaskFromDetails = (taskId, subtaskId, patch) =>
    dispatchTaskDetailCommand({ type: 'subtask.edit', taskId, subtaskId, patch })
  const addSubtaskFromDetails = (taskId, { title, actualMinutes = null, minutes }) => {
    dispatchTaskDetailCommand({
      type: 'subtask.add',
      taskId,
      subtask: {
        id: `${taskId}-subtask-${crypto.randomUUID()}`,
        title,
        minutes,
        actualMinutes,
        complete: false,
      },
    })
    setToast('Subtask added.')
  }
  const addCommentFromDetails = (taskId, text, attachment) =>
    dispatchTaskDetailCommand({ type: 'comment.add', taskId, text, attachment })
  return {
    updateTaskFromDetails,
    moveTaskToArea,
    undoTaskAreaMove,
    updateTaskRecurrenceFromDetails,
    toggleTaskFromDetails,
    deleteTaskFromDetails,
    undoTaskDeletion,
    toggleScheduledTaskFromBacklog,
    toggleSubtaskFromDetails,
    updateSubtaskFromDetails,
    addSubtaskFromDetails,
    addCommentFromDetails,
  }
}

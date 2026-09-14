import { promoteTask, moveTaskToBacklogList } from '../../desktop/workspace-actions'
import { dispatchTaskCommand } from '../../desktop/workspace-actions'
import { moveScheduledTask } from '../../../../domain/task-scheduling'

import {
  getWorkspaceFields,
  getWorkspaceDocument,
  replaceWorkspaceDocument,
} from '../../desktop/workspace-store'
import { areaAccentForLabel, findTaskDateKey } from '../utils/workspace-presenters.js'

import { CURRENT_DATE_KEY } from '../utils/dates'
import { minutesLabel } from '../utils/time'

import { reportActionError } from '../../desktop/ActionErrors'
import { nextAvailableCalendarStart } from '../utils/calendar'
import { captureScheduleOrigin } from '../components/AutoScheduleAnimation'

export function useTaskScheduling({
  boardStateRef,
  backlogGroups,
  areas,
  setToast,
  pendingScheduleDrop,
  weeklyObjectives,
  setPendingScheduleDrop,
  activeTask,
  autoScheduleRequest,
  events,
  setAutoScheduleRequest,
  rightPaneKey,
  updateRightPanelOpen,
  selectRightPane,
}) {
  const moveBoardTask = (move) => {
    const result = moveScheduledTask(getWorkspaceDocument(), move, CURRENT_DATE_KEY)
    if (!result.moved) return false
    replaceWorkspaceDocument(result.document)
    boardStateRef.current = getWorkspaceFields()
    return true
  }

  const promoteBacklogTask = ({ taskId, dateKey, targetIndex, start, end, taskSnapshot, destination }) => {
    const sourceBacklogTask =
      backlogGroups.flatMap((group) => group.items).find((task) => task.id === taskId) || taskSnapshot
    if (!sourceBacklogTask || !dateKey) return false

    const hasCalendarTime = Number.isFinite(start) && Number.isFinite(end)
    const promotedTask = sourceBacklogTask
    const fields = promoteTask({
      taskId,
      dateKey,
      targetIndex,
      start,
      end,
      destination,
      accent: destination?.channel
        ? areaAccentForLabel(destination.channel, areas)
        : sourceBacklogTask.accent || areaAccentForLabel(sourceBacklogTask.channel, areas),
    })
    boardStateRef.current = getWorkspaceFields()
    if (hasCalendarTime) {
      setToast(`${promotedTask.title || 'Task'} scheduled.`)
    } else {
      setToast(`${promotedTask.title || 'Task'} added to the board.`)
    }

    return true
  }

  const scheduleBacklogTaskFromDrop = (dateKey) => {
    const scheduleDrop = pendingScheduleDrop
    if (!scheduleDrop || !dateKey) return

    const targetProject = scheduleDrop.targetObjectiveId
      ? weeklyObjectives.find((objective) => objective.id === scheduleDrop.targetObjectiveId)
      : null
    if (targetProject?.complete) {
      setPendingScheduleDrop(null)
      reportActionError('Reopen the Project before moving a Task into it.')
      return
    }

    const promoted = promoteBacklogTask({
      taskId: scheduleDrop.taskId,
      dateKey,
      destination: {
        channel: targetProject?.channel || scheduleDrop.targetChannel || 'Ritua',
        objectiveId: targetProject?.id || null,
      },
    })
    if (promoted) setPendingScheduleDrop(null)
  }

  const moveTaskToBacklog = ({ taskId, targetData, insertAfter = false, taskSnapshot }) => {
    if (!taskId || !targetData?.backlogDropTarget) return false

    const currentBoardState = boardStateRef.current
    const boardTask =
      currentBoardState.tasks.find((task) => task.id === taskId) ||
      Object.values(currentBoardState.datedTasksByDate)
        .flat()
        .find((task) => task.id === taskId) ||
      taskSnapshot
    if (!boardTask) return false

    const targetGroupLabel = targetData.backlogGroupLabel || 'Anytime'
    const backlogTask = boardTask
    const fields = moveTaskToBacklogList({
      taskId,
      groupLabel: targetGroupLabel,
      referenceTaskId: targetData.itemId || targetData.referenceItemId,
      after: targetData.kind === 'collection-lane' ? targetData.insertAfterReference : insertAfter,
      ...(targetData.backlogContextual
        ? {
            channel: targetData.backlogChannel || boardTask.channel,
            projectId: targetData.backlogObjectiveId || null,
          }
        : {}),
    })
    boardStateRef.current = getWorkspaceFields()
    setToast(`${backlogTask.title || 'Task'} moved to ${targetGroupLabel}.`)
    return true
  }

  const scheduleTaskFromDetails = (taskId, { dateKey, start, end }) => {
    const currentBoardState = boardStateRef.current
    const sourceDateKey = findTaskDateKey(currentBoardState, taskId)
    const backlogTask = sourceDateKey
      ? null
      : backlogGroups.flatMap((group) => group.items).find((task) => task.id === taskId)
    if (!sourceDateKey && !backlogTask) return

    const task =
      activeTask?.id === taskId
        ? activeTask
        : [...currentBoardState.tasks, ...Object.values(currentBoardState.datedTasksByDate).flat()].find(
            (item) => item.id === taskId,
          )
    if (backlogTask) {
      promoteBacklogTask({ taskId, dateKey, start, end, taskSnapshot: backlogTask })
      return
    }
    const fields = dispatchTaskCommand({ type: 'task.schedule', taskId, dateKey, start, end })
    boardStateRef.current = getWorkspaceFields()
    setToast(`${task?.title || 'Task'} scheduled.`)
  }

  const scheduleTaskAtFirstAvailableTime = (task, requestedDateKey, source) => {
    if (autoScheduleRequest || task.time || task.complete) return
    const dateKey = findTaskDateKey(boardStateRef.current, task.id) || requestedDateKey || CURRENT_DATE_KEY
    const duration = task.minutes > 0 ? task.minutes : 30
    const start = nextAvailableCalendarStart(events, duration, dateKey, { taskId: task.id })

    if (start === null) {
      reportActionError(`No ${minutesLabel(duration)} opening is available on this day.`)
      return
    }

    const origin = captureScheduleOrigin(source)
    setAutoScheduleRequest({ taskId: task.id, dateKey, origin, pageKey: rightPaneKey })
    updateRightPanelOpen(true)
    selectRightPane('calendar')
    scheduleTaskFromDetails(task.id, {
      dateKey,
      start,
      end: start + duration,
    })
  }

  const removeTaskSchedule = (taskId, source) => {
    if (source && autoScheduleRequest) return
    const calendarEvent = events.find((event) => event.id === taskId)
    if (source && calendarEvent) {
      setAutoScheduleRequest({
        kind: 'unschedule',
        taskId,
        dateKey: calendarEvent.dateKey || CURRENT_DATE_KEY,
        calendarEvent,
        origin: captureScheduleOrigin(source),
        pageKey: rightPaneKey,
      })
      updateRightPanelOpen(true)
      selectRightPane('calendar')
    }
    const fields = dispatchTaskCommand({ type: 'task.unschedule', taskId })
    boardStateRef.current = getWorkspaceFields()
    setToast('Task removed from the calendar.')
  }
  return {
    moveBoardTask,
    promoteBacklogTask,
    scheduleBacklogTaskFromDrop,
    moveTaskToBacklog,
    scheduleTaskFromDetails,
    scheduleTaskAtFirstAvailableTime,
    removeTaskSchedule,
  }
}

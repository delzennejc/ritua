import { calendarDraggedCardRect, calendarEdgeDwell } from '../utils/calendar-edge-dwell'
import { nextTaskBlockId } from '../../../../domain/task-calendar'
import { dispatchTaskCommand } from '../../desktop/workspace-actions'
import {
  pointerFromNativeEvent,
  resizedCalendarEnd,
  calendarTargetAtPointer,
  backlogDropDataFromElement,
  backlogTargetAtPointer,
  collectionDragTarget,
  boardTargetAtPointer,
  boardInsertionAtPointer,
  todayBoardTargetAtPointer,
  collectionTargetAtPointer,
  isPointerOverCollection,
  isPointerOverRightPanelBacklogGroup,
  boardDragTarget,
  isPointerOverBoard,
} from './drag-targets.js'
import { sessionAtPointer, sessionDragTaskId } from '../utils/session-drag'
import {
  replaceWorkspaceDocument,
  getWorkspaceDocument,
  endWorkspaceGesture,
} from '../../desktop/workspace-store'
import { moveSessionTask, linkSessionTask } from '../../../../domain/calendar-sessions'
import { commitBoardSessionOrder } from '../../../../domain/session-board-order'
import { calendarStartAfterMove, calendarStartAtPointer, CALENDAR_DRAG_TYPE } from '../utils/calendar'
import { addDays } from '../../../../domain/calendar-dates'
import { reportActionError } from '../../desktop/ActionErrors'
import { CURRENT_DATE_KEY } from '../utils/dates'
import { RIGHT_PANEL_BACKLOG_COLLECTION_ID } from '../utils/collections'
import { findTaskDateKey } from '../utils/workspace-presenters.js'
import { todayBoardStatus } from '../../../../domain/today-board'
import { changeTodayTaskStatus } from '../../desktop/today-status-actions'

export function createDropHandler({
  dragSessionRef,
  clearBoardInsertionPreview,
  lastBoardProjectionRef,
  setDragPreviewPresentation,
  releasePostDragClickGuard,
  restoreCollectionSnapshot,
  restoreBoardSnapshot,
  setEvents,
  boardStateRef,
  weeklyObjectives,
  setToast,
  moveTaskToBacklog,
  setPendingScheduleDrop,
  promoteBacklogTask,
  projectCollectionItem,
  moveBoardTask,
  projectBoardTask,
}) {
  const handleDragEnd = ({ canceled, operation, nativeEvent }) => {
    try {
      const dragSession = dragSessionRef.current
      const finalPointer =
        pointerFromNativeEvent(nativeEvent) || dragSession?.pointer || operation.position.current
      if (dragSession) dragSession.pointer = finalPointer
      const sourceData = dragSession?.sourceData || operation.source?.data
      const target = operation.target
      const targetData = target?.data
      const finishDrag = () => {
        sourceData?.onResizePreview?.(null)
        clearBoardInsertionPreview()
        dragSessionRef.current = null
        lastBoardProjectionRef.current = ''
        setDragPreviewPresentation(null)
        releasePostDragClickGuard()
      }

      if (canceled) {
        if (sourceData?.kind === 'collection-item') restoreCollectionSnapshot()
        else if (sourceData?.kind === 'board-task') restoreBoardSnapshot()
        finishDrag()
        return
      }

      const sharedSlot = calendarEdgeDwell.update(
        sourceData,
        calendarDraggedCardRect(operation, finalPointer),
      )
      if (sharedSlot) {
        if (sourceData.kind === 'collection-item') restoreCollectionSnapshot()
        else if (sourceData.kind === 'board-task') restoreBoardSnapshot()
        dispatchTaskCommand({
          type: 'task.schedule',
          taskId: sessionDragTaskId(sourceData),
          dateKey: sharedSlot.dateKey,
          start: sharedSlot.start,
          end: sharedSlot.end,
          ...(sourceData.kind === 'calendar-event' ? { eventId: sourceData.eventId } : {}),
        })
        finishDrag()
        return
      }

      const todayStatusTarget = todayBoardTargetAtPointer(finalPointer, target, operation.activatorEvent)
      const statusTaskId =
        sourceData?.kind === 'board-task' && sourceData.boardSurfaceId === 'today-board'
          ? sourceData.taskId
          : null
      if (todayStatusTarget && statusTaskId) {
        const currentDocument = getWorkspaceDocument()
        const taskEntity = currentDocument.entities.find(
          (entity) => entity.kind === 'task' && entity.id === statusTaskId,
        )
        const lane = taskEntity?.data.lane
        const targetDateKey = todayStatusTarget.data.dateKey
        const isScheduledForTargetDate =
          lane === `date:${targetDateKey}` ||
          (targetDateKey === CURRENT_DATE_KEY && lane === 'today') ||
          currentDocument.entities.some(
            (entity) =>
              entity.kind === 'event' &&
              entity.data.taskId === statusTaskId &&
              (entity.data.content.dateKey || CURRENT_DATE_KEY) === targetDateKey,
          )
        const task = taskEntity?.data.content
        if (isScheduledForTargetDate && task) {
          const statusChanged = todayBoardStatus(task) !== todayStatusTarget.data.todayStatus
          // Calendar blocks and session members use their drag-out handlers below.
          // Only board cards change status; same-status drops still reorder.
          if (!statusChanged) {
            // Let the board reorder handler below process this drop.
          } else {
            const insertion = finalPointer
              ? boardInsertionAtPointer(todayStatusTarget.element, finalPointer).insertion
              : undefined
            restoreBoardSnapshot()
            changeTodayTaskStatus(statusTaskId, todayStatusTarget.data.todayStatus, insertion)
            if (operation.activatorEvent?.type?.startsWith('key')) {
              window.requestAnimationFrame(() => {
                const movedCard = Array.from(document.querySelectorAll('[data-board-task-id]')).find(
                  (element) =>
                    element.dataset.boardTaskId === statusTaskId &&
                    element.closest('[data-board-drop-zone="true"]')?.dataset.boardSurfaceId ===
                      'today-board',
                )
                movedCard?.focus({ preventScroll: true })
                movedCard?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              })
            }
            finishDrag()
            return
          }
        }
      }

      if (sourceData?.sessionTask) {
        const targetSessionId = sessionAtPointer(finalPointer) || null
        // Session hover order is local; publish board order only after the drop.
        if (targetSessionId === sourceData.sessionId) {
          sourceData.onCommit?.()
        } else {
          restoreCollectionSnapshot()
          replaceWorkspaceDocument(
            moveSessionTask(getWorkspaceDocument(), sourceData.sessionId, sourceData.taskId, targetSessionId),
          )
        }
        finishDrag()
        return
      }

      const sessionId = sessionAtPointer(finalPointer)
      const sessionTaskId = sessionDragTaskId(sourceData)
      if (sessionId && sessionTaskId) {
        if (sourceData.kind === 'collection-item') restoreCollectionSnapshot()
        else if (sourceData.kind === 'board-task') restoreBoardSnapshot()
        replaceWorkspaceDocument(linkSessionTask(getWorkspaceDocument(), sessionId, sessionTaskId))
        finishDrag()
        return
      }

      if (sourceData?.session) {
        if (sourceData.kind === 'calendar-resize') {
          const end = resizedCalendarEnd(sourceData, operation)
          setEvents((items) =>
            items.map((item) => (item.id === sourceData.eventId ? { ...item, end } : item)),
          )
        } else {
          const calendarTarget = calendarTargetAtPointer(finalPointer)
          if (calendarTarget?.data?.kind === 'calendar-timeline') {
            const duration = sourceData.end - sourceData.start
            const start = calendarStartAfterMove({
              start: sourceData.start,
              duration,
              deltaY: operation.position.current.y - operation.position.initial.y,
              scrollDelta:
                (sourceData.timelineScrollRef?.current?.scrollTop || 0) -
                (sourceData.dragStartScrollTopRef?.current || 0),
            })
            setEvents((items) =>
              items.map((item) =>
                item.id === sourceData.eventId
                  ? { ...item, dateKey: calendarTarget.data.dateKey, start, end: start + duration }
                  : item,
              ),
            )
          }
        }
        finishDrag()
        return
      }

      if (sourceData?.kind === 'board-task' || sourceData?.kind === 'calendar-event') {
        const scheduleElement = document
          .elementFromPoint(finalPointer.x, finalPointer.y)
          ?.closest?.('[data-backlog-schedule-target="true"]')
        const scheduleData = scheduleElement
          ? backlogDropDataFromElement(scheduleElement)
          : targetData?.backlogScheduleTarget
            ? targetData
            : null
        if (scheduleData?.backlogContextual) {
          const taskId = sourceData.taskId || sourceData.eventId
          const snapshot = dragSession?.boardSnapshot || boardStateRef.current
          const task =
            snapshot.tasks.find((item) => item.id === taskId) ||
            Object.values(snapshot.datedTasksByDate)
              .flat()
              .find((item) => item.id === taskId)
          const objectiveId = scheduleData.backlogObjectiveId || null
          const channel = scheduleData.backlogChannel || task?.channel
          if (task && (task.channel !== channel || (task.objectiveId || null) !== objectiveId)) {
            const objective = objectiveId ? weeklyObjectives.find((item) => item.id === objectiveId) : null
            if (sourceData.kind === 'board-task') restoreBoardSnapshot()
            if (objectiveId && (!objective || objective.complete)) {
              reportActionError('Choose an active project.')
            } else {
              dispatchTaskCommand({
                type: 'task.assign',
                taskId,
                projectId: objectiveId,
                channel: objective?.channel || channel,
              })
              setToast(`${task.title || 'Task'} moved to ${objective?.title || channel}.`)
            }
            finishDrag()
            return
          }
        }
        const pointerBacklogTarget = backlogTargetAtPointer(finalPointer)
        const backlogTarget = pointerBacklogTarget || (targetData?.backlogDropTarget ? target : null)
        const backlogTargetData = backlogTarget?.data
        if (backlogTargetData?.backlogDropTarget) {
          const targetRect = backlogTarget.element?.getBoundingClientRect()
          const insertAfter =
            backlogTargetData.kind === 'collection-item' &&
            targetRect &&
            finalPointer.y > targetRect.top + targetRect.height / 2
          const moved = moveTaskToBacklog({
            taskId: sourceData.taskId || sourceData.eventId,
            targetData: backlogTargetData,
            insertAfter,
            taskSnapshot: sourceData.taskSnapshot,
          })
          if (moved) {
            finishDrag()
            return
          }
        }
      }

      if (sourceData?.kind === 'collection-item') {
        if (sourceData.backlogTask) {
          const scheduleCollectionTarget = collectionDragTarget(
            operation,
            finalPointer,
            sourceData,
            dragSession,
          )
          const scheduleTarget =
            scheduleCollectionTarget.targetOverride?.target ||
            (targetData?.backlogScheduleTarget ? target : null)
          const scheduleTargetData = scheduleTarget?.data
          if (scheduleTargetData?.backlogScheduleTarget) {
            restoreCollectionSnapshot()
            setPendingScheduleDrop({
              taskId: sourceData.taskId || sourceData.itemId,
              taskTitle: sourceData.itemSnapshot?.title || 'Untitled task',
              targetChannel: scheduleTargetData.backlogChannel || null,
              targetObjectiveId: scheduleTargetData.backlogObjectiveId || null,
            })
            finishDrag()
            return
          }

          const pointerCalendarTarget = calendarTargetAtPointer(finalPointer)
          const calendarTarget = targetData?.kind === 'calendar-timeline' ? target : pointerCalendarTarget
          if (calendarTarget?.element) {
            const targetDateKey = calendarTarget.data.dateKey || CURRENT_DATE_KEY
            const timelineRect = calendarTarget.element.getBoundingClientRect()
            const sourceMinutes = sourceData.itemSnapshot?.minutes
            const duration = Math.max(Number.isFinite(sourceMinutes) ? sourceMinutes : 0, 30)
            const nextStart = calendarStartAtPointer({
              pointerY: finalPointer.y,
              timelineTop: timelineRect.top,
              duration,
            })
            const promoted = promoteBacklogTask({
              taskId: sourceData.taskId,
              dateKey: targetDateKey,
              start: nextStart,
              end: nextStart + duration,
              taskSnapshot: sourceData.itemSnapshot,
            })
            if (promoted) {
              finishDrag()
              return
            }
          }

          const pointerBoardTarget = boardTargetAtPointer(finalPointer, boardStateRef.current)
          const boardTarget =
            pointerBoardTarget ||
            (targetData?.kind === 'board-task' || targetData?.kind === 'board-column' ? target : null)
          const boardTargetData = boardTarget?.data
          if (
            boardTarget?.element &&
            (boardTargetData?.kind === 'board-task' || boardTargetData?.kind === 'board-column')
          ) {
            const targetRect = boardTarget.element.getBoundingClientRect()
            const insertAfterTarget =
              boardTargetData.kind === 'board-task' && finalPointer.y > targetRect.top + targetRect.height / 2
            const targetIndex =
              boardTargetData.kind === 'board-task'
                ? boardTargetData.index + (insertAfterTarget ? 1 : 0)
                : boardTargetData.insertionIndex
            const promoted = promoteBacklogTask({
              taskId: sourceData.taskId,
              dateKey: boardTargetData.dateKey,
              targetIndex,
              taskSnapshot: sourceData.itemSnapshot,
            })
            if (promoted) {
              finishDrag()
              return
            }
          }
        }

        const crossSurfaceTarget = collectionTargetAtPointer(finalPointer, sourceData, null)
        const targetSurfaceId = crossSurfaceTarget?.data?.surfaceId
        const sourceIsProjectCatalog = sourceData.surfaceId === 'right-panel-objectives'
        const targetIsProjectCatalog = targetSurfaceId === 'right-panel-objectives'
        const sourceIsWeeklyFocus =
          sourceData.surfaceId === 'weekly-objectives-step' ||
          sourceData.surfaceId === 'weekly-plan-objectives'
        const targetIsWeeklyFocus =
          targetSurfaceId === 'weekly-objectives-step' || targetSurfaceId === 'weekly-plan-objectives'

        if (
          sourceData.collectionId === 'weekly-objectives' &&
          sourceIsProjectCatalog &&
          targetIsWeeklyFocus &&
          sourceData.onFocusObjectiveInWeek
        ) {
          const targetRect = crossSurfaceTarget.element?.getBoundingClientRect()
          const insertAfterTarget =
            crossSurfaceTarget.data.kind === 'collection-item' &&
            targetRect &&
            finalPointer.y > targetRect.top + targetRect.height / 2
          const targetIndex =
            crossSurfaceTarget.data.kind === 'collection-item'
              ? crossSurfaceTarget.data.index + (insertAfterTarget ? 1 : 0)
              : crossSurfaceTarget.data.insertionIndex
          restoreCollectionSnapshot()
          sourceData.onFocusObjectiveInWeek(sourceData.itemId, targetIndex)
          finishDrag()
          return
        }

        if (
          sourceData.collectionId === 'weekly-objectives' &&
          sourceIsWeeklyFocus &&
          targetIsProjectCatalog &&
          sourceData.onRemoveObjectiveFromWeek
        ) {
          const targetRect = crossSurfaceTarget.element?.getBoundingClientRect()
          const insertAfterTarget =
            crossSurfaceTarget.data.kind === 'collection-item' &&
            targetRect &&
            finalPointer.y > targetRect.top + targetRect.height / 2
          const targetIndex =
            crossSurfaceTarget.data.kind === 'collection-item'
              ? crossSurfaceTarget.data.index + (insertAfterTarget ? 1 : 0)
              : crossSurfaceTarget.data.insertionIndex
          restoreCollectionSnapshot()
          sourceData.onRemoveObjectiveFromWeek(
            sourceData.itemId,
            crossSurfaceTarget.data.laneId === 'other-projects' ? targetIndex : undefined,
          )
          finishDrag()
          return
        }

        const hadValidCollectionProjection = Boolean(lastBoardProjectionRef.current)
        const collectionTarget = collectionDragTarget(
          operation,
          finalPointer,
          sourceData,
          dragSessionRef.current,
        )
        const targetOverride = collectionTarget.targetOverride
        const landedOnCollection = collectionTarget.blocked
          ? false
          : projectCollectionItem(operation, finalPointer, targetOverride)
        const canCommitLastProjection =
          hadValidCollectionProjection &&
          (isPointerOverCollection(finalPointer, sourceData.collectionId, sourceData.surfaceId) ||
            (sourceData.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID &&
              isPointerOverRightPanelBacklogGroup(finalPointer, dragSession.projectedCollectionLaneId)))
        if (!landedOnCollection && !canCommitLastProjection) {
          restoreCollectionSnapshot()
        }
        finishDrag()
        return
      }

      if (!sourceData || sourceData.dragType !== CALENDAR_DRAG_TYPE) {
        finishDrag()
        return
      }

      if (sourceData.kind === 'calendar-resize') {
        const nextEnd = resizedCalendarEnd(sourceData, operation)

        setEvents((items) =>
          items.map((calendarEvent) =>
            calendarEvent.id === sourceData.eventId &&
            (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.dateKey
              ? { ...calendarEvent, end: nextEnd }
              : calendarEvent,
          ),
        )

        finishDrag()
        return
      }

      if (sourceData.kind === 'calendar-event') {
        const pointerCalendarTarget = calendarTargetAtPointer(finalPointer)
        const calendarTarget =
          pointerCalendarTarget ||
          (operation.activatorEvent?.type?.startsWith('key') && targetData?.kind === 'calendar-timeline'
            ? target
            : null)
        const calendarTargetData = calendarTarget?.data
        if (calendarTargetData?.kind !== 'calendar-timeline' || !calendarTarget?.element) {
          setEvents((items) =>
            items.filter(
              (calendarEvent) =>
                !(
                  calendarEvent.id === sourceData.eventId &&
                  (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.dateKey
                ),
            ),
          )

          finishDrag()
          return
        }

        const targetDateKey = addDays(
          calendarTargetData.dateKey || CURRENT_DATE_KEY,
          -(sourceData.dayOffset || 0),
        )
        const duration = sourceData.end - sourceData.start
        const deltaY = operation.position.current.y - operation.position.initial.y
        const scrollDelta =
          sourceData.timelineScrollRef?.current?.scrollTop -
            (sourceData.dragStartScrollTopRef?.current || 0) || 0
        const nextStart = calendarStartAfterMove({
          start: sourceData.start,
          duration,
          deltaY,
          scrollDelta,
          allowOvernight: true,
        })

        if (nextStart === sourceData.start && targetDateKey === sourceData.dateKey) {
          finishDrag()
          return
        }

        setEvents((items) =>
          items.map((calendarEvent) =>
            calendarEvent.id === sourceData.eventId &&
            (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.dateKey
              ? {
                  ...calendarEvent,
                  dateKey: targetDateKey,
                  start: nextStart,
                  end: nextStart + duration,
                }
              : calendarEvent,
          ),
        )

        finishDrag()
        return
      }

      const pointerCalendarTarget = calendarTargetAtPointer(finalPointer)
      const calendarTarget =
        pointerCalendarTarget || (targetData?.kind === 'calendar-timeline' ? target : null)
      const calendarTargetData = calendarTarget?.data
      if (
        (sourceData.kind === 'task' || sourceData.kind === 'board-task') &&
        calendarTargetData?.kind === 'calendar-timeline' &&
        calendarTarget?.element
      ) {
        const targetDateKey = calendarTargetData.dateKey || CURRENT_DATE_KEY
        const timelineRect = calendarTarget.element.getBoundingClientRect()
        const duration = Math.max(sourceData.minutes, 30)
        const nextStart = calendarStartAtPointer({
          pointerY: finalPointer.y,
          timelineTop: timelineRect.top,
          duration,
        })

        if (sourceData.kind === 'board-task') {
          restoreBoardSnapshot()
          const currentDateKey = findTaskDateKey(boardStateRef.current, sourceData.taskId)
          if (currentDateKey && currentDateKey !== targetDateKey) {
            moveBoardTask({
              taskId: sourceData.taskId,
              sourceDateKey: currentDateKey,
              targetDateKey,
              syncEventDate: false,
            })
          }
        }

        setEvents((items) => [
          ...items,
          {
            id: nextTaskBlockId(
              sourceData.taskId,
              items.map((event) => event.id),
            ),
            taskId: sourceData.taskId,
            dateKey: targetDateKey,
            title: sourceData.title,
            start: nextStart,
            end: nextStart + duration,
            color: sourceData.color || 'violet',
          },
        ])

        finishDrag()
        return
      }

      if (sourceData.kind !== 'board-task') {
        finishDrag()
        return
      }

      const hadValidBoardProjection = Boolean(lastBoardProjectionRef.current)
      const boardTarget = boardDragTarget(
        operation,
        finalPointer,
        sourceData,
        dragSessionRef.current,
        boardStateRef.current,
      )
      const targetOverride = boardTarget.targetOverride
      const landedOnBoard = boardTarget.blocked
        ? false
        : projectBoardTask(operation, finalPointer, targetOverride)
      const canCommitLastProjection = hadValidBoardProjection && isPointerOverBoard(finalPointer)
      if (!landedOnBoard && !canCommitLastProjection) {
        restoreBoardSnapshot()
        finishDrag()
        return
      }

      const finalDateKey = findTaskDateKey(boardStateRef.current, sourceData.taskId)
      const finalTasks =
        finalDateKey === CURRENT_DATE_KEY
          ? boardStateRef.current.tasks
          : boardStateRef.current.datedTasksByDate[finalDateKey] || []
      if (
        finalDateKey !== sourceData.sourceDateKey ||
        finalTasks.findIndex((task) => task.id === sourceData.taskId) !== sourceData.sourceIndex
      ) {
        replaceWorkspaceDocument(
          commitBoardSessionOrder(getWorkspaceDocument(), sourceData.taskId, sourceData.sourceDateKey),
        )
      }
      if (
        finalDateKey &&
        finalDateKey === dragSessionRef.current?.projectedDateKey &&
        finalDateKey !== sourceData.sourceDateKey
      ) {
        setEvents((items) =>
          items.map((calendarEvent) =>
            (calendarEvent.taskId ?? calendarEvent.id) === sourceData.taskId &&
            (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.sourceDateKey
              ? { ...calendarEvent, dateKey: finalDateKey }
              : calendarEvent,
          ),
        )
      }
      finishDrag()
    } finally {
      calendarEdgeDwell.clear()
      endWorkspaceGesture()
    }
  }
  return { handleDragEnd }
}

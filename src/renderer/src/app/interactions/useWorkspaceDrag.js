import { createDropHandler } from './createDropHandler.js'
import { useDragPresentation } from './useDragPresentation.js'
import { useCollectionDragProjection } from './useCollectionDragProjection.js'
import { useBoardDragProjection } from './useBoardDragProjection.js'
import { useState, useRef } from 'react'

import {
  backlogTargetAtPointer,
  pointerFromNativeEvent,
  boardTargetAtPointer,
  collectionDragTarget,
  isPointerOverCollection,
  boardDragTarget,
  isPointerOverBoard,
  calendarResizeDeltaY,
} from './drag-targets.js'
import { beginWorkspaceGesture } from '../../desktop/workspace-store'
import { sessionDragTaskId, sessionAtPointer } from '../utils/session-drag'

export function useWorkspaceDrag({
  boardStateRef,

  moveBoardTask,
  setEvents,
  weeklyObjectives,

  setToast,
  moveTaskToBacklog,
  setPendingScheduleDrop,
  promoteBacklogTask,
}) {
  const [dragPreviewPresentation, setDragPreviewPresentation] = useState(null)

  const dragSessionRef = useRef(null)

  const lastBoardProjectionRef = useRef('')

  const boardInsertionPreviewRef = useRef(null)

  const boardInsertionPreviewCleanupRef = useRef(null)

  const postDragClickGuardRef = useRef(null)

  const {
    restoreBoardSnapshot,
    armPostDragClickGuard,
    releasePostDragClickGuard,
    clearBoardInsertionPreview,
    showBoardInsertionPreview,
    projectBoardTask,
  } = useBoardDragProjection({
    dragSessionRef,
    boardStateRef,

    postDragClickGuardRef,
    boardInsertionPreviewCleanupRef,
    boardInsertionPreviewRef,
    lastBoardProjectionRef,
    moveBoardTask,
  })

  const { restoreCollectionSnapshot, projectCollectionItem } = useCollectionDragProjection({
    dragSessionRef,
    lastBoardProjectionRef,
  })

  const { updateDragPreviewPresentation } = useDragPresentation({
    dragSessionRef,
    setDragPreviewPresentation,
  })

  const handleDragStart = ({ operation, nativeEvent }) => {
    beginWorkspaceGesture()
    const sourceData = operation.source?.data
    const pointer = pointerFromNativeEvent(nativeEvent)
    const sourceRect = operation.source?.element?.getBoundingClientRect()
    armPostDragClickGuard()
    clearBoardInsertionPreview()
    lastBoardProjectionRef.current = ''
    if (sourceData?.sessionTask) {
      setDragPreviewPresentation({ kind: 'session-task', width: sourceRect?.width })
    } else if (
      sourceData?.backlogTask ||
      sourceData?.kind === 'board-task' ||
      sourceData?.kind === 'calendar-event'
    ) {
      setDragPreviewPresentation({
        kind: sourceData.backlogTask
          ? 'backlog'
          : sourceData.kind === 'calendar-event'
            ? 'calendar'
            : 'board',
        variant: sourceData.preview?.variant,
        width: sourceRect?.width,
      })
    } else {
      setDragPreviewPresentation(null)
    }

    if (sourceData?.kind === 'collection-item') {
      const renderedSourceLaneId =
        operation.source?.element?.dataset.collectionLaneId || sourceData.sourceLaneId
      const renderedSourceIndex = Number(operation.source?.element?.dataset.collectionIndex)
      const currentSourceData = {
        ...sourceData,
        sourceLaneId: renderedSourceLaneId,
        sourceIndex: Number.isInteger(renderedSourceIndex) ? renderedSourceIndex : sourceData.sourceIndex,
      }
      const boardScrollElement = operation.source?.element?.closest?.('[data-board-scroll-container="true"]')
      dragSessionRef.current = {
        kind: 'collection-item',
        sourceData: currentSourceData,
        collectionSnapshot: currentSourceData.collectionSnapshot,
        pointer,
        startPointer: pointer,
        grabOffset:
          sourceRect && pointer
            ? {
                x: pointer.x - sourceRect.left,
                y: pointer.y - sourceRect.top,
              }
            : null,
        verticalDirection: 0,
        horizontalDirection: 0,
        sourceRect: sourceRect
          ? {
              left: sourceRect.left,
              right: sourceRect.right,
              top: sourceRect.top,
              bottom: sourceRect.bottom,
              width: sourceRect.width,
            }
          : null,
        boardScrollElement,
        boardStartScrollLeft: boardScrollElement?.scrollLeft || 0,
        boardStartScrollTop: boardScrollElement?.scrollTop || 0,
        projectedCollectionLaneId: currentSourceData.sourceLaneId,
        projectedCollectionIndex: currentSourceData.sourceIndex,
        collectionOverlapProjectionActive: false,
        collectionTransferDirection: 0,
        previewCardActive: false,
      }
      return
    }

    if (sourceData?.kind === 'board-task') {
      const boardScrollElement = operation.source?.element?.closest?.('[data-board-scroll-container="true"]')
      dragSessionRef.current = {
        kind: 'board-task',
        sourceData: { ...sourceData },
        boardSnapshot: boardStateRef.current,
        pointer,
        startPointer: pointer,
        grabOffset:
          sourceRect && pointer
            ? {
                x: pointer.x - sourceRect.left,
                y: pointer.y - sourceRect.top,
              }
            : null,
        verticalDirection: 0,
        horizontalDirection: 0,
        sourceRect: sourceRect
          ? {
              left: sourceRect.left,
              right: sourceRect.right,
              top: sourceRect.top,
              bottom: sourceRect.bottom,
              width: sourceRect.width,
            }
          : null,
        boardScrollElement,
        boardStartScrollLeft: boardScrollElement?.scrollLeft || 0,
        boardStartScrollTop: boardScrollElement?.scrollTop || 0,
        projectedDateKey: sourceData.sourceDateKey,
        projectedBoardSurfaceId: sourceData.boardSurfaceId,
        overlapProjectionActive: false,
        transferDirection: 0,
      }
      return
    }

    dragSessionRef.current = sourceData
      ? {
          kind: sourceData.kind,
          sourceData: { ...sourceData },
          pointer,
          verticalDirection: 0,
          sourceRect: sourceRect
            ? {
                left: sourceRect.left,
                right: sourceRect.right,
                top: sourceRect.top,
                bottom: sourceRect.bottom,
                width: sourceRect.width,
              }
            : null,
        }
      : null
  }

  const handleDragOver = (event) => {
    const { operation } = event
    const sourceData = dragSessionRef.current?.sourceData || operation.source?.data

    if (
      !sourceData?.sessionTask &&
      sessionDragTaskId(sourceData) &&
      sessionAtPointer(dragSessionRef.current?.pointer || operation.position.current)
    ) {
      event.preventDefault()
      clearBoardInsertionPreview()
      lastBoardProjectionRef.current = ''
      return
    }

    if (
      (sourceData?.kind === 'board-task' || sourceData?.kind === 'calendar-event') &&
      (operation.target?.data?.backlogDropTarget || backlogTargetAtPointer(dragSessionRef.current?.pointer))
    ) {
      event.preventDefault()
      lastBoardProjectionRef.current = ''
      return
    }

    if (sourceData?.kind === 'collection-item') {
      const externalTargetKind = operation.target?.data?.kind
      if (
        sourceData.backlogTask &&
        (externalTargetKind === 'board-task' ||
          externalTargetKind === 'board-column' ||
          externalTargetKind === 'calendar-timeline')
      ) {
        event.preventDefault()
        lastBoardProjectionRef.current = ''
        const pointerBoardTarget = boardTargetAtPointer(
          dragSessionRef.current?.pointer,
          boardStateRef.current,
        )
        if (pointerBoardTarget) {
          showBoardInsertionPreview(pointerBoardTarget, dragSessionRef.current?.pointer, sourceData)
        } else {
          clearBoardInsertionPreview({ animate: true })
        }
        return
      }

      const collectionTarget = collectionDragTarget(
        operation,
        dragSessionRef.current?.pointer,
        sourceData,
        dragSessionRef.current,
      )
      if (collectionTarget.blocked) {
        event.preventDefault()
        return
      }
      const targetOverride = collectionTarget.targetOverride
      const targetKind = targetOverride?.target?.data?.kind || operation.target?.data?.kind
      if (targetKind === 'collection-item' || targetKind === 'collection-lane') {
        event.preventDefault()
        const projected = projectCollectionItem(operation, dragSessionRef.current?.pointer, targetOverride)
        if (
          !projected &&
          !isPointerOverCollection(
            dragSessionRef.current?.pointer,
            sourceData.collectionId,
            sourceData.surfaceId,
          )
        ) {
          lastBoardProjectionRef.current = ''
        }
      } else {
        lastBoardProjectionRef.current = ''
      }
      return
    }

    if (sourceData?.kind !== 'board-task') return

    const boardTarget = boardDragTarget(
      operation,
      dragSessionRef.current?.pointer,
      sourceData,
      dragSessionRef.current,
      boardStateRef.current,
    )
    if (boardTarget.blocked) {
      event.preventDefault()
      return
    }
    const targetOverride = boardTarget.targetOverride
    const targetKind = targetOverride?.target?.data?.kind || operation.target?.data?.kind
    if (targetKind === 'board-task' || targetKind === 'board-column') {
      event.preventDefault()
      const projected = projectBoardTask(operation, dragSessionRef.current?.pointer, targetOverride)
      if (!projected && !isPointerOverBoard(dragSessionRef.current?.pointer)) {
        lastBoardProjectionRef.current = ''
      }
    } else {
      lastBoardProjectionRef.current = ''
    }
  }

  const handleDragMove = ({ operation, nativeEvent }) => {
    const sourceData = dragSessionRef.current?.sourceData || operation.source?.data
    const pointer = pointerFromNativeEvent(nativeEvent) || operation.position.current
    if (dragSessionRef.current && pointer) {
      const previousPointer = dragSessionRef.current.pointer
      const deltaY = previousPointer ? pointer.y - previousPointer.y : 0
      const deltaX = previousPointer ? pointer.x - previousPointer.x : 0
      if (Math.abs(deltaY) >= 1) {
        dragSessionRef.current.verticalDirection = deltaY > 0 ? 1 : -1
      }
      if (Math.abs(deltaX) >= 1) {
        dragSessionRef.current.horizontalDirection = deltaX > 0 ? 1 : -1
      }
      dragSessionRef.current.pointer = pointer
    }
    updateDragPreviewPresentation(sourceData, pointer)
    if (!sourceData?.sessionTask && sessionDragTaskId(sourceData) && sessionAtPointer(pointer)) {
      clearBoardInsertionPreview()
      lastBoardProjectionRef.current = ''
      return
    }

    if (sourceData?.kind === 'calendar-resize') {
      sourceData.onResizePreview?.(calendarResizeDeltaY(operation, pointer))
      return
    }

    if (sourceData?.kind === 'collection-item') {
      if (sourceData.backlogTask) {
        const pointerBoardTarget = boardTargetAtPointer(pointer, boardStateRef.current)
        if (pointerBoardTarget) {
          showBoardInsertionPreview(pointerBoardTarget, pointer, sourceData)
          lastBoardProjectionRef.current = ''
          return
        }
        clearBoardInsertionPreview({ animate: true })
      }

      const collectionTarget = collectionDragTarget(operation, pointer, sourceData, dragSessionRef.current)
      if (collectionTarget.blocked) return
      const targetOverride = collectionTarget.targetOverride
      const targetKind = targetOverride?.target?.data?.kind || operation.target?.data?.kind
      if (targetKind === 'collection-item' || targetKind === 'collection-lane') {
        const projected = projectCollectionItem(operation, pointer, targetOverride)
        if (!projected && !isPointerOverCollection(pointer, sourceData.collectionId, sourceData.surfaceId)) {
          lastBoardProjectionRef.current = ''
        }
      }
      return
    }

    if (sourceData?.kind !== 'board-task') return

    const boardTarget = boardDragTarget(
      operation,
      pointer,
      sourceData,
      dragSessionRef.current,
      boardStateRef.current,
    )
    if (boardTarget.blocked) return
    const targetOverride = boardTarget.targetOverride
    const targetKind = targetOverride?.target?.data?.kind || operation.target?.data?.kind
    if (targetKind === 'board-task' || targetKind === 'board-column') {
      const projected = projectBoardTask(operation, pointer, targetOverride)
      if (!projected && !isPointerOverBoard(pointer)) {
        lastBoardProjectionRef.current = ''
      }
    }
  }

  const { handleDragEnd } = createDropHandler({
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
  })

  return { dragPreviewPresentation, handleDragStart, handleDragOver, handleDragMove, handleDragEnd }
}

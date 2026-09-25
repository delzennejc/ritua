import { restoreBoardLocations } from '../../desktop/workspace-actions'
import {
  POST_DRAG_CLICK_GUARD_DURATION_MS,
  BOARD_INSERTION_PREVIEW_DURATION_MS,
  BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT,
  findTaskDateKey,
  tasksForDateKey,
} from '../utils/workspace-presenters.js'
import { boardInsertionAtPointer, crossedCardReorderThreshold } from './drag-targets.js'

export function useBoardDragProjection({
  dragSessionRef,
  boardStateRef,

  postDragClickGuardRef,
  boardInsertionPreviewCleanupRef,
  boardInsertionPreviewRef,
  lastBoardProjectionRef,
  moveBoardTask,
}) {
  const restoreBoardSnapshot = () => {
    const snapshot = dragSessionRef.current?.boardSnapshot
    if (!snapshot) return

    boardStateRef.current = snapshot
    restoreBoardLocations(snapshot)
  }

  const clearPostDragClickGuard = () => {
    const guard = postDragClickGuardRef.current
    if (!guard) return

    if (guard.timer && typeof window !== 'undefined') {
      window.clearTimeout(guard.timer)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', guard.blockClick, true)
    }
    postDragClickGuardRef.current = null
  }

  const armPostDragClickGuard = () => {
    clearPostDragClickGuard()
    if (typeof document === 'undefined') return

    const blockClick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('click', blockClick, true)
    postDragClickGuardRef.current = { blockClick, timer: null }
  }

  const releasePostDragClickGuard = () => {
    const guard = postDragClickGuardRef.current
    if (!guard) return
    if (typeof window === 'undefined') {
      clearPostDragClickGuard()
      return
    }

    guard.timer = window.setTimeout(clearPostDragClickGuard, POST_DRAG_CLICK_GUARD_DURATION_MS)
  }

  const resetBoardInsertionPreviewElements = (preview) => {
    const stack = preview?.stack
    if (!stack) return

    Array.from(stack.children).forEach((element) => {
      if (element.matches?.('.task-card[data-board-insertion-shift]')) {
        element.removeAttribute('data-board-insertion-shift')
      }
    })
    stack.classList.remove('board-external-insertion-preview')
    stack.style.removeProperty('--board-external-insertion-base-padding')
    stack.style.removeProperty('--board-external-insertion-size')
  }

  const cancelBoardInsertionPreviewCleanup = () => {
    const pendingCleanup = boardInsertionPreviewCleanupRef.current
    if (!pendingCleanup) return

    window.clearTimeout(pendingCleanup.timer)
    resetBoardInsertionPreviewElements(pendingCleanup.preview)
    boardInsertionPreviewCleanupRef.current = null
  }

  const clearBoardInsertionPreview = ({ animate = false } = {}) => {
    const preview = boardInsertionPreviewRef.current
    if (!preview) {
      if (!animate) cancelBoardInsertionPreviewCleanup()
      return
    }
    boardInsertionPreviewRef.current = null
    cancelBoardInsertionPreviewCleanup()

    if (!animate || typeof window === 'undefined' || !preview.stack.isConnected) {
      resetBoardInsertionPreviewElements(preview)
      return
    }

    preview.stack.style.setProperty('--board-external-insertion-size', '0px')
    const timer = window.setTimeout(() => {
      resetBoardInsertionPreviewElements(preview)
      if (boardInsertionPreviewCleanupRef.current?.timer === timer) {
        boardInsertionPreviewCleanupRef.current = null
      }
    }, BOARD_INSERTION_PREVIEW_DURATION_MS)
    boardInsertionPreviewCleanupRef.current = { preview, timer }
  }

  const showBoardInsertionPreview = (target, pointer, sourceData) => {
    if (typeof document === 'undefined' || !target?.element || !pointer) return false
    const column = target.element.closest?.(
      '[data-board-drop-zone="true"][data-board-surface-id][data-date-key]',
    )
    const stack = column?.matches('.task-stack') ? column : column?.querySelector('.task-stack')
    if (!column || !stack) return false

    const cards = Array.from(stack.children).filter((element) =>
      element.matches?.('.task-card[data-board-task-id]'),
    )
    let insertionIndex = cards.length
    if (target.data?.kind === 'board-task') {
      const targetCard =
        target.element.closest?.('.task-card[data-board-task-id]') ||
        cards.find((card) => card.dataset.boardTaskId === target.data.taskId)
      const targetCardIndex = cards.indexOf(targetCard)
      if (targetCardIndex !== -1) {
        const targetRect = targetCard.getBoundingClientRect()
        insertionIndex = targetCardIndex + (pointer.y > targetRect.top + targetRect.height / 2 ? 1 : 0)
      }
    } else if (Number.isInteger(target.data?.insertionVisibleIndex)) {
      insertionIndex = target.data.insertionVisibleIndex
    } else if (target.data?.insertionIndex === 0) {
      insertionIndex = 0
    }

    if (
      sourceData?.boardSurfaceId === 'today-board' &&
      column.dataset.todayStatus !== sourceData.todayStatus
    ) {
      insertionIndex = boardInsertionAtPointer(column, pointer).insertionIndex
    }
    insertionIndex = Math.max(0, Math.min(cards.length, insertionIndex))
    const previewCard = document.querySelector('[data-preview-presentation="board"] .task-card')
    const sourceHasSubtasks = Boolean(sourceData?.itemSnapshot?.subtasks?.length)
    const matchingCard = cards.find((card) => card.classList.contains('has-subtasks') === sourceHasSubtasks)
    const referenceHeight =
      previewCard?.getBoundingClientRect().height ||
      (sourceHasSubtasks ? matchingCard?.getBoundingClientRect().height : 0) ||
      BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT
    const stackStyle = window.getComputedStyle(stack)
    const stackGap = Number.parseFloat(stackStyle.rowGap || stackStyle.gap) || 0
    const insertionSize = Math.max(
      BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT,
      Math.ceil(referenceHeight + stackGap),
    )
    const previewKey = [
      column.dataset.boardSurfaceId,
      column.dataset.dateKey,
      column.dataset.todayStatus || '',
      insertionIndex,
      insertionSize,
    ].join(':')
    const currentPreview = boardInsertionPreviewRef.current
    if (currentPreview?.key === previewKey) return true

    cancelBoardInsertionPreviewCleanup()
    if (currentPreview && currentPreview.stack !== stack) {
      resetBoardInsertionPreviewElements(currentPreview)
    }

    if (!currentPreview || currentPreview.stack !== stack) {
      const basePadding = Number.parseFloat(stackStyle.paddingBottom) || 0
      stack.style.setProperty('--board-external-insertion-base-padding', `${basePadding}px`)
      stack.classList.add('board-external-insertion-preview')
    }
    stack.style.setProperty('--board-external-insertion-size', `${insertionSize}px`)
    cards.forEach((card, index) => {
      if (index >= insertionIndex) {
        card.setAttribute('data-board-insertion-shift', 'true')
      } else {
        card.removeAttribute('data-board-insertion-shift')
      }
    })
    boardInsertionPreviewRef.current = {
      key: previewKey,
      stack,
    }
    return true
  }

  const projectBoardTask = (operation, pointerOverride, targetOverride) => {
    const sourceData = dragSessionRef.current?.sourceData || operation.source?.data
    const target = targetOverride?.target || operation.target
    const targetData = target?.data

    if (
      sourceData?.kind !== 'board-task' ||
      (targetData?.kind !== 'board-task' && targetData?.kind !== 'board-column')
    ) {
      return false
    }

    if (
      sourceData.boardSurfaceId === 'today-board' &&
      targetData.todayStatus &&
      targetData.todayStatus !== sourceData.todayStatus
    ) {
      return false
    }

    const currentBoardState = boardStateRef.current
    const sourceDateKey = findTaskDateKey(currentBoardState, sourceData.taskId)
    const targetDateKey = targetData.dateKey
    if (!sourceDateKey || !targetDateKey) return false

    if (targetData.kind === 'board-task' && targetData.taskId === sourceData.taskId) {
      return true
    }

    const sourceDateTasks = tasksForDateKey(currentBoardState, sourceDateKey)
    const sourceIndex = sourceDateTasks.findIndex((task) => task.id === sourceData.taskId)
    if (sourceIndex === -1) return false
    const pointer = pointerOverride || dragSessionRef.current?.pointer || operation.position.current
    const targetRect = target.element?.getBoundingClientRect()
    if (!targetRect) return false

    const isVisibleCardReorder =
      targetData.kind === 'board-task' &&
      sourceDateKey === targetDateKey &&
      Number.isInteger(targetData.visibleIndex) &&
      Array.isArray(targetData.visibleTaskIds)
    const sourceOrderIndex = isVisibleCardReorder
      ? targetData.visibleTaskIds.indexOf(sourceData.taskId)
      : sourceIndex
    const targetOrderIndex = isVisibleCardReorder ? targetData.visibleIndex : targetData.index
    const cardReorderDirection =
      targetData.kind === 'board-task' && sourceDateKey === targetDateKey
        ? Math.sign(targetOrderIndex - sourceOrderIndex)
        : 0
    const usesCardReorderThreshold = Boolean(cardReorderDirection && dragSessionRef.current?.grabOffset)
    if (
      usesCardReorderThreshold &&
      !crossedCardReorderThreshold(pointer, dragSessionRef.current, targetRect, cardReorderDirection)
    )
      return false
    if (
      !targetOverride?.fromCardOverlap &&
      !usesCardReorderThreshold &&
      (pointer.x < targetRect.left ||
        pointer.x > targetRect.right ||
        pointer.y < targetRect.top ||
        pointer.y > targetRect.bottom)
    )
      return false

    let targetIndex
    let visibleTaskIds
    let projectionPosition = 'end'

    if (targetData.kind === 'board-task') {
      const pointerInsideTarget = pointer.y >= targetRect.top && pointer.y <= targetRect.bottom
      const verticalDirection = usesCardReorderThreshold
        ? cardReorderDirection
        : pointerInsideTarget
          ? dragSessionRef.current?.verticalDirection || 0
          : 0
      const insertAfterTarget =
        verticalDirection === 0 ? pointer.y > targetRect.top + targetRect.height / 2 : verticalDirection > 0
      projectionPosition = insertAfterTarget ? 'after' : 'before'
      const isVisibleSlotReorder =
        sourceDateKey === targetDateKey &&
        Number.isInteger(targetData.visibleIndex) &&
        Array.isArray(targetData.visibleTaskIds)
      const sourceSlotIndex = isVisibleSlotReorder
        ? targetData.visibleTaskIds.indexOf(sourceData.taskId)
        : sourceIndex
      targetIndex =
        (isVisibleSlotReorder ? targetData.visibleIndex : targetData.index) + (insertAfterTarget ? 1 : 0)

      if (sourceDateKey === targetDateKey && sourceSlotIndex < targetIndex) {
        targetIndex -= 1
      }
      visibleTaskIds = isVisibleSlotReorder ? targetData.visibleTaskIds : undefined
    } else {
      const isVisibleSlotReorder =
        sourceDateKey === targetDateKey &&
        Number.isInteger(targetData.insertionVisibleIndex) &&
        Array.isArray(targetData.visibleTaskIds)
      targetIndex = isVisibleSlotReorder ? targetData.insertionVisibleIndex : targetData.insertionIndex
      visibleTaskIds = isVisibleSlotReorder ? targetData.visibleTaskIds : undefined
    }

    const projectionKey = [target.id, targetDateKey, projectionPosition, targetIndex].join(':')
    if (lastBoardProjectionRef.current === projectionKey) return true
    lastBoardProjectionRef.current = projectionKey

    const moved = moveBoardTask({
      taskId: sourceData.taskId,
      sourceDateKey,
      targetDateKey,
      targetIndex,
      visibleTaskIds,
      syncEventDate: false,
    })
    if (moved && dragSessionRef.current) {
      dragSessionRef.current.projectedDateKey = targetDateKey
      dragSessionRef.current.projectedBoardSurfaceId = targetData.boardSurfaceId || sourceData.boardSurfaceId
    }
    return true
  }
  return {
    restoreBoardSnapshot,
    armPostDragClickGuard,
    releasePostDragClickGuard,
    clearBoardInsertionPreview,
    showBoardInsertionPreview,
    projectBoardTask,
  }
}

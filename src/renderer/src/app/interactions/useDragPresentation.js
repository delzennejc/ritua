import {
  backlogTargetAtPointer,
  isMainBacklogSurfaceId,
  boardPreviewTargetAtPointer,
  visibleRightPanelTaskTarget,
  previewWidthForElement,
} from './drag-targets.js'
import {
  BACKLOG_CARD_PREVIEW_EXIT_DISTANCE,
  BACKLOG_CARD_PREVIEW_ENTER_DISTANCE,
  TASK_CARD_POINTER_TOP_OFFSET,
} from '../utils/workspace-presenters.js'

export function useDragPresentation({ dragSessionRef, setDragPreviewPresentation }) {
  const updateDragPreviewPresentation = (sourceData, pointer) => {
    if (sourceData?.session) return
    if (
      !sourceData ||
      !(sourceData.backlogTask || sourceData.kind === 'board-task' || sourceData.kind === 'calendar-event')
    )
      return

    const dragSession = dragSessionRef.current
    const backlogTarget = backlogTargetAtPointer(pointer)
    const mainBacklogLane = Array.from(
      document.querySelectorAll('[data-backlog-drop-zone="true"][data-collection-surface-id]'),
    ).find((lane) => isMainBacklogSurfaceId(lane.dataset.collectionSurfaceId))
    const rightPanel = document.querySelector('.right-panel')
    const pointerHasCrossedLeft = Boolean(
      mainBacklogLane && rightPanel && pointer?.x < rightPanel.getBoundingClientRect().left,
    )
    const boardTarget = boardPreviewTargetAtPointer(pointer)
    const isMainBacklogSource = Boolean(
      sourceData.backlogTask && isMainBacklogSurfaceId(sourceData.surfaceId),
    )
    const earlyRightPanelTarget = isMainBacklogSource ? visibleRightPanelTaskTarget() : null
    const rightwardDistance =
      pointer && dragSession?.startPointer ? pointer.x - dragSession.startPointer.x : 0
    if (isMainBacklogSource && earlyRightPanelTarget && dragSession) {
      dragSession.previewCardActive = dragSession.previewCardActive
        ? rightwardDistance > BACKLOG_CARD_PREVIEW_EXIT_DISTANCE
        : rightwardDistance >= BACKLOG_CARD_PREVIEW_ENTER_DISTANCE
    }

    const cardPreviewPresentation = (target) => {
      const width = target?.width || dragSession?.sourceRect?.width
      const sourceWidth = dragSession?.sourceRect?.width
      const grabOffset = dragSession?.grabOffset
      if (!width || !sourceWidth || !grabOffset) {
        return { kind: 'board', width }
      }

      const proportionalGrabX = (grabOffset.x / sourceWidth) * width
      const desiredGrabX = Math.max(24, Math.min(width - 24, proportionalGrabX))
      return {
        kind: 'board',
        width,
        offsetX: Math.round(grabOffset.x - desiredGrabX),
        offsetY: Math.round(grabOffset.y - TASK_CARD_POINTER_TOP_OFFSET),
      }
    }

    let nextPresentation
    if (sourceData.backlogTask && (boardTarget || dragSession?.previewCardActive)) {
      nextPresentation = cardPreviewPresentation(boardTarget || earlyRightPanelTarget)
    } else if (backlogTarget || (pointerHasCrossedLeft && !sourceData.backlogTask)) {
      const lane = backlogTarget?.element?.closest?.('[data-backlog-drop-zone="true"]') || mainBacklogLane
      nextPresentation = {
        kind: 'backlog',
        variant: lane?.dataset.collectionSurfaceId === 'right-panel-backlog' ? 'panel' : 'main',
        width: previewWidthForElement(lane),
      }
    } else {
      nextPresentation = {
        kind: sourceData.backlogTask
          ? 'backlog'
          : sourceData.kind === 'calendar-event'
            ? 'calendar'
            : 'board',
        variant: sourceData.preview?.variant,
        width: dragSessionRef.current?.sourceRect?.width,
      }
    }

    setDragPreviewPresentation((current) =>
      current?.kind === nextPresentation.kind &&
      current?.variant === nextPresentation.variant &&
      current?.width === nextPresentation.width &&
      current?.offsetX === nextPresentation.offsetX &&
      current?.offsetY === nextPresentation.offsetY
        ? current
        : nextPresentation,
    )
  }
  return { updateDragPreviewPresentation }
}

import { calendarEndAfterResize } from '../utils/calendar'
import {
  CARD_CROSSING_THRESHOLD_RATIO,
  tasksForDateKey,
  BOARD_TRANSFER_OVERLAP_RATIO,
  NAVIGATION_AREA_COLLECTION_ID,
  NAVIGATION_AREA_SURFACE_ID,
  WEEKLY_OBJECTIVE_COLLECTION_ID,
  RIGHT_PANEL_OBJECTIVE_SURFACE_ID,
  THIS_WEEK_OBJECTIVE_LANE_ID,
  OTHER_OBJECTIVE_LANE_ID,
} from '../utils/workspace-presenters.js'
import { RIGHT_PANEL_BACKLOG_COLLECTION_ID } from '../utils/collections'
import { isTodayBoardStatus } from '../utils/board'

export const isMainBacklogSurfaceId = (surfaceId) =>
  surfaceId === 'backlog-main' || surfaceId?.startsWith('backlog-main-')

export const pointerFromNativeEvent = (nativeEvent) =>
  Number.isFinite(nativeEvent?.clientX) && Number.isFinite(nativeEvent?.clientY)
    ? { x: nativeEvent.clientX, y: nativeEvent.clientY }
    : null

export const calendarResizeDeltaY = (operation, pointer) =>
  Number.isFinite(pointer?.y)
    ? pointer.y - operation.position.initial.y
    : operation.position.current.y - operation.position.initial.y

export const resizedCalendarEnd = (sourceData, operation) => {
  const scrollDelta =
    sourceData.timelineScrollRef?.current?.scrollTop - (sourceData.dragStartScrollTopRef?.current || 0) || 0

  return calendarEndAfterResize({
    start: sourceData.start,
    end: sourceData.end,
    deltaY: calendarResizeDeltaY(operation),
    scrollDelta,
    maxEnd: sourceData.maxEnd,
  })
}

export const draggedCardRectAtPointer = (pointer, session) => {
  if (!pointer || !session?.sourceRect || !session.grabOffset) return null
  const height = session.sourceRect.bottom - session.sourceRect.top
  if (height <= 0) return null
  const top = pointer.y - session.grabOffset.y
  return {
    top,
    bottom: top + height,
    height,
  }
}

export const crossedCardReorderThreshold = (pointer, session, targetRect, direction) => {
  const dragRect = draggedCardRectAtPointer(pointer, session)
  if (!dragRect || !targetRect || !direction) return false
  const threshold = dragRect.height * CARD_CROSSING_THRESHOLD_RATIO
  return direction > 0
    ? dragRect.bottom >= targetRect.top + threshold
    : dragRect.top <= targetRect.bottom - threshold
}

export const horizontalOverlap = (dragRect, columnRect) =>
  Math.max(0, Math.min(dragRect.right, columnRect.right) - Math.max(dragRect.left, columnRect.left))

// Measure layout positions, excluding the animated insertion gap, so a stationary
// pointer cannot alternate between slots as the cards slide underneath it.
export const boardInsertionAtPointer = (column, pointer) => {
  const stack = column?.matches('.task-stack') ? column : column?.querySelector('.task-stack')
  const cards = Array.from(stack?.children || []).filter((card) =>
    card.matches('.task-card[data-board-task-id]'),
  )
  const index = pointer
    ? cards.findIndex((card) => {
        const rect = card.getBoundingClientRect()
        const translate = window.getComputedStyle(card).translate.split(' ')
        const shift = Number.parseFloat(translate[1]) || 0
        return pointer.y < rect.top - shift + rect.height / 2
      })
    : -1
  const insertionIndex = index === -1 ? cards.length : index
  const anchor = cards[insertionIndex] || cards.at(-1)
  return {
    stack,
    cards,
    insertionIndex,
    insertion: anchor
      ? {
          taskId: anchor.dataset.boardTaskId,
          position: insertionIndex === cards.length ? 'after' : 'before',
        }
      : undefined,
  }
}

export const boardTargetFromColumn = (column, boardState, pointer) => {
  const dateKey = column.dataset.dateKey
  const boardSurfaceId = column.dataset.boardSurfaceId
  const todayStatus = column.dataset.todayStatus
  if (!dateKey || !boardSurfaceId) return null

  const dateTasks = tasksForDateKey(boardState, dateKey)
  const taskStack = column.matches('.task-stack') ? column : column.querySelector('.task-stack')
  const cardEntries = Array.from(taskStack?.children || [])
    .filter((element) => element.matches('.task-card[data-board-task-id]'))
    .map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      taskId: element.dataset.boardTaskId,
    }))
  const visibleTaskIds = cardEntries.map(({ taskId }) => taskId)
  const isFilteredBoard = visibleTaskIds.length !== dateTasks.length
  const targetCard = cardEntries.find(({ rect }) => pointer.y <= rect.bottom)

  if (targetCard) {
    const index = dateTasks.findIndex((task) => task.id === targetCard.taskId)
    if (index === -1) return null

    return {
      id: `board-task:${boardSurfaceId}:${dateKey}:${targetCard.taskId}`,
      element: targetCard.element,
      data: {
        kind: 'board-task',
        taskId: targetCard.taskId,
        dateKey,
        index,
        visibleIndex: isFilteredBoard ? visibleTaskIds.indexOf(targetCard.taskId) : undefined,
        visibleTaskIds: isFilteredBoard ? visibleTaskIds : undefined,
        boardSurfaceId,
        ...(isTodayBoardStatus(todayStatus) ? { todayStatus } : {}),
      },
    }
  }

  const insertAtStart = Boolean(cardEntries.length && pointer.y < cardEntries[0].rect.top)

  return {
    id: isTodayBoardStatus(todayStatus)
      ? `today-board-column:${boardSurfaceId}:${dateKey}:${todayStatus}`
      : `board-column:${boardSurfaceId}:${dateKey}`,
    element: column,
    data: {
      kind: 'board-column',
      dateKey,
      insertionIndex: insertAtStart ? 0 : dateTasks.length,
      insertionVisibleIndex: isFilteredBoard ? (insertAtStart ? 0 : visibleTaskIds.length) : undefined,
      visibleTaskIds: isFilteredBoard ? visibleTaskIds : undefined,
      boardSurfaceId,
      ...(isTodayBoardStatus(todayStatus) ? { todayStatus } : {}),
    },
  }
}

export const boardTargetFromItemElement = (column, element, boardState) => {
  const dateKey = column?.dataset.dateKey
  const boardSurfaceId = column?.dataset.boardSurfaceId
  const todayStatus = column?.dataset.todayStatus
  const taskId = element?.dataset.boardTaskId
  if (!dateKey || !boardSurfaceId || !taskId) return null

  const dateTasks = tasksForDateKey(boardState, dateKey)
  const taskStack = column.matches('.task-stack') ? column : column.querySelector('.task-stack')
  const visibleTaskIds = Array.from(taskStack?.children || [])
    .filter((card) => card.matches('.task-card[data-board-task-id]'))
    .map((card) => card.dataset.boardTaskId)
  const index = dateTasks.findIndex((task) => task.id === taskId)
  if (index === -1) return null
  const isFilteredBoard = visibleTaskIds.length !== dateTasks.length

  return {
    id: `board-task:${boardSurfaceId}:${dateKey}:${taskId}`,
    element,
    data: {
      kind: 'board-task',
      taskId,
      dateKey,
      index,
      visibleIndex: isFilteredBoard ? visibleTaskIds.indexOf(taskId) : undefined,
      visibleTaskIds: isFilteredBoard ? visibleTaskIds : undefined,
      boardSurfaceId,
      ...(isTodayBoardStatus(todayStatus) ? { todayStatus } : {}),
    },
  }
}

export const verticalBoardTargetAtThreshold = (pointer, sourceData, session, boardState) => {
  if (
    typeof document === 'undefined' ||
    !pointer ||
    sourceData?.kind !== 'board-task' ||
    !session?.sourceRect ||
    !session.grabOffset ||
    !session?.verticalDirection
  )
    return null

  const boardSurfaceId = session.projectedBoardSurfaceId || sourceData.boardSurfaceId
  const dateKey = session.projectedDateKey || sourceData.sourceDateKey
  const column = Array.from(
    document.querySelectorAll('[data-board-drop-zone="true"][data-board-surface-id][data-date-key]'),
  ).find(
    (element) =>
      element.dataset.boardSurfaceId === boardSurfaceId &&
      element.dataset.dateKey === dateKey &&
      (!session.projectedTodayStatus || element.dataset.todayStatus === session.projectedTodayStatus),
  )
  if (!column) return null

  const columnRect = column.getBoundingClientRect()
  if (pointer.x < columnRect.left || pointer.x > columnRect.right) return null

  const taskStack = column.matches('.task-stack') ? column : column.querySelector('.task-stack')
  const cards = Array.from(taskStack?.children || []).filter((element) =>
    element.matches('.task-card[data-board-task-id]'),
  )
  const sourcePosition = cards.findIndex((element) => element.dataset.boardTaskId === sourceData.taskId)
  if (sourcePosition === -1) return null

  const targetElement = cards[sourcePosition + session.verticalDirection]
  if (!targetElement) return { blocked: true }
  const targetRect = targetElement.getBoundingClientRect()
  if (!crossedCardReorderThreshold(pointer, session, targetRect, session.verticalDirection)) {
    return { blocked: true }
  }

  const target = boardTargetFromItemElement(column, targetElement, boardState)
  return target ? { target, fromCardReorderThreshold: true } : { blocked: true }
}

export const overlapBoardTarget = (operation, pointer, session, boardState) => {
  if (typeof document === 'undefined' || !pointer || !session?.sourceRect || !session.horizontalDirection) {
    return null
  }

  const deltaX = operation.position.current.x - operation.position.initial.x
  const deltaY = operation.position.current.y - operation.position.initial.y
  const scrollDeltaX = session.boardScrollElement
    ? session.boardScrollElement.scrollLeft - session.boardStartScrollLeft
    : 0
  const scrollDeltaY = session.boardScrollElement
    ? session.boardScrollElement.scrollTop - session.boardStartScrollTop
    : 0
  const dragRect = {
    left: session.sourceRect.left + deltaX - scrollDeltaX,
    right: session.sourceRect.right + deltaX - scrollDeltaX,
    top: session.sourceRect.top + deltaY - scrollDeltaY,
    bottom: session.sourceRect.bottom + deltaY - scrollDeltaY,
    width: session.sourceRect.width,
  }
  const boardSurfaceId = session.projectedBoardSurfaceId || session.sourceData.boardSurfaceId
  const projectedDateKey = session.projectedDateKey || session.sourceData.sourceDateKey
  const columns = Array.from(
    document.querySelectorAll('[data-board-drop-zone="true"][data-board-surface-id][data-date-key]'),
  ).filter(
    (column) =>
      column.dataset.boardSurfaceId === boardSurfaceId &&
      (!session.projectedTodayStatus || column.dataset.todayStatus === session.projectedTodayStatus),
  )
  const currentColumn = columns.find((column) => column.dataset.dateKey === projectedDateKey)
  if (!currentColumn) return null

  const currentRect = currentColumn.getBoundingClientRect()
  const inVerticalRange = (rect) => dragRect.bottom > rect.top && dragRect.top < rect.bottom
  const overlapRatio = (rect) => horizontalOverlap(dragRect, rect) / dragRect.width
  const currentOverlapRatio = overlapRatio(currentRect)
  const reversingDirection =
    session.overlapProjectionActive &&
    session.transferDirection &&
    session.horizontalDirection !== session.transferDirection
  if (
    reversingDirection &&
    inVerticalRange(currentRect) &&
    currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = boardTargetFromColumn(currentColumn, boardState, pointer)
    return target ? { target, fromCardOverlap: true } : null
  }

  const currentColumnIndex = columns.indexOf(currentColumn)
  const nextColumn = columns[currentColumnIndex + session.horizontalDirection]
  const nextRect = nextColumn?.getBoundingClientRect()
  const crossesNextColumn = Boolean(
    nextRect && inVerticalRange(nextRect) && overlapRatio(nextRect) >= BOARD_TRANSFER_OVERLAP_RATIO,
  )

  if (nextColumn && crossesNextColumn) {
    const target = boardTargetFromColumn(nextColumn, boardState, pointer)
    if (!target) return null
    session.overlapProjectionActive = true
    session.transferDirection = session.horizontalDirection
    return {
      target,
      fromCardOverlap: true,
    }
  }

  if (
    session.overlapProjectionActive &&
    inVerticalRange(currentRect) &&
    currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = boardTargetFromColumn(currentColumn, boardState, pointer)
    if (!target) return null
    return {
      target,
      fromCardOverlap: true,
    }
  }

  return null
}

export const boardDragTarget = (operation, pointer, sourceData, session, boardState) => {
  const overlapTarget = overlapBoardTarget(operation, pointer, session, boardState)
  if (overlapTarget) return { targetOverride: overlapTarget }

  const reorderTarget = verticalBoardTargetAtThreshold(pointer, sourceData, session, boardState)
  if (reorderTarget?.blocked) return { blocked: true }
  return {
    targetOverride: reorderTarget?.target ? reorderTarget : null,
  }
}

export const isPointerOverBoard = (pointer) => {
  if (typeof document === 'undefined') return false
  if (!pointer) return false
  return Boolean(document.elementFromPoint(pointer.x, pointer.y)?.closest?.('[data-board-drop-zone="true"]'))
}

export const boardTargetAtPointer = (pointer, boardState) => {
  if (typeof document === 'undefined' || !pointer) return null
  const column = document
    .elementFromPoint(pointer.x, pointer.y)
    ?.closest?.('[data-board-drop-zone="true"][data-board-surface-id][data-date-key]')
  return column ? boardTargetFromColumn(column, boardState, pointer) : null
}

export const todayBoardTargetAtPointer = (pointer, operationTarget, activatorEvent) => {
  const targetData = operationTarget?.data
  const targetElement = operationTarget?.element
  let element = null
  if (typeof document !== 'undefined' && pointer) {
    element = document
      .elementFromPoint(pointer.x, pointer.y)
      ?.closest?.('[data-board-drop-zone="true"][data-board-surface-id][data-date-key][data-today-status]')
  }
  if (!element && activatorEvent?.type?.startsWith('key') && targetData?.todayStatus) {
    element =
      targetElement?.closest?.(
        '[data-board-drop-zone="true"][data-board-surface-id][data-date-key][data-today-status]',
      ) ||
      (targetElement?.matches?.(
        '[data-board-drop-zone="true"][data-board-surface-id][data-date-key][data-today-status]',
      )
        ? targetElement
        : null)
  }
  const todayStatus = element?.dataset.todayStatus
  if (!element || element.dataset.boardSurfaceId !== 'today-board' || !isTodayBoardStatus(todayStatus)) {
    return null
  }
  return {
    id: `today-board-column:${element.dataset.boardSurfaceId}:${element.dataset.dateKey}:${todayStatus}`,
    element,
    data: {
      kind: 'today-board-column',
      boardSurfaceId: element.dataset.boardSurfaceId,
      dateKey: element.dataset.dateKey,
      todayStatus,
    },
  }
}

export const calendarTargetAtPointer = (pointer) => {
  if (typeof document === 'undefined' || !pointer) return null
  const element = document
    .elementFromPoint(pointer.x, pointer.y)
    ?.closest?.('[data-calendar-drop-zone="true"][data-date-key]')
  if (!element) return null

  return {
    id: `calendar-timeline:${element.dataset.dateKey}`,
    element,
    data: {
      kind: 'calendar-timeline',
      dateKey: element.dataset.dateKey,
    },
  }
}

export const backlogDropDataFromElement = (element) => {
  const backlogDropTarget = element.dataset.backlogDropZone === 'true'
  const backlogScheduleTarget = element.dataset.backlogScheduleTarget === 'true'
  if (!backlogDropTarget && !backlogScheduleTarget) return {}

  return {
    backlogDropTarget,
    backlogScheduleTarget,
    backlogGroupLabel: element.dataset.backlogGroupLabel,
    backlogChannel: element.dataset.backlogChannel,
    backlogContextual: element.dataset.backlogContextual === 'true',
    backlogObjectiveId: element.dataset.backlogObjectiveId || null,
  }
}

export const collectionTargetFromLane = (lane, pointer) => {
  const collectionId = lane.dataset.collectionId
  const laneId = lane.dataset.collectionLaneId
  const surfaceId = lane.dataset.collectionSurfaceId
  if (!collectionId || !laneId || !surfaceId) return null
  const externalDropData = backlogDropDataFromElement(lane)

  const itemEntries = Array.from(lane.querySelectorAll('[data-collection-item-id]'))
    .filter((element) => element.closest('[data-collection-drop-zone="true"]') === lane)
    .map((element) => ({
      element,
      index: Number(element.dataset.collectionIndex),
      itemId: element.dataset.collectionItemId,
      rect: element.getBoundingClientRect(),
    }))
  const targetItem = itemEntries.find(({ rect }) => pointer.y <= rect.bottom)

  if (targetItem) {
    return {
      id: `collection-item:${surfaceId}:${collectionId}:${targetItem.itemId}`,
      element: targetItem.element,
      data: {
        kind: 'collection-item',
        collectionId,
        index: targetItem.index,
        itemId: targetItem.itemId,
        laneId,
        surfaceId,
        ...externalDropData,
      },
    }
  }

  const insertAtStart = Boolean(itemEntries.length && pointer.y < itemEntries[0].rect.top)

  return {
    id: `collection-lane:${surfaceId}:${collectionId}:${laneId}`,
    element: lane,
    data: {
      kind: 'collection-lane',
      collectionId,
      insertionIndex: insertAtStart ? 0 : itemEntries.length,
      referenceItemId: insertAtStart ? itemEntries[0]?.itemId : itemEntries[itemEntries.length - 1]?.itemId,
      insertAfterReference: !insertAtStart,
      laneId,
      surfaceId,
      ...externalDropData,
    },
  }
}

export const collectionTargetFromItemElement = (element) => {
  const lane = element?.closest?.('[data-collection-drop-zone="true"]')
  const collectionId = lane?.dataset.collectionId
  const laneId = lane?.dataset.collectionLaneId
  const surfaceId = lane?.dataset.collectionSurfaceId
  const itemId = element?.dataset.collectionItemId
  const index = Number(element?.dataset.collectionIndex)
  if (!lane || !collectionId || !laneId || !surfaceId || !itemId) return null

  return {
    id: `collection-item:${surfaceId}:${collectionId}:${itemId}`,
    element,
    data: {
      kind: 'collection-item',
      collectionId,
      index: Number.isFinite(index) ? index : 0,
      itemId,
      laneId,
      surfaceId,
      ...backlogDropDataFromElement(lane),
    },
  }
}

export const collectionLaneFromProxy = (proxy) => {
  if (!proxy || typeof document === 'undefined') return null
  const collectionId = proxy.dataset.collectionId
  const laneId = proxy.dataset.collectionLaneId
  const surfaceId = proxy.dataset.collectionSurfaceId
  if (!collectionId || !laneId || !surfaceId) return null

  return (
    Array.from(document.querySelectorAll('[data-collection-drop-zone="true"]')).find(
      (lane) =>
        lane.dataset.collectionId === collectionId &&
        lane.dataset.collectionLaneId === laneId &&
        lane.dataset.collectionSurfaceId === surfaceId,
    ) || null
  )
}

export const collectionTargetFromProxy = (proxy) => {
  const lane = collectionLaneFromProxy(proxy)
  if (!lane) return null

  const collectionId = proxy.dataset.collectionId
  const laneId = proxy.dataset.collectionLaneId
  const surfaceId = proxy.dataset.collectionSurfaceId
  const insertionIndex = Number(proxy.dataset.collectionInsertionIndex)
  return {
    id: `collection-proxy:${surfaceId}:${collectionId}:${laneId}`,
    element: proxy,
    data: {
      kind: 'collection-lane',
      collectionId,
      laneId,
      insertionIndex: Number.isFinite(insertionIndex) ? insertionIndex : 0,
      surfaceId,
      ...backlogDropDataFromElement(proxy),
    },
  }
}

export const backlogTargetAtPointer = (pointer) => {
  if (typeof document === 'undefined' || !pointer) return null
  const element = document.elementFromPoint(pointer.x, pointer.y)
  const lane = element?.closest?.('[data-backlog-drop-zone="true"][data-collection-drop-zone="true"]')
  if (lane) return collectionTargetFromLane(lane, pointer)

  const proxy = element?.closest?.('[data-collection-drop-proxy="true"]')
  const proxyTarget = collectionTargetFromProxy(proxy)
  if (proxyTarget) return proxyTarget

  const page = element?.closest?.('[data-backlog-page-drop-zone="true"]')
  if (!page) return null
  return {
    id: `backlog-page:${page.dataset.backlogPageScope}`,
    element: page,
    data: {
      kind: 'backlog-page',
      scope: page.dataset.backlogPageScope,
      ...backlogDropDataFromElement(page),
    },
  }
}

export const previewWidthForElement = (element) => {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return rect.width > 0 ? Math.round(rect.width) : null
}

export const boardPreviewTargetFromPane = (pane) => {
  if (!pane) return null

  const taskCard = pane.querySelector?.('.task-card:not(.dragging)')
  const boardStack = pane.querySelector?.('.task-stack')
  const calendarTimeline = pane.matches?.('[data-calendar-drop-zone="true"]')
    ? pane
    : pane.querySelector?.('[data-calendar-drop-zone="true"]')
  return {
    element: pane,
    width:
      previewWidthForElement(taskCard) ||
      previewWidthForElement(boardStack) ||
      previewWidthForElement(calendarTimeline) ||
      previewWidthForElement(pane),
  }
}

export const boardPreviewTargetAtPointer = (pointer) => {
  if (typeof document === 'undefined' || !pointer) return null
  const element = document.elementFromPoint(pointer.x, pointer.y)
  const pane = element?.closest?.(
    '.right-panel-board, .right-panel-calendar, [data-board-drop-zone="true"], [data-calendar-drop-zone="true"]',
  )
  return boardPreviewTargetFromPane(pane)
}

export const visibleRightPanelTaskTarget = () => {
  if (typeof document === 'undefined') return null
  return boardPreviewTargetFromPane(
    document.querySelector('.right-panel.right-panel-board, .right-panel.right-panel-calendar'),
  )
}

export const overlapCollectionTarget = (operation, pointer, session) => {
  if (typeof document === 'undefined' || !pointer || !session?.sourceRect || !session.horizontalDirection) {
    return null
  }

  const surfaceId = session.sourceData.surfaceId
  const collectionId = session.sourceData.collectionId
  const lanes = Array.from(
    document.querySelectorAll('[data-collection-drop-zone="true"][data-collection-axis="horizontal"]'),
  ).filter(
    (lane) => lane.dataset.collectionSurfaceId === surfaceId && lane.dataset.collectionId === collectionId,
  )
  if (lanes.length < 2) return null

  const deltaX = operation.position.current.x - operation.position.initial.x
  const deltaY = operation.position.current.y - operation.position.initial.y
  const scrollDeltaX = session.boardScrollElement
    ? session.boardScrollElement.scrollLeft - session.boardStartScrollLeft
    : 0
  const scrollDeltaY = session.boardScrollElement
    ? session.boardScrollElement.scrollTop - session.boardStartScrollTop
    : 0
  const dragRect = {
    left: session.sourceRect.left + deltaX - scrollDeltaX,
    right: session.sourceRect.right + deltaX - scrollDeltaX,
    top: session.sourceRect.top + deltaY - scrollDeltaY,
    bottom: session.sourceRect.bottom + deltaY - scrollDeltaY,
    width: session.sourceRect.width,
  }
  const projectedLaneId = session.projectedCollectionLaneId || session.sourceData.sourceLaneId
  const currentLane = lanes.find((lane) => lane.dataset.collectionLaneId === projectedLaneId)
  if (!currentLane) return null

  const inVerticalRange = (rect) => dragRect.bottom > rect.top && dragRect.top < rect.bottom
  const overlapRatio = (rect) => horizontalOverlap(dragRect, rect) / dragRect.width
  const currentRect = currentLane.getBoundingClientRect()
  const currentOverlapRatio = overlapRatio(currentRect)
  const reversingDirection =
    session.collectionOverlapProjectionActive &&
    session.collectionTransferDirection &&
    session.horizontalDirection !== session.collectionTransferDirection

  if (
    reversingDirection &&
    inVerticalRange(currentRect) &&
    currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = collectionTargetFromLane(currentLane, pointer)
    return target ? { target, fromItemOverlap: true } : null
  }

  const currentLaneIndex = lanes.indexOf(currentLane)
  const nextLane = lanes[currentLaneIndex + session.horizontalDirection]
  const nextRect = nextLane?.getBoundingClientRect()
  if (nextLane && inVerticalRange(nextRect) && overlapRatio(nextRect) >= BOARD_TRANSFER_OVERLAP_RATIO) {
    const target = collectionTargetFromLane(nextLane, pointer)
    if (!target) return null
    session.collectionOverlapProjectionActive = true
    session.collectionTransferDirection = session.horizontalDirection
    return { target, fromItemOverlap: true }
  }

  if (
    session.collectionOverlapProjectionActive &&
    inVerticalRange(currentRect) &&
    currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = collectionTargetFromLane(currentLane, pointer)
    return target ? { target, fromItemOverlap: true } : null
  }

  return null
}

export const collectionTargetAtPointer = (pointer, sourceData, surfaceId = sourceData?.surfaceId) => {
  if (typeof document === 'undefined' || !pointer || !sourceData) return null

  let element = document.elementFromPoint(pointer.x, pointer.y)
  while (element) {
    if (
      element.dataset?.collectionDropZone === 'true' &&
      element.dataset.collectionId === sourceData.collectionId &&
      (!surfaceId || element.dataset.collectionSurfaceId === surfaceId)
    ) {
      return collectionTargetFromLane(element, pointer)
    }
    if (
      element.dataset?.collectionDropProxy === 'true' &&
      element.dataset.collectionId === sourceData.collectionId &&
      (!surfaceId || element.dataset.collectionSurfaceId === surfaceId)
    ) {
      const proxyTarget = collectionTargetFromProxy(element)
      if (proxyTarget) return proxyTarget
    }
    element = element.parentElement
  }

  return null
}

export const navigationAreaEdgeTargetAtPointer = (pointer, sourceData) => {
  if (
    typeof document === 'undefined' ||
    !pointer ||
    sourceData?.collectionId !== NAVIGATION_AREA_COLLECTION_ID ||
    sourceData.surfaceId !== NAVIGATION_AREA_SURFACE_ID
  )
    return null

  const lane = Array.from(document.querySelectorAll('[data-collection-drop-zone="true"]')).find(
    (element) =>
      element.dataset.collectionId === sourceData.collectionId &&
      element.dataset.collectionSurfaceId === sourceData.surfaceId &&
      element.dataset.collectionLaneId === sourceData.sourceLaneId,
  )
  const navigation = lane?.closest?.('nav')
  if (!lane || !navigation) return null

  const laneRect = lane.getBoundingClientRect()
  const navigationRect = navigation.getBoundingClientRect()
  const withinNavigationColumn =
    pointer.x >= laneRect.left &&
    pointer.x <= laneRect.right &&
    pointer.y >= navigationRect.top &&
    pointer.y <= navigationRect.bottom
  if (!withinNavigationColumn) return null

  const edge = pointer.y < laneRect.top ? 'start' : pointer.y > laneRect.bottom ? 'end' : null
  if (!edge) return null

  const collectionLength = Number(lane.dataset.collectionLength)
  return {
    target: {
      id: `collection-edge:${sourceData.surfaceId}:${sourceData.collectionId}:${edge}`,
      element: lane,
      data: {
        kind: 'collection-lane',
        collectionId: sourceData.collectionId,
        insertionIndex: edge === 'start' ? 0 : Number.isFinite(collectionLength) ? collectionLength : 0,
        laneId: sourceData.sourceLaneId,
        surfaceId: sourceData.surfaceId,
      },
    },
    fromCollectionEdgeIntent: true,
  }
}

export const rightPanelObjectiveTargetAtThreshold = (pointer, sourceData, session) => {
  if (
    typeof document === 'undefined' ||
    !pointer ||
    !session?.sourceRect ||
    !session.grabOffset ||
    sourceData?.collectionId !== WEEKLY_OBJECTIVE_COLLECTION_ID ||
    sourceData.surfaceId !== RIGHT_PANEL_OBJECTIVE_SURFACE_ID
  )
    return null

  const boundary = document.querySelector('.right-panel-objective-boundary')
  const pane = boundary?.closest?.('.objectives-pane-content')
  const focusedLane = document.querySelector(
    `[data-collection-drop-zone="true"]` +
      `[data-collection-id="${WEEKLY_OBJECTIVE_COLLECTION_ID}"]` +
      `[data-collection-surface-id="${RIGHT_PANEL_OBJECTIVE_SURFACE_ID}"]` +
      `[data-collection-lane-id="${THIS_WEEK_OBJECTIVE_LANE_ID}"]`,
  )
  const otherLane = document.querySelector(
    `[data-collection-drop-zone="true"]` +
      `[data-collection-id="${WEEKLY_OBJECTIVE_COLLECTION_ID}"]` +
      `[data-collection-surface-id="${RIGHT_PANEL_OBJECTIVE_SURFACE_ID}"]` +
      `[data-collection-lane-id="${OTHER_OBJECTIVE_LANE_ID}"]`,
  )
  if (!boundary || !pane || !focusedLane || !otherLane) return null

  const paneRect = pane.getBoundingClientRect()
  if (
    pointer.x < paneRect.left ||
    pointer.x > paneRect.right ||
    pointer.y < paneRect.top ||
    pointer.y > paneRect.bottom
  )
    return null

  const sourceHeight = session.sourceRect.bottom - session.sourceRect.top
  if (sourceHeight <= 0) return null
  const boundaryRect = boundary.getBoundingClientRect()
  const boundaryY = boundaryRect.top + boundaryRect.height / 2
  const draggedTop = pointer.y - session.grabOffset.y
  const draggedBottom = draggedTop + sourceHeight
  const overlapAboveBoundary = Math.max(0, Math.min(1, (boundaryY - draggedTop) / sourceHeight))
  const overlapBelowBoundary = Math.max(0, Math.min(1, (draggedBottom - boundaryY) / sourceHeight))
  const startedInThisWeek = sourceData.sourceLaneId === THIS_WEEK_OBJECTIVE_LANE_ID
  const targetLane = startedInThisWeek
    ? overlapBelowBoundary >= CARD_CROSSING_THRESHOLD_RATIO
      ? otherLane
      : focusedLane
    : overlapAboveBoundary >= CARD_CROSSING_THRESHOLD_RATIO
      ? focusedLane
      : otherLane

  const target = collectionTargetFromLane(targetLane, pointer)
  return target ? { target, fromBoundaryThreshold: true } : null
}

export const rightPanelTaskTemporalTargetAtThreshold = (pointer, sourceData, session) => {
  if (
    typeof document === 'undefined' ||
    !pointer ||
    !session?.sourceRect ||
    !session.grabOffset ||
    sourceData?.collectionId !== RIGHT_PANEL_BACKLOG_COLLECTION_ID ||
    sourceData.surfaceId !== 'right-panel-backlog'
  )
    return null

  const currentLaneId = session.projectedCollectionLaneId || sourceData.sourceLaneId
  const currentLane = Array.from(document.querySelectorAll('[data-collection-drop-zone="true"]')).find(
    (element) =>
      element.dataset.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID &&
      element.dataset.collectionSurfaceId === 'right-panel-backlog' &&
      element.dataset.collectionLaneId === currentLaneId,
  )
  const group = currentLane?.closest?.('.right-panel-backlog-group')
  if (!group) return null

  const temporalLanes = Array.from(group.querySelectorAll('[data-collection-drop-zone="true"]')).filter(
    (element) =>
      element.closest('.right-panel-backlog-group') === group &&
      element.dataset.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID &&
      element.dataset.collectionSurfaceId === 'right-panel-backlog' &&
      element.dataset.collectionLaneId?.startsWith('later::'),
  )
  const anytimeLane = temporalLanes.find((element) => element.dataset.backlogGroupLabel === 'Anytime')
  const somedayLane = temporalLanes.find((element) => element.dataset.backlogGroupLabel === 'Someday')
  const boundary = Array.from(group.querySelectorAll('[data-task-temporal-divider-id]')).find(
    (element) => element.dataset.taskTemporalDividerId === somedayLane?.dataset.collectionLaneId,
  )
  if (!anytimeLane || !somedayLane || !boundary) return null

  const groupRect = group.getBoundingClientRect()
  if (pointer.x < groupRect.left || pointer.x > groupRect.right) return null

  const draggedRect = draggedCardRectAtPointer(pointer, session)
  if (!draggedRect) return null
  const boundaryRect = boundary.getBoundingClientRect()
  const boundaryY = boundaryRect.top + boundaryRect.height / 2
  const crossesBoundary = draggedRect.top <= boundaryY && draggedRect.bottom >= boundaryY
  if (!crossesBoundary) {
    session.taskTemporalBoundary = null
    return null
  }

  const anytimeLaneId = anytimeLane.dataset.collectionLaneId
  const somedayLaneId = somedayLane.dataset.collectionLaneId
  const boundaryKey = `${anytimeLaneId}|${somedayLaneId}`
  if (session.taskTemporalBoundary?.key !== boundaryKey) {
    session.taskTemporalBoundary = {
      key: boundaryKey,
      originLaneId: currentLaneId,
    }
  }

  const overlapAboveBoundary = Math.max(0, Math.min(1, (boundaryY - draggedRect.top) / draggedRect.height))
  const overlapBelowBoundary = Math.max(0, Math.min(1, (draggedRect.bottom - boundaryY) / draggedRect.height))
  const startedInAnytime = session.taskTemporalBoundary.originLaneId === anytimeLaneId
  const targetLane = startedInAnytime
    ? overlapBelowBoundary >= CARD_CROSSING_THRESHOLD_RATIO
      ? somedayLane
      : anytimeLane
    : overlapAboveBoundary >= CARD_CROSSING_THRESHOLD_RATIO
      ? anytimeLane
      : somedayLane

  const target = collectionTargetFromLane(targetLane, pointer)
  return target ? { target, fromBoundaryThreshold: true } : null
}

export const verticalCollectionTargetAtThreshold = (pointer, sourceData, session) => {
  if (
    typeof document === 'undefined' ||
    !pointer ||
    sourceData?.kind !== 'collection-item' ||
    sourceData.backlogTask ||
    !session?.sourceRect ||
    !session.grabOffset ||
    !session?.verticalDirection
  )
    return null

  const currentLaneId = session.projectedCollectionLaneId || sourceData.sourceLaneId
  const lane = Array.from(document.querySelectorAll('[data-collection-drop-zone="true"]')).find(
    (element) =>
      element.dataset.collectionId === sourceData.collectionId &&
      element.dataset.collectionSurfaceId === sourceData.surfaceId &&
      element.dataset.collectionLaneId === currentLaneId,
  )
  if (!lane) return null

  const laneRect = lane.getBoundingClientRect()
  if (pointer.x < laneRect.left || pointer.x > laneRect.right) return null

  const items = Array.from(lane.querySelectorAll('[data-collection-item-id]')).filter(
    (element) => element.closest('[data-collection-drop-zone="true"]') === lane,
  )
  const sourcePosition = items.findIndex((element) => element.dataset.collectionItemId === sourceData.itemId)
  if (sourcePosition === -1) return null

  const targetElement = items[sourcePosition + session.verticalDirection]
  if (!targetElement) return { blocked: true }
  const targetRect = targetElement.getBoundingClientRect()
  if (!crossedCardReorderThreshold(pointer, session, targetRect, session.verticalDirection)) {
    return { blocked: true }
  }

  const target = collectionTargetFromItemElement(targetElement)
  return target ? { target, fromCardReorderThreshold: true } : { blocked: true }
}

export const collectionDragTarget = (operation, pointer, sourceData, session) => {
  const overlapTarget = overlapCollectionTarget(operation, pointer, session)
  if (overlapTarget) return { targetOverride: overlapTarget }

  const boundaryTarget =
    rightPanelObjectiveTargetAtThreshold(pointer, sourceData, session) ||
    rightPanelTaskTemporalTargetAtThreshold(pointer, sourceData, session)
  const boundaryChangesLane = Boolean(
    boundaryTarget && boundaryTarget.target.data.laneId !== session.projectedCollectionLaneId,
  )
  if (boundaryChangesLane) return { targetOverride: boundaryTarget }

  const edgeTarget = navigationAreaEdgeTargetAtPointer(pointer, sourceData)
  if (edgeTarget) return { targetOverride: edgeTarget }

  const reorderTarget = verticalCollectionTargetAtThreshold(pointer, sourceData, session)
  if (reorderTarget?.blocked) return { blocked: true }
  if (reorderTarget?.target) return { targetOverride: reorderTarget }

  const directTarget = boundaryTarget?.target || collectionTargetAtPointer(pointer, sourceData)
  return {
    targetOverride: directTarget ? { target: directTarget } : null,
  }
}

export const isPointerOverCollection = (pointer, collectionId, surfaceId) => {
  if (typeof document === 'undefined' || !pointer) return false
  let element = document.elementFromPoint(pointer.x, pointer.y)
  while (element) {
    if (
      (element.dataset?.collectionDropZone === 'true' || element.dataset?.collectionDropProxy === 'true') &&
      element.dataset.collectionId === collectionId &&
      element.dataset.collectionSurfaceId === surfaceId
    )
      return true
    element = element.parentElement
  }
  return false
}

export const isPointerOverRightPanelBacklogGroup = (pointer, laneId) => {
  if (typeof document === 'undefined' || !pointer || !laneId) return false
  const lane = Array.from(document.querySelectorAll('[data-collection-drop-zone="true"]')).find(
    (element) =>
      element.dataset.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID &&
      element.dataset.collectionLaneId === laneId &&
      element.dataset.collectionSurfaceId === 'right-panel-backlog',
  )
  const groupRect = lane?.closest?.('.right-panel-backlog-group')?.getBoundingClientRect()
  return Boolean(
    groupRect &&
      pointer.x >= groupRect.left &&
      pointer.x <= groupRect.right &&
      pointer.y >= groupRect.top &&
      pointer.y <= groupRect.bottom,
  )
}

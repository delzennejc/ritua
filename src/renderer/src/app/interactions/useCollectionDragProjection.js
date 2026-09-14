export function useCollectionDragProjection({ dragSessionRef, lastBoardProjectionRef }) {
  const restoreCollectionSnapshot = () => {
    const dragSession = dragSessionRef.current
    const sourceData = dragSession?.sourceData
    if (!sourceData?.onRestore || dragSession.collectionSnapshot === undefined) return
    sourceData.onRestore(dragSession.collectionSnapshot)
  }

  const projectCollectionItem = (operation, pointerOverride, targetOverride) => {
    const dragSession = dragSessionRef.current
    const sourceData = dragSession?.sourceData || operation.source?.data
    const target = targetOverride?.target || operation.target
    const targetData = target?.data

    if (
      sourceData?.kind !== 'collection-item' ||
      (targetData?.kind !== 'collection-item' && targetData?.kind !== 'collection-lane') ||
      targetData.collectionId !== sourceData.collectionId ||
      targetData.surfaceId !== sourceData.surfaceId
    ) {
      return false
    }

    if (targetData.kind === 'collection-item' && targetData.itemId === sourceData.itemId) {
      return true
    }

    const pointer = pointerOverride || dragSession?.pointer || operation.position.current
    const sourceLaneId = dragSession.projectedCollectionLaneId || sourceData.sourceLaneId
    const sourceIndex = Number.isInteger(dragSession.projectedCollectionIndex)
      ? dragSession.projectedCollectionIndex
      : sourceData.sourceIndex
    const targetRect = target.element?.getBoundingClientRect()
    if (
      !targetRect ||
      (!targetOverride?.fromItemOverlap &&
        !targetOverride?.fromBoundaryThreshold &&
        !targetOverride?.fromCardReorderThreshold &&
        !targetOverride?.fromCollectionEdgeIntent &&
        (pointer.x < targetRect.left ||
          pointer.x > targetRect.right ||
          pointer.y < targetRect.top ||
          pointer.y > targetRect.bottom))
    ) {
      return false
    }

    const targetLaneId = targetData.laneId
    let targetIndex
    let projectionPosition = 'end'

    if (targetData.kind === 'collection-item') {
      const pointerInsideTarget = pointer.y >= targetRect.top && pointer.y <= targetRect.bottom
      const thresholdDirection = targetOverride?.fromCardReorderThreshold
        ? Math.sign(targetData.index - sourceIndex)
        : 0
      const verticalDirection =
        thresholdDirection || (pointerInsideTarget ? dragSession.verticalDirection || 0 : 0)
      const insertAfterTarget =
        verticalDirection === 0 ? pointer.y > targetRect.top + targetRect.height / 2 : verticalDirection > 0
      projectionPosition = insertAfterTarget ? 'after' : 'before'
      targetIndex = targetData.index + (insertAfterTarget ? 1 : 0)
      if (sourceLaneId === targetLaneId && sourceIndex < targetIndex) {
        targetIndex -= 1
      }
    } else {
      targetIndex = targetData.insertionIndex
    }

    const projectionKey = [
      'collection',
      sourceData.collectionId,
      target.id,
      targetLaneId,
      projectionPosition,
      targetIndex,
    ].join(':')
    if (lastBoardProjectionRef.current === projectionKey) return true
    lastBoardProjectionRef.current = projectionKey

    sourceData.onMove?.({
      itemId: sourceData.itemId,
      sourceLaneId,
      targetLaneId,
      targetIndex,
      targetData,
    })
    dragSession.projectedCollectionLaneId = targetLaneId
    dragSession.projectedCollectionIndex = targetIndex
    return true
  }
  return { restoreCollectionSnapshot, projectCollectionItem }
}

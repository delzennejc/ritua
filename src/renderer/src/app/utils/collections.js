const clampIndex = (index, length) => Math.max(0, Math.min(length, Number.isFinite(index) ? index : length))

export const RIGHT_PANEL_BACKLOG_COLLECTION_ID = 'right-panel-backlog-tasks'

export function moveItemBetweenLanes({
  lanes,
  itemId,
  sourceLaneId,
  targetLaneId,
  targetIndex,
  getItemId = (item) => item.id,
}) {
  const sourceItems = lanes[sourceLaneId] || []
  const sourceIndex = sourceItems.findIndex((item) => getItemId(item) === itemId)
  if (sourceIndex === -1 || !targetLaneId) return lanes

  const movedItem = sourceItems[sourceIndex]
  const remainingSourceItems = sourceItems.filter((_, index) => index !== sourceIndex)

  if (sourceLaneId === targetLaneId) {
    const insertionIndex = clampIndex(targetIndex, remainingSourceItems.length)
    if (sourceIndex === insertionIndex) return lanes

    return {
      ...lanes,
      [sourceLaneId]: [
        ...remainingSourceItems.slice(0, insertionIndex),
        movedItem,
        ...remainingSourceItems.slice(insertionIndex),
      ],
    }
  }

  const targetItems = (lanes[targetLaneId] || []).filter((item) => getItemId(item) !== itemId)
  const insertionIndex = clampIndex(targetIndex, targetItems.length)

  return {
    ...lanes,
    [sourceLaneId]: remainingSourceItems,
    [targetLaneId]: [
      ...targetItems.slice(0, insertionIndex),
      movedItem,
      ...targetItems.slice(insertionIndex),
    ],
  }
}

export function moveObjective(items, move) {
  return moveItemBetweenLanes({
    lanes: { objectives: items },
    ...move,
  }).objectives
}

export function moveBacklogItem(groups, move) {
  const lanes = Object.fromEntries(groups.map((group) => [group.label, group.items]))
  const movedLanes = moveItemBetweenLanes({ lanes, ...move })

  return groups.map((group) => ({
    ...group,
    items: movedLanes[group.label] || [],
  }))
}

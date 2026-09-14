import { DEFAULT_AREA_LOOKUP, DEFAULT_AREAS } from '../../../../domain/workspace-defaults'

const itemAreaId = (item, areas) =>
  areas.find((area) => area.label === item.channel)?.id || DEFAULT_AREA_LOOKUP[item.channel]?.id

export const itemMatchesAreaFilter = (item, selectedAreaIds = [], areas = DEFAULT_AREAS) =>
  selectedAreaIds.length === 0 || selectedAreaIds.includes(itemAreaId(item, areas))

export const filterItemsByArea = (items, selectedAreaIds = [], areas = DEFAULT_AREAS) =>
  selectedAreaIds.length === 0
    ? items
    : items.filter((item) => itemMatchesAreaFilter(item, selectedAreaIds, areas))

export const mergeVisibleItemOrder = (
  allItems,
  orderedVisibleItems,
  selectedAreaIds = [],
  areas = DEFAULT_AREAS,
) => {
  if (selectedAreaIds.length === 0) return orderedVisibleItems
  let visibleIndex = 0
  return allItems.map((item) =>
    itemMatchesAreaFilter(item, selectedAreaIds, areas) ? orderedVisibleItems[visibleIndex++] || item : item,
  )
}

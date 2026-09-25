import { CALENDAR_HOUR_HEIGHT } from './calendar'
import { sessionDragTaskId } from './session-drag'

// The right gutter belongs to the calendar too: the edge-add control extends
// into it, and a pointer can cross into it while hovering or releasing a drag.
export function calendarTimelineAtPointer(pointer) {
  if (!pointer) return null
  const viewport = document.elementFromPoint(pointer.x, pointer.y)?.closest('.calendar-timeline-scroll')
  const timeline = viewport?.querySelector('[data-calendar-drop-zone="true"]')
  if (!timeline || !viewport) return null
  const rect = timeline.getBoundingClientRect()
  const bounds = viewport.getBoundingClientRect()
  if (
    pointer.x < Math.max(rect.left, bounds.left) ||
    pointer.x > bounds.right ||
    pointer.y < Math.max(rect.top, bounds.top) ||
    pointer.y >= Math.min(rect.bottom, bounds.bottom)
  )
    return null
  return timeline
}

// Match the right-edge area used by the calendar's overlapping-item add button.
export function calendarOverlapAtPointer(pointer, excludedEventId) {
  const timeline = calendarTimelineAtPointer(pointer)
  if (!timeline) return null
  const rect = timeline.getBoundingClientRect()
  if (pointer.x < rect.right - 40) return null
  const minute = ((pointer.y - rect.top) / CALENDAR_HOUR_HEIGHT) * 60
  const occupied = Array.from(timeline.querySelectorAll('[data-calendar-event-id]'))
    .filter(
      (element) =>
        element.dataset.calendarEventId !== excludedEventId &&
        Number(element.dataset.calendarStart) <= minute &&
        minute < Number(element.dataset.calendarEnd),
    )
    .sort((a, b) => Number(b.dataset.calendarColumn) - Number(a.dataset.calendarColumn))[0]
  if (!occupied) return null
  return {
    timeline,
    eventId: occupied.dataset.calendarEventId,
    dateKey: timeline.dataset.dateKey,
    start: Number(occupied.dataset.calendarStart),
    end: Number(occupied.dataset.calendarEnd),
  }
}

// Drag-move events precede the library's position update. Translate its current
// collision rectangle to this event's position, preserving the grab offset.
export function calendarDraggedCardRect(operation, pointer) {
  const rect = operation.shape?.current?.boundingRectangle
  if (!rect) return null
  const dx = pointer ? pointer.x - operation.position.current.x : 0
  const dy = pointer ? pointer.y - operation.position.current.y : 0
  return {
    left: rect.left + dx,
    right: rect.right + dx,
    top: rect.top + dy,
    bottom: rect.bottom + dy,
  }
}

export function calendarOverlapForDraggedCard(card, excludedEventId) {
  if (!card) return null
  let best = null
  let bestOverlap = 0
  let bestColumn = -1
  for (const timeline of document.querySelectorAll('[data-calendar-drop-zone="true"]')) {
    const viewport = timeline.closest('.calendar-timeline-scroll')
    if (!viewport) continue
    const rect = timeline.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    if (rect.width <= 0 || bounds.height <= 0) continue
    // Keep the edge fixed while existing blocks animate to make space.
    const overlapX = Math.min(card.right, bounds.right) - Math.max(card.left, rect.right - 40, bounds.left)
    if (overlapX <= 0) continue
    for (const block of timeline.querySelectorAll('[data-calendar-event-id]')) {
      if (block.dataset.calendarEventId === excludedEventId) continue
      const start = Number(block.dataset.calendarStart)
      const end = Number(block.dataset.calendarEnd)
      const top = Math.max(bounds.top, rect.top + (start * CALENDAR_HOUR_HEIGHT) / 60)
      const bottom = Math.min(bounds.bottom, rect.top + (end * CALENDAR_HOUR_HEIGHT) / 60)
      const overlapY = Math.min(card.bottom, bottom) - Math.max(card.top, top)
      const overlap = overlapX * Math.max(0, overlapY)
      const column = Number(block.dataset.calendarColumn)
      if (overlap <= 0 || overlap < bestOverlap || (overlap === bestOverlap && column <= bestColumn)) continue
      bestOverlap = overlap
      bestColumn = column
      best = {
        timeline,
        eventId: block.dataset.calendarEventId,
        dateKey: timeline.dataset.dateKey,
        start,
        end,
      }
    }
  }
  return best
}

const sameSlot = (a, b) =>
  a?.timeline === b?.timeline &&
  a?.eventId === b?.eventId &&
  a?.dateKey === b?.dateKey &&
  a?.start === b?.start &&
  a?.end === b?.end

export function createCalendarEdgeDwell(resolveTarget = calendarOverlapForDraggedCard) {
  let sample = null
  let candidate = null
  let ready = null
  let timer = null
  const listeners = new Set()
  const publish = (value) => {
    if (sameSlot(ready, value)) return
    ready = value
    listeners.forEach((listener) => listener())
  }
  const refresh = () => {
    const next =
      sample && sessionDragTaskId(sample.source)
        ? resolveTarget(
            sample.cardRect,
            sample.source.kind === 'calendar-event' ? sample.source.eventId : null,
          )
        : null
    if (sameSlot(candidate, next)) return ready
    clearTimeout(timer)
    timer = null
    candidate = next
    publish(null)
    if (next) {
      timer = setTimeout(() => {
        timer = null
        // Recheck geometry even when the pointer hasn't moved (e.g. after scrolling).
        refresh()
        if (candidate === next) publish(next)
      }, 1200)
    }
    return ready
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => ready,
    update(source, cardRect) {
      sample = { source, cardRect }
      return refresh()
    },
    refresh,
    clear() {
      sample = null
      candidate = null
      clearTimeout(timer)
      timer = null
      publish(null)
    },
  }
}

// One active workspace gesture; previews and the drop handler share its decision.
export const calendarEdgeDwell = createCalendarEdgeDwell()

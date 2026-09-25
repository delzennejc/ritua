import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarDraggedCardRect,
  calendarOverlapForDraggedCard,
  calendarOverlapAtPointer,
  calendarTimelineAtPointer,
  createCalendarEdgeDwell,
} from '../renderer/src/app/utils/calendar-edge-dwell'

const task = { kind: 'board-task', taskId: 'dragged' }
const first = { eventId: 'first', dateKey: '2026-09-25', start: 600, end: 645 }
const second = { eventId: 'second', dateKey: '2026-09-25', start: 660, end: 720 }

test('sharing arms after 1.2 seconds of hovering and never saves during hover', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const dwell = createCalendarEdgeDwell(() => ({ ...first }))
  let notifications = 0
  const unsubscribe = dwell.subscribe(() => notifications++)
  dwell.update(task, { x: 1, y: 1 })
  t.mock.timers.tick(1199)
  assert.equal(dwell.getSnapshot(), null)
  dwell.update(task, { x: 2, y: 2 }) // Small movements inside the same edge don't restart the wait.
  t.mock.timers.tick(1)
  assert.deepEqual(dwell.getSnapshot(), first)
  assert.equal(notifications, 1)
  dwell.clear()
  assert.equal(dwell.getSnapshot(), null)
  unsubscribe()
})

test('leaving, switching slots, scrolling away and cancellation reset the dwell', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let target = first
  const dwell = createCalendarEdgeDwell(() => target)
  dwell.update(task, {})
  t.mock.timers.tick(800)
  target = second
  dwell.refresh()
  t.mock.timers.tick(400)
  assert.equal(dwell.getSnapshot(), null)
  t.mock.timers.tick(800)
  assert.deepEqual(dwell.getSnapshot(), second)
  target = null
  dwell.refresh()
  assert.equal(dwell.getSnapshot(), null)
  target = first
  dwell.update(task, {})
  t.mock.timers.tick(800)
  target = null // Geometry changed before the timer fires, without another drag move.
  t.mock.timers.tick(400)
  assert.equal(dwell.getSnapshot(), null)
  target = first
  dwell.update(task, {})
  dwell.clear()
  t.mock.timers.tick(1200)
  assert.equal(dwell.getSnapshot(), null)
})

test('only task sources can share; calendar moves exclude their own block', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const exclusions = []
  const dwell = createCalendarEdgeDwell((_, excluded) => {
    exclusions.push(excluded)
    return first
  })
  for (const source of [
    { kind: 'calendar-resize' },
    { kind: 'calendar-event', session: true },
    { kind: 'collection-item' },
  ]) {
    dwell.update(source, {})
    t.mock.timers.tick(1200)
    assert.equal(dwell.getSnapshot(), null)
  }
  assert.deepEqual(exclusions, [])
  dwell.update({ kind: 'calendar-event', eventId: 'own', taskId: 'task' }, {})
  t.mock.timers.tick(1200)
  assert.ok(exclusions.every((id) => id === 'own'))
  assert.deepEqual(dwell.getSnapshot(), first)
  dwell.clear()
})

test('the visible right gutter participates in edge hover and calendar drops', (t) => {
  const oldDocument = globalThis.document
  const block = {
    dataset: { calendarEventId: 'occupied', calendarStart: '600', calendarEnd: '645', calendarColumn: '0' },
  }
  const timeline = {
    dataset: { dateKey: '2026-09-25' },
    getBoundingClientRect: () => ({ left: 142, right: 400, top: -500, bottom: 940, width: 258 }),
    querySelectorAll: () => [block],
  }
  const viewport = {
    getBoundingClientRect: () => ({ left: 100, right: 416, top: 100, bottom: 500, height: 400 }),
    querySelector: () => timeline,
  }
  timeline.closest = () => viewport
  globalThis.document = {
    querySelectorAll: () => [timeline],
    elementFromPoint: (x, y) =>
      x >= 100 && x < 416 && y >= 100 && y < 500 ? { closest: () => viewport } : null,
  }
  t.after(() => {
    globalThis.document = oldDocument
  })
  for (const x of [394, 400, 406, 415]) {
    assert.equal(calendarTimelineAtPointer({ x, y: 125 }), timeline)
    assert.equal(calendarOverlapAtPointer({ x, y: 125 })?.eventId, 'occupied')
  }
  assert.equal(calendarOverlapAtPointer({ x: 406, y: 125 }, 'occupied'), null)
  assert.equal(calendarOverlapAtPointer({ x: 250, y: 125 }), null)
  assert.equal(calendarOverlapAtPointer({ x: 406, y: 90 }), null)
  assert.equal(calendarOverlapAtPointer({ x: 406, y: 160 }), null)
  assert.equal(calendarTimelineAtPointer({ x: 420, y: 125 }), null)
  assert.equal(calendarTimelineAtPointer({ x: 120, y: 125 }), null)

  // The cursor can be above and outside while the card still overlaps the edge.
  const card = { left: 350, right: 430, top: 80, bottom: 115 }
  assert.equal(calendarOverlapForDraggedCard(card)?.eventId, 'occupied')
  assert.equal(calendarOverlapForDraggedCard(card, 'occupied'), null)
  assert.equal(calendarOverlapForDraggedCard({ ...card, left: 420, right: 500 }), null)
  assert.equal(calendarOverlapForDraggedCard({ ...card, top: 40, bottom: 90 }), null)
  const following = {
    dataset: { calendarEventId: 'following', calendarStart: '645', calendarEnd: '690', calendarColumn: '0' },
  }
  timeline.querySelectorAll = () => [block, following]
  assert.equal(calendarOverlapForDraggedCard({ ...card, top: 135, bottom: 180 })?.eventId, 'following')
})

test('hover and release use the same card rectangle while preserving the grab offset', () => {
  const rect = { left: 300, right: 400, top: 100, bottom: 160 }
  const move = { shape: { current: { boundingRectangle: rect } }, position: { current: { x: 390, y: 115 } } }
  const pointer = { x: 440, y: 90 }
  const hovered = calendarDraggedCardRect(move, pointer)
  assert.deepEqual(hovered, { left: 350, right: 450, top: 75, bottom: 135 })
  const release = { shape: { current: { boundingRectangle: hovered } }, position: { current: pointer } }
  assert.deepEqual(calendarDraggedCardRect(release, pointer), hovered)
  assert.equal(calendarDraggedCardRect({ position: move.position }, pointer), null)
})

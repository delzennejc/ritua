import assert from 'node:assert/strict'
import test from 'node:test'
import { nextAvailableCalendarStart, ongoingCalendarSession } from '../renderer/src/app/utils/calendar.js'
import { CURRENT_DATE_KEY } from '../renderer/src/app/utils/dates.js'
import { addDays } from '../domain/calendar-dates'
import { calendarStartAfterMove, calendarEndAfterResize } from '../renderer/src/app/utils/calendar.js'
import { scheduleDraftFrom } from '../renderer/src/app/components/task-details/editor-values.js'

test('overnight editor, movement, resizing and next-day availability preserve the full block', () => {
  const event = { id: 'night', start: 1425, end: 1560, dateKey: addDays(CURRENT_DATE_KEY, -1) }
  assert.equal(scheduleDraftFrom({ minutes: 135 }, event, event.dateKey, [event]).end, '02:00')
  assert.equal(calendarStartAfterMove({ start: 1425, duration: 135, deltaY: 0, allowOvernight: true }), 1425)
  assert.equal(calendarEndAfterResize({ start: 1425, end: 1560, deltaY: 30, maxEnd: 2865 }), 1590)
  assert.equal(nextAvailableCalendarStart([event], 30, CURRENT_DATE_KEY, { now: at(0, 30) }), 120)
})

const at = (hours, minutes, seconds = 0) => new Date(2026, 8, 3, hours, minutes, seconds)

test('auto schedule can join a session only while it is underway on Today', () => {
  const session = { id: 'session', kind: 'session', dateKey: CURRENT_DATE_KEY, start: 600, end: 660 }
  assert.equal(ongoingCalendarSession([session], CURRENT_DATE_KEY, at(10, 0)), session)
  assert.equal(ongoingCalendarSession([session], CURRENT_DATE_KEY, at(10, 59, 59)), session)
  assert.equal(ongoingCalendarSession([session], CURRENT_DATE_KEY, at(9, 59, 59)), undefined)
  assert.equal(ongoingCalendarSession([session], CURRENT_DATE_KEY, at(11, 0)), undefined)
  assert.equal(ongoingCalendarSession([], CURRENT_DATE_KEY, at(10, 15)), undefined)
  const anotherDate = CURRENT_DATE_KEY === '2026-09-15' ? '2026-09-16' : '2026-09-15'
  const otherDaySession = { ...session, dateKey: anotherDate }
  assert.equal(ongoingCalendarSession([otherDaySession], CURRENT_DATE_KEY, at(10, 15)), undefined)
  assert.equal(ongoingCalendarSession([otherDaySession], anotherDate, at(10, 15)), undefined)
  assert.equal(
    ongoingCalendarSession([{ ...session, kind: 'task' }, session], CURRENT_DATE_KEY, at(10, 15)),
    session,
  )
})

test('Today skips elapsed time and gaps too short for the task', () => {
  const events = [
    { start: 10 * 60, end: 10 * 60 + 40 },
    { start: 11 * 60, end: 11 * 60 + 45 },
  ]
  assert.equal(
    nextAvailableCalendarStart(events, 30, CURRENT_DATE_KEY, {
      now: at(10, 7),
    }),
    11 * 60 + 45,
  )
})

test('a five-minute boundary is available only if it has not passed', () => {
  assert.equal(
    nextAvailableCalendarStart([], 15, CURRENT_DATE_KEY, {
      now: at(10, 15),
    }),
    10 * 60 + 15,
  )
  assert.equal(
    nextAvailableCalendarStart([], 15, CURRENT_DATE_KEY, {
      now: at(10, 15, 1),
    }),
    10 * 60 + 20,
  )
})

test('future dates use their own calendar from 08:00', () => {
  const futureDate = '2026-07-15'
  const events = [
    { dateKey: CURRENT_DATE_KEY, start: 0, end: 1440 },
    { dateKey: futureDate, start: 480, end: 550 },
  ]
  assert.equal(
    nextAvailableCalendarStart(events, 45, futureDate, {
      now: at(18, 30),
    }),
    550,
  )
})

test('no remaining room never falls back to an earlier slot or another day', () => {
  assert.equal(
    nextAvailableCalendarStart([], 30, CURRENT_DATE_KEY, {
      now: at(23, 50),
    }),
    null,
  )
  assert.equal(
    nextAvailableCalendarStart([{ start: 900, end: 1440 }], 45, CURRENT_DATE_KEY, {
      now: at(15, 18),
    }),
    null,
  )
})

test("the task's own event does not block its availability search", () => {
  assert.equal(
    nextAvailableCalendarStart([{ id: 'task', start: 600, end: 720 }], 30, CURRENT_DATE_KEY, {
      taskId: 'task',
      now: at(10, 0),
    }),
    600,
  )
})

test('calendar resize preserves the five-minute grid minimum, including the final slot', () => {
  assert.equal(calendarEndAfterResize({ start: 600, end: 605, deltaY: 0 }), 605)
  assert.equal(calendarEndAfterResize({ start: 600, end: 630, deltaY: -60 }), 605)
  assert.equal(calendarEndAfterResize({ start: 1435, end: 1440, deltaY: 0 }), 1440)
})

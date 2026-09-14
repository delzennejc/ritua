import assert from 'node:assert/strict'
import test from 'node:test'
import { nextAvailableCalendarStart, ongoingCalendarSession } from '../renderer/src/app/utils/calendar.js'
import { CURRENT_DATE_KEY } from '../renderer/src/app/utils/dates.js'

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

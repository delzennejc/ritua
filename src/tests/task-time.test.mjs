import assert from 'node:assert/strict'
import test from 'node:test'
import { taskTimeTotals, taskWorkedMinutes } from '../domain/task-time.ts'

const session = (extra = {}) => ({
  id: 'session',
  kind: 'session',
  title: 'Focus',
  dateKey: '2026-09-24',
  start: 600,
  end: 661,
  taskIds: ['a', 'b'],
  ...extra,
})

test('only explicitly recorded task time counts, never former planned durations', () => {
  const tasks = [
    { complete: true, minutes: 75 },
    { complete: true, minutes: 45, actualMinutes: null },
    { complete: false, minutes: 210, actualMinutes: 20 },
  ]
  const before = structuredClone(tasks)
  assert.deepEqual(taskTimeTotals(tasks), { actual: 20 })
  assert.deepEqual(tasks, before)
  assert.equal(taskWorkedMinutes({ complete: true, minutes: 75, actualMinutes: 0 }), 0)
  assert.deepEqual(taskTimeTotals([]), { actual: 0 })
})

test('a Session contributes its duration once, excluding all member actual time', () => {
  const tasks = [
    { id: 'a', complete: true, actualMinutes: 100 },
    { id: 'b', complete: false, actualMinutes: 200 },
    { id: 'outside', actualMinutes: 15 },
  ]
  const events = [session()]
  const before = structuredClone({ tasks, events })
  assert.equal(taskWorkedMinutes(tasks[0], events), 0)
  assert.deepEqual(taskTimeTotals([...tasks, tasks[0]], [...events, events[0]]), { actual: 76 })
  assert.deepEqual({ tasks, events }, before, 'Reporting preserves canonical actual time')
  assert.deepEqual(
    taskTimeTotals(tasks, [session({ taskIds: ['b'] })]),
    { actual: 176 },
    'Unlinking restores the former member’s actual time',
  )
})

test('Area and Project shares add to one Session duration and survive member reorder', () => {
  const tasks = [
    { id: 'a', actualMinutes: 100 },
    { id: 'b', actualMinutes: 200 },
  ]
  const events = [session()]
  assert.equal(taskTimeTotals([tasks[0]], events).actual, 31)
  assert.equal(taskTimeTotals([tasks[1]], events).actual, 30)
  assert.equal(taskTimeTotals([tasks[0]], [session({ taskIds: ['b', 'a'] })]).actual, 31)
})

test('reviews count Sessions on their date, including empty Sessions only in unfiltered totals', () => {
  const events = [
    session(),
    session({ id: 'empty', taskIds: [], start: 720, end: 750 }),
    session({ id: 'future', dateKey: '2026-09-25', taskIds: [], start: 720, end: 840 }),
  ]
  const tasks = [
    { id: 'a', actualMinutes: 100 },
    { id: 'b', actualMinutes: 200 },
  ]
  const scope = { dateKeys: ['2026-09-24'] }
  assert.equal(taskTimeTotals(tasks, events, scope).actual, 91)
  assert.equal(taskTimeTotals(tasks, events, { ...scope, includeEmptySessions: false }).actual, 61)
  assert.equal(taskTimeTotals(tasks, events, { dateKeys: [] }).actual, 0)
})

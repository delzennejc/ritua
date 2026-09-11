import assert from 'node:assert/strict'
import test from 'node:test'
import { taskTimeTotals, taskWorkedMinutes } from '../domain/task-time.ts'

test('completed tasks without logged time contribute their duration to review totals', () => {
  const tasks = [
    { complete: true, minutes: 75 },
    { complete: true, minutes: 45, actualMinutes: null },
    { complete: true, minutes: 210 },
  ]
  const before = structuredClone(tasks)
  assert.deepEqual(taskTimeTotals(tasks), { actual: 330, planned: 330 })
  assert.deepEqual(tasks, before, 'Reviewing must not write inferred time into task data')
})

test('explicit actual time wins over a completed task duration, including zero', () => {
  assert.equal(taskWorkedMinutes({ complete: true, minutes: 75, actualMinutes: 50 }), 50)
  assert.equal(taskWorkedMinutes({ complete: true, minutes: 75, actualMinutes: 100 }), 100)
  assert.equal(taskWorkedMinutes({ complete: true, minutes: 75, actualMinutes: 0 }), 0)
})

test('unfinished tasks count only logged work and reopening removes inferred time', () => {
  const task = { complete: true, minutes: 75, actualMinutes: null }
  assert.equal(taskWorkedMinutes(task), 75)
  assert.equal(taskWorkedMinutes({ ...task, complete: false }), 0)
  assert.equal(taskWorkedMinutes({ ...task, complete: false, actualMinutes: 20 }), 20)
})

test('empty reviews and completed tasks without a duration remain zero', () => {
  assert.deepEqual(taskTimeTotals([]), { actual: 0, planned: 0 })
  assert.equal(taskWorkedMinutes({ complete: true }), 0)
})

test('mixed and filtered review totals use the same per-task time as task rows', () => {
  const tasks = [
    { channel: 'Work', complete: true, minutes: 75 },
    { channel: 'Work', complete: false, minutes: 30, actualMinutes: 10 },
    { channel: 'Personal', complete: false, minutes: 60 },
    { channel: 'Personal', complete: true, minutes: 45, actualMinutes: 20 },
  ]
  assert.deepEqual(taskTimeTotals(tasks), { actual: 105, planned: 210 })
  assert.deepEqual(taskTimeTotals(tasks.filter(task => task.channel === 'Work')), { actual: 85, planned: 105 })
  assert.equal(taskTimeTotals(tasks).actual, tasks.reduce((total, task) => total + taskWorkedMinutes(task), 0))
})

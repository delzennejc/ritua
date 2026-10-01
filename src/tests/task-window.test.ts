import test from 'node:test'
import assert from 'node:assert/strict'
import { taskWindow } from '../renderer/src/app/utils/task-window'

test('task windows find wrapping rows and clamp viewports outside the list', () => {
  const offsets = [0, 45, 130, 175, 300]
  assert.deepEqual(taskWindow(offsets, 80, 160), { start: 1, end: 3 })
  assert.deepEqual(taskWindow(offsets, -500, -100), { start: 0, end: 0 })
  assert.deepEqual(taskWindow(offsets, 400, 900), { start: 4, end: 4 })
  assert.deepEqual(taskWindow(offsets, -100, 900), { start: 0, end: 4 })
  assert.deepEqual(taskWindow([0], 0, 900), { start: 0, end: 0 })
})

test('large task windows retain absolute indices at the end of the list', () => {
  const offsets = Array.from({ length: 10001 }, (_, index) => index * 45)
  assert.deepEqual(taskWindow(offsets, 449550, 450200), { start: 9990, end: 10000 })
})

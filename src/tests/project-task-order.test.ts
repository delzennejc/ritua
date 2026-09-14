import test from 'node:test'
import assert from 'node:assert/strict'
import {
  orderedProjectTasks,
  reorderProjectTaskOrder,
  isPreviousWeekCompletedTask,
} from '../domain/project-task-order'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, validateDocument } from '../domain/workspace'
import { editWorkspaceProject } from '../domain/project-commands'

test('project ordering preserves hidden history and incorporates newly linked tasks', () => {
  const rows = ['a', 'old', 'b', 'c'].map((id) => ({ id }))
  const order = reorderProjectTaskOrder(rows, ['a', 'b', 'c'], { itemId: 'c', targetIndex: 0 })
  assert.deepEqual(order, ['c', 'old', 'a', 'b'])
  assert.deepEqual(
    orderedProjectTasks([...rows, { id: 'new' }], order).map((task) => task.id),
    [...order, 'new'],
  )
  assert.deepEqual(
    rows.map((task) => task.id),
    ['a', 'old', 'b', 'c'],
  )
  assert.deepEqual(
    orderedProjectTasks(rows, ['deleted', 'b']).map((task) => task.id),
    ['b', 'a', 'old', 'c'],
  )
})

test('previous weeks uses the assigned date first and keeps unfinished work visible', () => {
  const week = '2026-09-14'
  assert.equal(isPreviousWeekCompletedTask({ complete: true, dateKey: '2026-09-13' }, week), true)
  assert.equal(isPreviousWeekCompletedTask({ complete: true, dateKey: week }, week), false)
  assert.equal(isPreviousWeekCompletedTask({ complete: false, dateKey: '2026-09-01' }, week), false)
  assert.equal(isPreviousWeekCompletedTask({ complete: true }, week), false)
  assert.equal(
    isPreviousWeekCompletedTask({ complete: true, dateKey: '2026-09-01', completedDateKey: week }, week),
    true,
  )
  assert.equal(
    isPreviousWeekCompletedTask({ complete: true, dateKey: week, completedDateKey: '2026-09-01' }, week),
    false,
  )
  assert.equal(
    isPreviousWeekCompletedTask({ complete: true, completedDateKey: '2025-12-31' }, '2026-01-05'),
    true,
  )
})

test('project order roundtrips without changing canonical task data or locations and can be restored', () => {
  const fields = project(emptyWorkspace('2026-09-14'))
  fields.tasks = [{ id: 'today', title: 'Today', objectiveId: 'p' }]
  fields.datedTasksByDate = { '2026-09-13': [{ id: 'old', title: 'Old', complete: true, objectiveId: 'p' }] }
  fields.weeklyObjectives = [{ id: 'p', title: 'Project' }]
  const before = normalize(fields)
  const next = editWorkspaceProject(before, 'p', { taskOrder: ['old', 'today'] })
  validateDocument(next)
  const restored = normalize(project(next))
  assert.deepEqual(
    restored.entities.filter((entity) => entity.kind === 'task'),
    before.entities.filter((entity) => entity.kind === 'task'),
  )
  assert.deepEqual(restored.entities.find((entity) => entity.kind === 'project')?.data.content, {
    id: 'p',
    title: 'Project',
    taskOrder: ['old', 'today'],
  })
  assert.deepEqual(
    editWorkspaceProject(next, 'p', { taskOrder: [] }).entities.find((entity) => entity.kind === 'project')
      ?.data.content,
    { id: 'p', title: 'Project', taskOrder: [] },
  )
  assert.throws(
    () => validateDocument(editWorkspaceProject(before, 'p', { taskOrder: ['today', 'today'] })),
    /Invalid Project task order/,
  )
})

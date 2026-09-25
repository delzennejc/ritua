import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceTasks } from '../domain/task-creation'
import { emptyWorkspace } from '../domain/production-workspace'
import { selectTask } from '../domain/workspace-selectors'
import { validateDocument } from '../domain/workspace'
import { todayBoardStatus } from '../domain/today-board'

const context = { today: '2026-09-25', now: new Date('2026-09-25T10:00:00'), actor: 'Test' }
const request = {
  seriesId: 'calendar-task',
  area: 'Personal',
  accent: 'green',
  dateKey: '2026-09-26',
  minutes: 45,
  title: 'Selected calendar range',
  schedule: { start: 600, end: 645 },
}

test('calendar creation returns one canonical task and linked block together without changing its input', () => {
  const initial = emptyWorkspace(context.today)
  const before = structuredClone(initial)
  const { document, firstTaskId } = createWorkspaceTasks(initial, request, context)
  validateDocument(document)
  assert.deepEqual(initial, before)
  const task = selectTask(document, firstTaskId!)!
  assert.equal(task.channel, 'Personal')
  assert.equal(task.time, '10:00')
  assert.equal(task.minutes, 45)
  assert.equal(document.entities.find((entity) => entity.kind === 'task')!.data.lane, 'date:2026-09-26')
  const events = document.entities.filter((entity) => entity.kind === 'event')
  assert.equal(events.length, 1)
  assert.equal(events[0]!.data.taskId, firstTaskId)
  assert.deepEqual(events[0]!.data.content, {
    id: firstTaskId,
    start: 600,
    end: 645,
    dateKey: request.dateKey,
    color: 'green',
  })
})

test('invalid calendar creation cannot leave an unscheduled task behind', () => {
  const initial = emptyWorkspace(context.today)
  const before = structuredClone(initial)
  assert.throws(
    () => createWorkspaceTasks(initial, { ...request, schedule: { start: 600, end: 600 } }, context),
    /Invalid task schedule/,
  )
  assert.deepEqual(initial, before)
})

test('board capture creates its status and completion in the same document', () => {
  for (const dateKey of [context.today, '2026-09-26']) {
    for (const status of ['todo', 'in-progress', 'to-review', 'done'] as const) {
      const initial = emptyWorkspace(context.today)
      const { document, firstTaskId } = createWorkspaceTasks(
        initial,
        {
          ...request,
          dateKey,
          schedule: undefined,
          todayStatus: status,
          prepend: true,
        },
        context,
      )
      validateDocument(document)
      const task = selectTask(document, firstTaskId!)!
      assert.equal(todayBoardStatus(task), status)
      assert.equal(task.complete, status === 'done')
      if (status === 'done') assert.equal(task.completedDateKey, context.today)
      assert.equal(
        initial.entities.some((entity) => entity.kind === 'task'),
        false,
      )
      assert.equal(document.entities.filter((entity) => entity.kind === 'task').length, 1)
    }
  }
})

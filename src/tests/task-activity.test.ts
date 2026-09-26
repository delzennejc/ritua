import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import { moveTaskToTodayBoard } from '../domain/today-board'
import { createTodayStatusUndo, undoTodayStatus } from '../domain/today-board-undo'
import { editWorkspaceCalendar } from '../domain/calendar-commands'
import { createCalendarSession, linkSessionTask, moveSessionTask } from '../domain/calendar-sessions'
import type { Activity, Task } from '../domain/models'

const date = '2026-09-24'
const now = new Date(`${date}T10:00:00`)
const context = { today: date, now, actor: 'Test' }

function fixture() {
  const fields = project(emptyWorkspace(date))
  fields.tasks = [
    { id: 'task', title: 'Task', minutes: 45, complete: false, todayStatus: 'todo' },
    { id: 'other', title: 'Other', minutes: 30, complete: false },
  ]
  return normalize(fields)
}
const taskOf = (document: ReturnType<typeof fixture>, id = 'task') =>
  document.entities.find((entity) => entity.kind === 'task' && entity.id === id)!.data.content as Task
const labels = (task: Task) => (task.activity ?? []).map((entry: Activity) => entry.label)

test('Today board moves record their destination board in task history', () => {
  const initial = fixture()
  const moved = moveTaskToTodayBoard(initial, 'task', 'in-progress', now, undefined, context.actor)
  assert.deepEqual(labels(taskOf(moved)), ['Test created this', 'Test moved this to In Progress'])

  const repeated = moveTaskToTodayBoard(moved, 'task', 'in-progress', now, undefined, context.actor)
  assert.deepEqual(labels(taskOf(repeated)), labels(taskOf(moved)), 'Same-board calls add nothing')

  const silent = moveTaskToTodayBoard(initial, 'task', 'to-review', now)
  assert.equal(taskOf(silent).activity, undefined, 'Without an actor creation flows stay quiet')

  const done = moveTaskToTodayBoard(moved, 'task', 'done', now, undefined, context.actor)
  assert.equal(labels(taskOf(done)).at(-1), 'Test moved this to Done')
  const reopened = moveTaskToTodayBoard(done, 'task', 'todo', now, undefined, context.actor)
  assert.equal(labels(taskOf(reopened)).at(-1), 'Test moved this to Todo')

  const undo = createTodayStatusUndo(initial, moved, 'task')
  assert.deepEqual(project(undoTodayStatus(moved, undo)), project(initial), 'Undo restores history')
})

test('calendar scheduling, edits and removals append schedule history', () => {
  const initial = fixture()
  const block = { id: 'task', taskId: 'task', dateKey: date, start: 540, end: 585, color: 'violet' }
  const scheduled = editWorkspaceCalendar(initial, [block], context)
  assert.deepEqual(labels(taskOf(scheduled)), ['Test created this', 'Test scheduled this on the calendar'])

  const moved = editWorkspaceCalendar(scheduled, [{ ...block, start: 600, end: 645 }], {
    ...context,
    now: new Date(`${date}T11:00:00`),
  })
  assert.equal(labels(taskOf(moved)).at(-1), 'Test updated the schedule')

  const removed = editWorkspaceCalendar(moved, [], {
    ...context,
    now: new Date(`${date}T12:00:00`),
  })
  assert.equal(labels(taskOf(removed)).at(-1), 'Test removed this from the calendar')

  const silent = editWorkspaceCalendar(initial, [block])
  assert.equal(taskOf(silent).activity, undefined, 'Without a context the calendar stays quiet')
})

test('session membership appends history with the session title', () => {
  const created = createCalendarSession(fixture(), {
    id: 'session',
    title: 'Focus',
    dateKey: date,
    start: 600,
    end: 750,
  })
  const linked = linkSessionTask(created, 'session', 'task', context)
  assert.equal(labels(taskOf(linked)).at(-1), 'Test added this to the session “Focus”')

  const second = createCalendarSession(linked, {
    id: 'later',
    title: 'Later',
    dateKey: date,
    start: 800,
    end: 900,
  })
  const moved = moveSessionTask(second, 'session', 'task', 'later', null, context)
  assert.equal(labels(taskOf(moved)).at(-1), 'Test moved this to the session “Later”')

  const removed = moveSessionTask(moved, 'later', 'task', null, null, context)
  assert.equal(labels(taskOf(removed)).at(-1), 'Test removed this from the session “Later”')

  const reordered = moveSessionTask(linked, 'session', 'task', 'session', null, context)
  assert.deepEqual(
    labels(taskOf(reordered)),
    labels(taskOf(linked)),
    'Same-session reorder is not scheduling',
  )

  const silent = linkSessionTask(created, 'session', 'task')
  assert.equal(taskOf(silent).activity, undefined, 'Without a context sessions stay quiet')
})

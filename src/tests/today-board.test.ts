import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyWorkspace } from '../domain/production-workspace'
import { executeTaskCommand } from '../domain/task-commands'
import { moveTaskToTodayBoard, todayBoardStatus } from '../domain/today-board'
import { createTodayStatusUndo, undoTodayStatus } from '../domain/today-board-undo'
import { editDocument } from '../domain/workspace-immutable'
import { createCalendarSession, linkSessionTask } from '../domain/calendar-sessions'
import { freshOccurrence } from '../domain/recurring-workspace'
import { normalize, project, validateDocument, type Data } from '../domain/workspace'
import type { Task } from '../domain/models'

const date = '2026-09-24'
const now = new Date('2026-09-24T10:00:00')

function fixture() {
  const fields = project(emptyWorkspace(date))
  fields.tasks = [
    { id: 'task', title: 'Task', time: '09:00', minutes: 80, complete: false, todayStatus: 'in-progress' },
  ]
  fields.events = [
    { id: 'task', taskId: 'task', dateKey: date, start: 540, end: 620, complete: false, color: 'violet' },
  ]
  fields.weeklyObjectives = [
    {
      id: 'project',
      title: 'Project',
      channel: 'Work',
      tasks: [{ id: 'project-task', taskId: 'task', title: 'Task', complete: false }],
    },
  ]
  return normalize(fields)
}

test('Today board status defaults to Todo and roundtrips through canonical task and project mirrors', () => {
  const initial = fixture()
  const task = initial.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(todayBoardStatus(task as unknown as Task), 'in-progress')

  const after = moveTaskToTodayBoard(initial, 'task', 'to-review', now)
  assert.equal(
    todayBoardStatus(
      after.entities.find((entity) => entity.kind === 'task')!.data.content as unknown as Task,
    ),
    'to-review',
  )
  const projected = project(after)
  assert.equal((projected.tasks as Data[])[0]!.todayStatus, 'to-review')
  assert.equal(((projected.weeklyObjectives as Data[])[0]!.tasks as Data[])[0]!.todayStatus, 'to-review')
  assert.deepEqual(project(normalize(projected)), projected)

  const todo = moveTaskToTodayBoard(after, 'task', 'todo', now)
  const todoTask = todo.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(Object.hasOwn(todoTask, 'todayStatus'), false)
  assert.equal(todayBoardStatus(todoTask as unknown as Task), 'todo')
})

test('Done uses canonical completion side effects and moving out of Done reopens the task', () => {
  const initial = fixture()
  const completed = moveTaskToTodayBoard(initial, 'task', 'done', now)
  const completedTask = completed.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(todayBoardStatus(completedTask as unknown as Task), 'done')
  assert.equal(completedTask.complete, true)
  assert.equal(completedTask.completedDateKey, date)
  assert.equal(completedTask.actualMinutes, 60)
  const completedEvent = completed.entities.find((entity) => entity.kind === 'event')!.data.content as Data
  assert.equal(completedEvent.end, 600)
  const projected = project(completed)
  assert.equal(((projected.weeklyObjectives as Data[])[0]!.tasks as Data[])[0]!.complete, true)

  const reopened = moveTaskToTodayBoard(completed, 'task', 'in-progress', now)
  const reopenedTask = reopened.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(reopenedTask.complete, false)
  assert.equal(reopenedTask.completedDateKey, null)
  assert.equal(reopenedTask.actualMinutes, 60)
  assert.equal(reopenedTask.todayStatus, 'in-progress')
  assert.equal(todayBoardStatus(reopenedTask as unknown as Task), 'in-progress')
})

test('Today status follows a rescheduled task and does not copy to recurrence occurrences', () => {
  const movedOut = executeTaskCommand(
    fixture(),
    { type: 'task.move', taskId: 'task', lane: 'date:2026-09-25' },
    { today: date, now, actor: 'Test' },
  )
  let task = movedOut.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(task.todayStatus, 'in-progress')
  const movedBack = executeTaskCommand(
    movedOut,
    { type: 'task.move', taskId: 'task', lane: 'today' },
    { today: date, now, actor: 'Test' },
  )
  task = movedBack.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(todayBoardStatus(task as unknown as Task), 'in-progress')
  assert.equal((freshOccurrence({ ...task, todayStatus: 'to-review' }) as Data).todayStatus, undefined)
})

test('Today boards support selected future dates without changing the scheduled date', () => {
  const futureDate = '2026-09-25'
  const moved = executeTaskCommand(
    fixture(),
    { type: 'task.move', taskId: 'task', lane: `date:${futureDate}` },
    { today: date, now, actor: 'Test' },
  )
  const changed = moveTaskToTodayBoard(moved, 'task', 'to-review', now)
  const entity = changed.entities.find((item) => item.kind === 'task')!
  assert.equal(entity.data.lane, `date:${futureDate}`)
  assert.equal((entity.data.content as Data).todayStatus, 'to-review')
  assert.equal((changed.entities.find((item) => item.kind === 'event')!.data.content as Data).dateKey, date)
})

test('status changes preserve schedule and Undo reverses completion timing without overwriting later edits', () => {
  const initial = fixture()
  const session = linkSessionTask(
    createCalendarSession(initial, { id: 'session', title: 'Focus', dateKey: date, start: 540, end: 620 }),
    'session',
    'task',
  )
  const changed = moveTaskToTodayBoard(session, 'task', 'done', now)
  assert.equal(changed.entities.find((entity) => entity.kind === 'task')!.data.lane, 'today')
  assert.deepEqual(
    (changed.entities.find((entity) => entity.id === 'session')!.data.content as Data).taskIds,
    ['task'],
  )
  const undo = createTodayStatusUndo(session, changed, 'task')
  const laterEdit = editDocument(changed, (document) => {
    const task = document.entities.find((entity) => entity.kind === 'task')!
    ;(task.data.content as Data).title = 'Renamed after completion'
  })
  const restored = undoTodayStatus(laterEdit, undo)
  const restoredTask = restored.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(restoredTask.complete, false)
  assert.equal(restoredTask.title, 'Renamed after completion')
  assert.equal(restored.entities.find((entity) => entity.kind === 'task')!.data.lane, 'today')
  assert.equal((restored.entities.find((entity) => entity.id === 'session')!.data.content as Data).end, 620)
  assert.deepEqual(
    (restored.entities.find((entity) => entity.id === 'session')!.data.content as Data).taskIds,
    ['task'],
  )
})

test('Today status Undo refuses the whole inverse after a calendar timing conflict', () => {
  const initial = fixture()
  const changed = moveTaskToTodayBoard(initial, 'task', 'done', now)
  const undo = createTodayStatusUndo(initial, changed, 'task')
  const rescheduled = editDocument(changed, (document) => {
    const event = document.entities.find(
      (entity) => entity.kind === 'event' && entity.data.taskId === 'task',
    )!
    ;(event.data.content as Data).end = 630
  })
  const attempted = undoTodayStatus(rescheduled, undo)
  assert.equal(attempted, rescheduled)
  const task = attempted.entities.find((entity) => entity.kind === 'task')!.data.content as Data
  assert.equal(task.complete, true)
  assert.equal(task.minutes, 60)
  assert.equal((attempted.entities.find((entity) => entity.kind === 'event')!.data.content as Data).end, 630)
})

test('Done Undo restores its block and following shifted task exactly', () => {
  const fields = project(emptyWorkspace(date))
  fields.tasks = [
    { id: 'task', title: 'Task', time: '09:00', minutes: 80, complete: false },
    { id: 'following', title: 'Following', time: '11:00', minutes: 60, complete: false },
  ]
  fields.events = [
    { id: 'task', taskId: 'task', dateKey: date, start: 540, end: 620, complete: false, color: 'violet' },
    {
      id: 'following',
      taskId: 'following',
      dateKey: date,
      start: 660,
      end: 720,
      complete: false,
      color: 'blue',
    },
  ]
  const initial = normalize(fields)
  const completed = moveTaskToTodayBoard(initial, 'task', 'done', now)
  assert.equal(
    (
      completed.entities.find((entity) => entity.kind === 'event' && entity.id === 'following')!.data
        .content as Data
    ).start,
    640,
  )
  const undo = createTodayStatusUndo(initial, completed, 'task')
  assert.deepEqual(undoTodayStatus(completed, undo), initial)
})

test('Done Undo refuses to shift a following task after it has moved to another date', () => {
  const fields = project(emptyWorkspace(date))
  fields.tasks = [
    { id: 'task', title: 'Task', time: '09:00', minutes: 80, complete: false },
    { id: 'following', title: 'Following', time: '11:00', minutes: 60, complete: false },
  ]
  fields.events = [
    { id: 'task', taskId: 'task', dateKey: date, start: 540, end: 620, complete: false, color: 'violet' },
    {
      id: 'following',
      taskId: 'following',
      dateKey: date,
      start: 660,
      end: 720,
      complete: false,
      color: 'blue',
    },
  ]
  const initial = normalize(fields)
  const completed = moveTaskToTodayBoard(initial, 'task', 'done', now)
  const undo = createTodayStatusUndo(initial, completed, 'task')
  const rescheduled = editDocument(completed, (document) => {
    document.entities.find((entity) => entity.kind === 'task' && entity.id === 'following')!.data.lane =
      'date:2026-09-25'
  })
  assert.equal(undoTodayStatus(rescheduled, undo), rescheduled)
  const task = rescheduled.entities.find((entity) => entity.kind === 'task' && entity.id === 'task')!
  assert.equal((task.data.content as Data).complete, true)
})

test('Today status Undo refuses a stale inverse after the task moves to another date', () => {
  const initial = fixture()
  const changed = moveTaskToTodayBoard(initial, 'task', 'to-review', now)
  const undo = createTodayStatusUndo(initial, changed, 'task')
  const rescheduled = editDocument(changed, (document) => {
    document.entities.find((entity) => entity.kind === 'task')!.data.lane = `date:${'2026-09-25'}`
  })
  assert.equal(undoTodayStatus(rescheduled, undo), rescheduled)
  assert.equal(
    (rescheduled.entities.find((entity) => entity.kind === 'task')!.data.content as Data).todayStatus,
    'to-review',
  )
})

test('canonical tasks can change Today status after leaving a scheduled lane', () => {
  const movedOut = editDocument(fixture(), (document) => {
    document.entities.find((entity) => entity.kind === 'task')!.data.lane = 'backlog:Work'
  })
  const changed = moveTaskToTodayBoard(movedOut, 'task', 'to-review', now)
  assert.equal(
    (changed.entities.find((entity) => entity.kind === 'task')!.data.content as Data).todayStatus,
    'to-review',
  )
})

test('workspace validation rejects unknown persisted Today board status', () => {
  const invalid = fixture()
  const entity = invalid.entities.find((item) => item.kind === 'task')!
  ;(entity.data.content as Data).todayStatus = 'blocked'
  assert.throws(() => validateDocument(invalid), /Invalid Today board status/)
  for (const invalidStatus of [null, ['todo']]) {
    const malformed = fixture()
    const task = malformed.entities.find((item) => item.kind === 'task')!
    ;(task.data.content as Data).todayStatus = invalidStatus as never
    assert.throws(() => validateDocument(malformed), /Invalid Today board status/)
  }
})

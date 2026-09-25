import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace-projection'
import {
  createCalendarSession,
  updateCalendarSession,
  linkSessionTask,
  moveSessionTask,
  removeCalendarSession,
  restoreCalendarSession,
} from '../domain/calendar-sessions'
import { executeTaskCommand } from '../domain/task-commands'
import { createWorkspaceTasks } from '../domain/task-creation'
import { moveScheduledTask } from '../domain/task-scheduling'
import { commitBoardSessionOrder, documentSessions } from '../domain/session-board-order'
import { toggleWorkspaceTaskCompletion } from '../domain/task-completion'
import { editWorkspaceCalendar } from '../domain/calendar-commands'
import { workspaceCollections } from '../domain/workspace-collections'
import type { Data, WorkspaceDocument } from '../domain/workspace-types'
const today = '2026-09-14'
const context = { today, actor: 'Test', now: new Date(`${today}T10:30:00`) }
const ids = (document: WorkspaceDocument) =>
  workspaceCollections(project(document)).tasks.map((task) => task.id)
const members = (document: WorkspaceDocument) => documentSessions(document)[0]!.taskIds
function fixture() {
  const fields = project(emptyWorkspace(today))
  fields.tasks = ['free', 'a', 'b', 'c', 'nine', 'one'].map((id) => ({
    id,
    title: id,
    minutes: 30,
    complete: false,
  }))
  let document = createCalendarSession(normalize(fields), {
    id: 'session',
    title: 'Focus session with a long name',
    dateKey: today,
    start: 600,
    end: 750,
  })
  document = executeTaskCommand(
    document,
    { type: 'task.schedule', taskId: 'nine', dateKey: today, start: 540, end: 570 },
    context,
  )
  document = executeTaskCommand(
    document,
    { type: 'task.schedule', taskId: 'one', dateKey: today, start: 780, end: 810 },
    context,
  )
  return updateCalendarSession(document, 'session', { taskIds: ['a', 'b', 'c'] })
}

test('top board creation stays above planned session tasks and preserves existing order', () => {
  for (const dateKey of [today, '2026-09-15']) {
    let before = fixture()
    if (dateKey !== today) {
      before = updateCalendarSession(before, 'session', { dateKey })
    }
    const tasks = (document: WorkspaceDocument) => {
      const collections = workspaceCollections(project(document))
      return (dateKey === today ? collections.tasks : collections.datedTasksByDate[dateKey]!).map(
        (task) => task.id,
      )
    }
    const after = createWorkspaceTasks(
      before,
      {
        seriesId: 'new',
        title: 'New task',
        area: 'Work',
        accent: 'violet',
        minutes: 30,
        dateKey,
        prepend: true,
      },
      context,
    ).document
    assert.deepEqual(tasks(after), ['new', ...tasks(before)])
    assert.deepEqual(members(after), members(before))
    assert.deepEqual(tasks(normalize(project(after))), tasks(after), 'Explicit order survives serialization')
  }
})

test('session references supply chronological board placement and exact row order', () => {
  let document = fixture()
  assert.deepEqual(ids(document), ['nine', 'a', 'b', 'c', 'one', 'free'])
  document = moveSessionTask(document, 'session', 'c', 'session', 'a')
  assert.deepEqual(ids(document), ['nine', 'c', 'a', 'b', 'one', 'free'])
  document = executeTaskCommand(
    document,
    { type: 'task.schedule', taskId: 'free', dateKey: today, start: 480, end: 510 },
    context,
  )
  assert.deepEqual(ids(document), ['free', 'nine', 'c', 'a', 'b', 'one'])
  document = toggleWorkspaceTaskCompletion(document, 'a', context.now)
  assert.deepEqual(
    ids(document).filter((id) => members(document).includes(id)),
    members(document),
    'Completion retains the same ordering in both views',
  )
  document = toggleWorkspaceTaskCompletion(document, 'nine', context.now)
  assert.deepEqual(
    ids(document),
    ['free', 'c', 'b', 'one', 'nine', 'a'],
    'Completing a standalone block keeps session tasks at their session time',
  )
})

test('board reorder updates session references; leaving the group removes its timing', () => {
  let document = fixture()
  document = moveScheduledTask(
    document,
    { taskId: 'c', sourceDateKey: today, targetDateKey: today, targetIndex: 1 },
    today,
  ).document
  assert.deepEqual(members(document), ['c', 'a', 'b'])
  assert.deepEqual(ids(document), ['nine', 'c', 'a', 'b', 'one', 'free'])
  document = moveScheduledTask(
    document,
    { taskId: 'a', sourceDateKey: today, targetDateKey: today, targetIndex: 5 },
    today,
  ).document
  assert.deepEqual(members(document), ['c', 'b'])
  assert.deepEqual(ids(document), ['nine', 'c', 'b', 'one', 'free', 'a'])
  assert.equal(workspaceCollections(project(document)).tasks.find((task) => task.id === 'a')!.time, undefined)
})

test('board previews retain membership until drop and preserve hidden member slots', () => {
  const before = fixture()
  const preview = moveScheduledTask(
    before,
    { taskId: 'a', sourceDateKey: today, targetDateKey: today, targetIndex: 5, syncEventDate: false },
    today,
  ).document
  assert.deepEqual(members(preview), ['a', 'b', 'c'])
  assert.deepEqual(members(commitBoardSessionOrder(preview, 'a', today)), ['b', 'c'])
  assert.deepEqual(members(before), ['a', 'b', 'c'], 'Canceled previews leave the snapshot intact')
  const filtered = moveScheduledTask(
    before,
    {
      taskId: 'c',
      sourceDateKey: today,
      targetDateKey: today,
      targetIndex: 1,
      visibleTaskIds: ['nine', 'a', 'c', 'one', 'free'],
    },
    today,
  ).document
  assert.deepEqual(members(filtered), ['c', 'b', 'a'])
})

test('session moves carry members to their date; removal and deletion return them to unscheduled work', () => {
  let document = fixture()
  document = updateCalendarSession(document, 'session', { dateKey: '2026-09-15', start: 480, end: 600 })
  assert.deepEqual(ids(document), ['nine', 'one', 'free'])
  assert.deepEqual(
    workspaceCollections(project(document)).datedTasksByDate['2026-09-15']!.map((task) => task.id),
    ['a', 'b', 'c'],
  )
  document = moveScheduledTask(
    document,
    { taskId: 'a', sourceDateKey: '2026-09-15', targetDateKey: today },
    today,
  ).document
  assert.deepEqual(members(document), ['b', 'c'])
  const session = document.entities.find((entity) => entity.id === 'session')!
  const removed = removeCalendarSession(document, 'session')
  const restored = restoreCalendarSession(
    removed,
    session.data.content as Data,
    Number(session.data.position),
  )
  assert.deepEqual(project(restored), project(document))
})

test('calendar drag moves reorder the board, and linking replaces a separate task schedule', () => {
  let document = fixture()
  const fields = workspaceCollections(project(document))
  document = editWorkspaceCalendar(
    document,
    fields.events.map((event) => (event.id === 'session' ? { ...event, start: 480, end: 630 } : event)),
  )
  assert.deepEqual(ids(document), ['a', 'b', 'c', 'nine', 'one', 'free'])
  document = linkSessionTask(document, 'session', 'nine')
  assert.equal(workspaceCollections(project(document)).tasks.find((task) => task.id === 'nine')!.time, null)
  assert.ok(!document.entities.some((entity) => entity.kind === 'event' && entity.data.taskId === 'nine'))
  document = moveSessionTask(document, 'session', 'nine', null)
  assert.deepEqual(ids(document), ['a', 'b', 'c', 'one', 'nine', 'free'])
})

test('linking backlog work preserves the remaining list order and task estimate', () => {
  const fields = project(emptyWorkspace(today))
  const groups = fields.backlogGroups as Data[]
  groups[0]!.items = ['before', 'member', 'after'].map((id) => ({ id, title: id, minutes: 45 }))
  let document = createCalendarSession(normalize(fields), {
    id: 'session',
    title: 'Focus',
    dateKey: today,
    start: 600,
    end: 750,
  })
  document = linkSessionTask(document, 'session', 'member')
  const remaining = document.entities.filter(
    (entity) => entity.kind === 'task' && String(entity.data.lane).startsWith('backlog:'),
  )
  assert.deepEqual(
    remaining.map((entity) => [entity.id, entity.data.position]),
    [
      ['before', 0],
      ['after', 1],
    ],
  )
  assert.deepEqual(ids(document), ['member'])
  assert.equal(workspaceCollections(project(document)).tasks[0]!.minutes, 45)
})

test('session completion moves to the top of completed work and reopening restores active order', () => {
  let document = fixture()
  document = toggleWorkspaceTaskCompletion(document, 'b', context.now)
  assert.deepEqual(members(document), ['a', 'c', 'b'])
  assert.deepEqual(ids(document), ['nine', 'a', 'c', 'one', 'free', 'b'])
  document = toggleWorkspaceTaskCompletion(document, 'nine', context.now)
  document = toggleWorkspaceTaskCompletion(document, 'a', context.now)
  assert.deepEqual(members(document), ['c', 'a', 'b'])
  assert.deepEqual(ids(document), ['c', 'one', 'free', 'a', 'nine', 'b'])
  document = moveSessionTask(document, 'session', 'b', 'session', 'a')
  assert.deepEqual(members(document), ['c', 'b', 'a'])
  assert.deepEqual(ids(document), ['c', 'one', 'free', 'b', 'nine', 'a'])
  document = toggleWorkspaceTaskCompletion(document, 'a', context.now)
  assert.deepEqual(members(document), ['a', 'c', 'b'])
  assert.deepEqual(ids(document), ['a', 'c', 'one', 'free', 'b', 'nine'])
  document = toggleWorkspaceTaskCompletion(document, 'b', context.now)
  assert.deepEqual(members(document), ['a', 'b', 'c'])
  assert.deepEqual(ids(document), ['a', 'b', 'c', 'one', 'free', 'nine'])
})

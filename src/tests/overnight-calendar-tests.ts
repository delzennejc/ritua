import assert from 'node:assert/strict'
import {
  calendarEventOnDate,
  taskScheduleEnd,
  validTaskSchedule,
  calendarEndLabel,
} from '../domain/calendar-time'
import { emptyWorkspace } from '../domain/production-workspace'
import { executeTaskCommand } from '../domain/task-commands'
import { editWorkspaceCalendar } from '../domain/calendar-commands'
import { editWorkspaceTask } from '../domain/task-editing'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from '../domain/task-deletion'
import { toggleWorkspaceTaskCompletion } from '../domain/task-completion'
import { rollWorkspaceDate } from '../domain/live-calendar'
import { selectTask } from '../domain/workspace-selectors'
import { project, validateDocument, type WorkspaceDocument } from '../domain/workspace'
import { workspaceCollections } from '../domain/workspace-collections'

export function testOvernightCalendar() {
  const today = '2026-09-16'
  const context = { today, now: new Date(`${today}T12:00:00`), actor: 'Test' }
  const events = (doc: WorkspaceDocument) => workspaceCollections(project(doc)).events
  const base = executeTaskCommand(
    emptyWorkspace(today),
    {
      type: 'task.create',
      tasks: [{ task: { id: 'overnight', title: 'Overnight work', complete: false }, lane: 'today' }],
    },
    context,
  )
  const end = taskScheduleEnd(1425, 120)
  assert.equal(end, 1560)
  assert.equal(taskScheduleEnd(0, 0), 1440, 'A full-day block can be reopened and saved')
  assert.equal(calendarEndLabel(end), '02:00 (+1 day)')
  const doc = executeTaskCommand(
    base,
    { type: 'task.schedule', taskId: 'overnight', dateKey: today, start: 1425, end },
    context,
  )
  validateDocument(doc)
  assert.equal(events(doc).length, 1, 'Overnight work is one canonical block')
  assert.equal(selectTask(doc, 'overnight')!.minutes, 135)
  const block = events(doc)[0]!
  const first = calendarEventOnDate(block, today, today)!
  const second = calendarEventOnDate(block, '2026-09-17', today)!
  assert.deepEqual([first.start, first.end, second.start, second.end], [1425, 1440, 0, 120])
  assert.equal(first.sourceEvent, second.sourceEvent)
  assert.equal(calendarEventOnDate(block, '2026-09-18', today), null)
  assert.equal(
    calendarEventOnDate({ ...block, end: 1440 }, '2026-09-17', today),
    null,
    'Midnight does not create an empty continuation',
  )
  for (const [date, next] of [
    ['2026-12-31', '2027-01-01'],
    ['2026-03-28', '2026-03-29'],
    ['2026-10-24', '2026-10-25'],
  ]) {
    assert.equal(calendarEventOnDate({ ...block, dateKey: date }, next!, today)!.end, 120)
  }
  for (const [start, invalidEnd] of [
    [1440, 1560],
    [-1, 120],
    [1425, 120],
    [1425, 2866],
    [1425, Infinity],
  ]) {
    assert.equal(validTaskSchedule(start!, invalidEnd!), false)
    assert.throws(
      () =>
        executeTaskCommand(
          base,
          { type: 'task.schedule', taskId: 'overnight', dateKey: today, start: start!, end: invalidEnd! },
          context,
        ),
      /Invalid task schedule/,
    )
  }
  const invalid = structuredClone(doc)
  invalid.entities.find((e) => e.kind === 'event')!.data.taskId = null
  assert.throws(
    () => validateDocument(invalid),
    /Invalid calendar event/,
    'Unlinked events remain bounded to one day',
  )
  const resized = editWorkspaceCalendar(doc, [{ ...block, end: 1590 }])
  validateDocument(resized)
  assert.equal(selectTask(resized, 'overnight')!.minutes, 165)
  const durationEdit = editWorkspaceTask(doc, 'overnight', { minutes: 180 }, context)
  validateDocument(durationEdit)
  assert.equal(events(durationEdit)[0]!.end, 1605)
  const rolled = rollWorkspaceDate(doc, '2026-09-17')
  assert.equal(calendarEventOnDate(events(rolled)[0]!, '2026-09-17', '2026-09-17')!.end, 120)
  const completed = toggleWorkspaceTaskCompletion(rolled, 'overnight', new Date('2026-09-17T01:45:00'))
  validateDocument(completed)
  assert.equal(events(completed)[0]!.end, 1545)
  assert.equal(selectTask(completed, 'overnight')!.actualMinutes, 120)
  const withEarlierTask = executeTaskCommand(
    doc,
    {
      type: 'task.create',
      tasks: [{ task: { id: 'earlier', title: 'Earlier work', complete: false }, lane: 'today' }],
    },
    context,
  )
  const withEarlierBlock = executeTaskCommand(
    withEarlierTask,
    {
      type: 'task.schedule',
      taskId: 'earlier',
      dateKey: today,
      start: 1380,
      end: 1420,
    },
    context,
  )
  const shifted = toggleWorkspaceTaskCompletion(withEarlierBlock, 'earlier', new Date(`${today}T23:50:00`))
  validateDocument(shifted)
  const shiftedNight = events(shifted).find((event) => event.id === 'overnight')!
  assert.deepEqual(
    [shiftedNight.start, shiftedNight.end],
    [1435, 1570],
    'Earlier completion shifts overnight work forward without shortening it',
  )
  const deleted = deleteWorkspaceTask(doc, 'overnight')
  assert.equal(events(deleted.document).length, 0)
  assert.deepEqual(project(undoWorkspaceTaskDeletion(deleted.document, deleted.undo)), project(doc))
  const unscheduled = executeTaskCommand(
    doc,
    { type: 'task.unschedule', taskId: 'overnight', eventId: block.id },
    context,
  )
  assert.equal(events(unscheduled).length, 0)
  assert.equal(selectTask(unscheduled, 'overnight')!.minutes, 0)
  return doc
}

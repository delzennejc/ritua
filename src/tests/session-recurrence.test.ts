import assert from 'node:assert/strict'
import test from 'node:test'
import type { Fields } from '../domain/workspace-types'
import { addDays, localDateKey } from '../domain/live-calendar'
import { emptyWorkspace } from '../domain/production-workspace'
import { noRecurrence, recurrenceForPreset } from '../domain/recurrence'
import { normalize, project, validateDocument, type Data } from '../domain/workspace'
import {
  addSessionTask,
  changeWorkspaceSessionColor,
  changeWorkspaceSessionRecurrence,
  createCalendarSession,
  deleteWorkspaceSession,
  extendSessionRecurrences,
  toggleWorkspaceTaskCompletion,
  undoWorkspaceSessionDeletion,
  updateCalendarSession,
} from './view-command-adapters'

const events = (fields: Fields) => fields.events as Data[]
const tasks = (fields: Fields) => [
  ...((fields.tasks as Data[]) || []),
  ...Object.values((fields.datedTasksByDate as Record<string, Data[]>) || {}).flat(),
]
const occurrences = (fields: Fields, seriesId: string) =>
  events(fields).filter((event) => event.recurrenceSeriesId === seriesId)
const taskById = (fields: Fields, id: string) => tasks(fields).find((task) => task.id === id)

function sessionWithTasks(today: string) {
  let fields = project(emptyWorkspace(today))
  fields = createCalendarSession(fields, {
    id: 'session-recur',
    title: 'Focus block',
    dateKey: today,
    start: 540,
    end: 660,
  })
  fields = addSessionTask(fields, 'session-recur', { id: 'task-write', title: 'Write outline' })
  fields = addSessionTask(fields, 'session-recur', { id: 'task-review', title: 'Review notes' })
  return fields
}

test('repeating an empty session repeats the session without creating tasks', () => {
  const today = localDateKey()
  let fields = project(emptyWorkspace(today))
  fields = createCalendarSession(fields, {
    id: 'session-empty',
    title: 'Standup',
    dateKey: today,
    start: 540,
    end: 555,
  })
  fields = changeWorkspaceSessionRecurrence(fields, 'session-empty', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-empty',
  })

  validateDocument(normalize(fields))
  const repeated = occurrences(fields, 'series-empty')
  assert.equal(repeated.length, 53, 'Weekly repeats cover the one-year generation horizon')
  assert.equal(repeated[0]!.id, 'session-empty')
  assert.equal(repeated[0]!.title, 'Standup')
  assert.deepEqual(repeated[0]!.taskIds, [])
  assert.ok(repeated.every((event) => (event.taskIds as string[]).length === 0))
  assert.equal(tasks(fields).length, 0, 'An empty recurring session never creates task copies')
  assert.equal((fields.sessionRecurrenceProgress as Data)['series-empty'], addDays(today, 365))
  const definition = (fields.sessionRecurrenceDefinitions as Data)['series-empty'] as Data
  assert.equal((definition.session as Data).recurrenceStartDateKey, today)
  assert.deepEqual(definition.tasks, [])
  assert.equal(new Set(events(fields).map((event) => event.id)).size, repeated.length)
})

test('repeating a session with tasks repeats its tasks in every occurrence', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-work',
  })

  validateDocument(normalize(fields))
  const repeated = occurrences(fields, 'series-work')
  assert.equal(repeated.length, 366)
  assert.deepEqual(repeated[0]!.taskIds, ['task-write', 'task-review'])
  const second = repeated[1]!
  assert.equal(second.dateKey, addDays(today, 1))
  assert.equal((second.taskIds as string[]).length, 2)
  assert.ok(!(second.taskIds as string[]).includes('task-write'))
  assert.deepEqual(
    (second.taskIds as string[]).map((id) => taskById(fields, id)!.title),
    ['Write outline', 'Review notes'],
  )
  for (const id of second.taskIds as string[]) {
    const copy = taskById(fields, id)!
    assert.notEqual(copy.id, 'task-write')
    assert.equal(copy.complete, false)
    assert.equal(copy.time, null)
    assert.equal(copy.recurrenceSeriesId, undefined, 'Session copies repeat with the session, not alone')
  }
  assert.ok(repeated.every((event) => (event.taskIds as string[]).length === 2))
  assert.equal(new Set(tasks(fields).map((task) => task.id)).size, tasks(fields).length)
})

test('changing a recurring session replaces future occurrences and preserves history', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-old',
  })
  const daily = occurrences(fields, 'series-old')
  const second = daily[1]!
  fields = changeWorkspaceSessionRecurrence(
    fields,
    second.id as string,
    recurrenceForPreset('weekly', String(second.dateKey)),
    {
      today,
      seriesId: 'series-new',
    },
  )

  const previous = occurrences(fields, 'series-old')
  assert.equal(previous.length, 1, 'Past occurrences keep their history')
  assert.equal(previous[0]!.id, 'session-recur')
  assert.equal(
    (fields.sessionRecurrenceStops as Data)['series-old'],
    true,
    'The replaced series stops extending',
  )
  const repeated = occurrences(fields, 'series-new')
  assert.equal(repeated.length, 53)
  assert.equal(repeated[0]!.id, second.id, 'The selected occurrence is reused, not duplicated')
  assert.equal((fields.sessionRecurrenceProgress as Data)['series-new'], addDays(String(second.dateKey), 365))
  validateDocument(normalize(fields))
})

test('repeating a session can repeat only the time slot', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-slot',
    repeatTasks: false,
  })

  validateDocument(normalize(fields))
  const repeated = occurrences(fields, 'series-slot')
  assert.equal(repeated.length, 366)
  assert.deepEqual(repeated[0]!.taskIds, ['task-write', 'task-review'])
  assert.ok(
    repeated.slice(1).every((event) => (event.taskIds as string[]).length === 0),
    'Session-only occurrences stay empty for ad-hoc work',
  )
  assert.deepEqual(
    tasks(fields)
      .map((task) => task.id)
      .sort(),
    ['task-review', 'task-write'],
    'The original tasks stay only in the selected session',
  )
  const definition = (fields.sessionRecurrenceDefinitions as Data)['series-slot'] as Data
  assert.equal(definition.repeatTasks, false)
  assert.equal((definition.tasks as Data[]).length, 2, 'Task templates stay remembered for a later change')
  const extended = extendSessionRecurrences(fields, addDays(today, 30))
  const later = occurrences(extended, 'series-slot').find((event) => event.dateKey === addDays(today, 366))
  assert.ok(later && (later.taskIds as string[]).length === 0, 'Extended slots stay empty')
})

test('switching a task-filled series to session only clears untouched future copies', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-switch',
  })
  const before = occurrences(fields, 'series-switch')
  const workedId = (before[1]!.taskIds as string[])[0]!
  fields = toggleWorkspaceTaskCompletion(fields, workedId)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-switch-slot',
    repeatTasks: false,
  })

  const after = occurrences(fields, 'series-switch-slot')
  assert.equal(after.length, 53)
  assert.deepEqual(after[0]!.taskIds, ['task-write', 'task-review'], 'The selected session keeps its tasks')
  assert.ok(
    after.slice(1).every((event) => (event.taskIds as string[]).length === 0),
    'Future occurrences become empty time slots',
  )
  assert.equal((fields.sessionRecurrenceStops as Data)['series-switch'], true)
  assert.ok(taskById(fields, workedId)?.complete, 'Completed work stays on the board')
  assert.deepEqual(
    tasks(fields)
      .map((task) => task.id)
      .sort(),
    ['task-review', 'task-write', workedId].sort(),
  )
})

test('switching a session-only series back to tasks fills reused occurrences', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-empty-days',
    repeatTasks: false,
  })
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-filled-days',
  })

  const after = occurrences(fields, 'series-filled-days')
  assert.equal(after.length, 53)
  assert.deepEqual(after[0]!.taskIds, ['task-write', 'task-review'])
  assert.ok(
    after.slice(1).every((event) => (event.taskIds as string[]).length === 2),
    'Reused empty occurrences receive fresh copies of the selected session tasks',
  )
  const definition = (fields.sessionRecurrenceDefinitions as Data)['series-filled-days'] as Data
  assert.equal((definition.tasks as Data[]).length, 2)
  assert.equal(definition.repeatTasks, true)
})

test('switching from an empty occurrence repeats the series tasks again', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-empty-again',
    repeatTasks: false,
  })
  const empty = occurrences(fields, 'series-empty-again')[1]!
  assert.ok(!(empty.taskIds as string[]).length)
  fields = changeWorkspaceSessionRecurrence(
    fields,
    empty.id as string,
    recurrenceForPreset('weekly', String(empty.dateKey)),
    { today, seriesId: 'series-back-to-tasks' },
  )

  const after = occurrences(fields, 'series-back-to-tasks')
  assert.equal(after[0]!.id, empty.id)
  assert.equal(
    (after[0]!.taskIds as string[]).length,
    2,
    'An empty occurrence can restore the remembered task templates',
  )
  assert.ok(after.slice(1).every((event) => (event.taskIds as string[]).length === 2))
})

test('repeated sessions keep the background color and follow later color changes', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = updateCalendarSession(fields, 'session-recur', { color: 'teal' })
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-color',
  })
  const definition = (fields.sessionRecurrenceDefinitions as Data)['series-color'] as Data
  assert.equal((definition.session as Data).color, 'teal')
  assert.ok(
    occurrences(fields, 'series-color').every((event) => event.color === 'teal'),
    'New occurrences inherit the session background color',
  )

  fields = changeWorkspaceSessionColor(fields, 'session-recur', 'green')
  assert.ok(
    occurrences(fields, 'series-color').every((event) => event.color === 'green'),
    'Changing the color updates this occurrence and the rest of the series',
  )
  assert.equal(
    (((fields.sessionRecurrenceDefinitions as Data)['series-color'] as Data).session as Data).color,
    'green',
    'The repeat template follows the new color',
  )

  fields = changeWorkspaceSessionColor(fields, 'session-recur', null)
  assert.ok(
    occurrences(fields, 'series-color').every((event) => event.color === undefined),
    'The default background removes the color from the series',
  )
  assert.equal(
    (((fields.sessionRecurrenceDefinitions as Data)['series-color'] as Data).session as Data).color,
    undefined,
  )
  validateDocument(normalize(fields))
})

test('stopping a recurring session keeps worked copies and removes untouched ones', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-stop',
  })
  const repeated = occurrences(fields, 'series-stop')
  const copyId = (repeated[1]!.taskIds as string[])[0]!
  fields = toggleWorkspaceTaskCompletion(fields, copyId)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', noRecurrence(), {
    today,
    seriesId: 'series-stop-off',
  })

  const remaining = events(fields).filter((event) => event.recurrenceSeriesId === 'series-stop')
  assert.equal(remaining.length, 0)
  const selected = events(fields).find((event) => event.id === 'session-recur')!
  assert.equal(selected.recurrenceSeriesId, undefined)
  assert.equal(selected.recurrence, undefined)
  assert.deepEqual(selected.taskIds, ['task-write', 'task-review'])
  assert.ok(taskById(fields, copyId)?.complete, 'A completed task stays on the board')
  assert.deepEqual(
    tasks(fields)
      .map((task) => task.id)
      .sort(),
    ['task-review', 'task-write', copyId].sort(),
    'Untouched generated copies are removed with their session',
  )
  assert.equal((fields.sessionRecurrenceStops as Data)['series-stop'], true)
  const extended = extendSessionRecurrences(fields, addDays(today, 40))
  assert.equal(extended, fields, 'A stopped session series never extends again')
})

test('deleting this and following sessions stops the series and Undo restores it', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-delete',
  })
  const repeated = occurrences(fields, 'series-delete')
  const target = repeated[2]!
  const result = deleteWorkspaceSession(fields, target.id as string, 'following')
  const remaining = occurrences(result.fields, 'series-delete')
  assert.deepEqual(
    remaining.map((event) => event.id),
    [repeated[0]!.id, repeated[1]!.id],
  )
  assert.equal((result.fields.sessionRecurrenceStops as Data)['series-delete'], true)
  assert.ok(
    taskById(result.fields, (target.taskIds as string[])[0]!),
    'Deleted sessions never delete their tasks',
  )
  const restored = undoWorkspaceSessionDeletion(result.fields, result.undo)
  assert.deepEqual(
    occurrences(restored, 'series-delete').map((event) => event.id),
    repeated.map((event) => event.id),
  )
  assert.equal((restored.sessionRecurrenceStops as Data)['series-delete'], undefined)
  validateDocument(normalize(restored))
})

test('deleting one recurring session keeps the rest of the series', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-single',
  })
  const repeated = occurrences(fields, 'series-single')
  const result = deleteWorkspaceSession(fields, repeated[1]!.id as string, 'single')
  assert.equal(occurrences(result.fields, 'series-single').length, repeated.length - 1)
  assert.equal((result.fields.sessionRecurrenceStops as Data)['series-single'], undefined)
})

test('recurring sessions extend beyond the remembered horizon without resurrecting deletions', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('daily', today), {
    today,
    seriesId: 'series-extend',
  })
  const horizon = addDays(today, 30)
  const extended = extendSessionRecurrences(fields, horizon)
  const after = occurrences(extended, 'series-extend')
  assert.equal(after.length, 396, 'Extension appends beyond the previous generation boundary')
  assert.equal((after.at(-1)!.taskIds as string[]).length, 2, 'Extended occurrences repeat the session tasks')
  assert.equal((extended.sessionRecurrenceProgress as Data)['series-extend'], addDays(horizon, 365))
  const removed = after.at(-1)!
  const deleted = deleteWorkspaceSession(extended, removed.id as string, 'single')
  const deepened = extendSessionRecurrences(deleted.fields, addDays(today, 60))
  assert.ok(!occurrences(deepened, 'series-extend').some((event) => event.id === removed.id))
  assert.ok(occurrences(deepened, 'series-extend').length > after.length - 1)
})

test('session recurrence metadata is validated', () => {
  const today = localDateKey()
  let fields = sessionWithTasks(today)
  fields = changeWorkspaceSessionRecurrence(fields, 'session-recur', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-valid',
  })
  const invalid = structuredClone(fields)
  const event = events(invalid).find((candidate) => candidate.recurrenceSeriesId === 'series-valid')!
  event.recurrence = { ...(event.recurrence as Data), preset: 'sometimes' }
  assert.throws(() => validateDocument(normalize(invalid)), /Invalid recurrence preset/)
  const indexed = structuredClone(fields)
  const indexedEvent = events(indexed).find((candidate) => candidate.recurrenceSeriesId === 'series-valid')!
  indexedEvent.recurrenceIndex = -1
  assert.throws(() => validateDocument(normalize(indexed)), /Invalid session recurrence index/)
})

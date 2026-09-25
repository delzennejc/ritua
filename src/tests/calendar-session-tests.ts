import assert from 'node:assert/strict'
import { calendarCompletionTasks, unlinkTaskFromSessions } from '../domain/calendar-sessions'
import {
  addSessionTask,
  createCalendarSession,
  updateCalendarSession,
  linkSessionTask,
  moveSessionTask,
} from './view-command-adapters'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, validateDocument, type Data } from '../domain/workspace'
import { toggleWorkspaceTaskCompletion } from './view-command-adapters'
import { detachInactiveReferences, restoreInactiveReferences } from './view-command-adapters'
import { localDateKey, rollWorkspaceDate, addDays } from '../domain/live-calendar'
import { mergeWorkspace } from '../domain/workspace-recovery'

export function testCalendarSessions() {
  const today = localDateKey()
  const initial = project(emptyWorkspace(today))
  initial.tasks = [{ id: 'linked', title: 'Existing task', complete: false, minutes: 30, channel: 'Work' }]
  initial.weeklyObjectives = [
    {
      id: 'project',
      title: 'Project',
      tasks: [{ id: 'mirror', taskId: 'linked', title: 'Existing task', complete: false }],
    },
  ]
  let fields = createCalendarSession(initial, {
    id: 'session',
    title: ' Focus ',
    dateKey: today,
    start: 540,
    end: 720,
  })
  const block = () => (fields.events as Data[])[0]!
  assert.equal(block().end, 720, 'A new session preserves the explicitly selected end')
  assert.equal(block().title, 'Focus')
  assert.equal(block().channel, undefined, 'Sessions have no Area')
  assert.equal(
    normalize(fields).entities.filter((entity) => entity.kind === 'task').length,
    1,
    'Creating a session must not create a task',
  )
  const shortSession = updateCalendarSession(fields, 'session', { start: 1435, end: 1440 })
  assert.equal(
    (shortSession.events as Data[])[0]!.start,
    1435,
    'Sessions support the final five-minute calendar slot',
  )
  assert.equal((shortSession.events as Data[])[0]!.end, 1440)
  const originalTasks = structuredClone(fields.tasks)
  fields = linkSessionTask(fields, 'session', 'linked')
  assert.deepEqual(fields.tasks, originalTasks, 'Dragging a task into a session retains its lane and Area')
  assert.equal(linkSessionTask(fields, 'session', 'linked'), fields, 'Repeated drops do not duplicate tasks')
  assert.equal(linkSessionTask(fields, 'session', 'missing'), fields, 'Non-task drops do not link')
  const beforeCompletion = structuredClone(block())
  fields = toggleWorkspaceTaskCompletion(fields, 'linked', new Date(`${today}T10:00:00`))
  const completedTasks = normalize(fields)
    .entities.filter((entity) => entity.kind === 'task')
    .map((entity) => entity.data.content as Data)
  assert.equal(
    calendarCompletionTasks([], completedTasks, today).length,
    1,
    'Completion appears even when the task is outside this day list',
  )
  assert.equal(
    calendarCompletionTasks(completedTasks, completedTasks, today).length,
    1,
    'Completion markers do not duplicate session tasks',
  )
  assert.equal(
    calendarCompletionTasks([], completedTasks, addDays(today, 1)).length,
    0,
    'Completion does not follow a session to another day',
  )
  const reopened = toggleWorkspaceTaskCompletion(fields, 'linked')
  assert.equal(
    calendarCompletionTasks(
      [],
      normalize(reopened)
        .entities.filter((entity) => entity.kind === 'task')
        .map((entity) => entity.data.content as Data),
      today,
    ).length,
    0,
    'Reopening removes its completion marker',
  )
  assert.deepEqual(block(), beforeCompletion, 'Completion never shrinks or fills a session')
  assert.equal(
    ((fields.weeklyObjectives as Data[])[0]!.tasks as Data[])[0]!.complete,
    true,
    'Completion updates the canonical project task',
  )
  fields = addSessionTask(fields, 'session', { id: 'new', title: 'New work' })
  assert.equal((fields.tasks as Data[])[0]!.id, 'new', 'Active session tasks precede completed tasks')
  assert.deepEqual(block().taskIds, ['new', 'linked'])
  assert.equal(normalize(fields).entities.filter((entity) => entity.kind === 'task').length, 2)
  const tasksBeforeMove = structuredClone(fields.tasks)
  let reordered = moveSessionTask(fields, 'session', 'new', 'session', 'linked')
  assert.deepEqual((reordered.events as Data[])[0]!.taskIds, ['new', 'linked'])
  reordered = moveSessionTask(reordered, 'session', 'new', null)
  assert.deepEqual((reordered.events as Data[])[0]!.taskIds, ['linked'])
  assert.deepEqual(reordered.tasks, tasksBeforeMove, 'Dragging out removes only membership')
  let transferred = createCalendarSession(fields, {
    id: 'second-session',
    title: 'Later',
    dateKey: today,
    start: 800,
    end: 980,
  })
  transferred = moveSessionTask(transferred, 'session', 'new', 'second-session')
  assert.deepEqual((transferred.events as Data[])[0]!.taskIds, ['linked'])
  assert.deepEqual((transferred.events as Data[])[1]!.taskIds, ['new'])
  assert.deepEqual(
    transferred.tasks,
    tasksBeforeMove,
    'Transferring across sessions preserves canonical tasks',
  )
  const shared = normalize(linkSessionTask(transferred, 'session', 'new'))
  const unlinked = unlinkTaskFromSessions(shared, 'new')
  assert.deepEqual(
    unlinked.entities.filter((entity) => entity.kind === 'task'),
    shared.entities.filter((entity) => entity.kind === 'task'),
    'Removing session scheduling preserves every canonical task',
  )
  assert.deepEqual(
    (project(unlinked).events as Data[]).map((event) => event.taskIds),
    [['linked'], []],
    'Unscheduling removes only this task from all its sessions',
  )
  assert.equal(unlinkTaskFromSessions(unlinked, 'new'), unlinked, 'Repeated removal is a no-op')
  fields = updateCalendarSession(fields, 'session', {
    start: 600,
    end: 840,
    dateKey: addDays(today, 1),
    taskIds: ['new', 'linked'],
  })
  assert.deepEqual(
    (fields.datedTasksByDate as Record<string, Data[]>)[addDays(today, 1)],
    tasksBeforeMove,
    'Moving a session carries its tasks in session order without changing their content',
  )
  assert.deepEqual(fields.tasks, [])
  fields = updateCalendarSession(fields, 'session', { color: 'green' })
  assert.equal(block().color, 'green', 'A session accepts a background color')
  assert.equal(block().title, 'Focus', 'Changing a session color keeps its other content')
  const defaultColor = updateCalendarSession(fields, 'session', { color: null })
  assert.equal(
    (defaultColor.events as Data[])[0]!.color,
    undefined,
    'The default background removes the stored session color',
  )
  const coloredRoundTrip = project(normalize(fields))
  assert.equal(
    (coloredRoundTrip.events as Data[])[0]!.color,
    'green',
    'Session colors survive canonical projection',
  )
  fields = addSessionTask(fields, 'session', { id: 'future', title: 'Tomorrow work' })
  assert.ok(
    normalize(fields).entities.some(
      (entity) => entity.id === 'future' && entity.data.lane === `date:${addDays(today, 1)}`,
    ),
  )
  assert.deepEqual(project(normalize(fields)), fields, 'Canonical projections round-trip session references')
  const removed = detachInactiveReferences(fields, ['linked'])
  const deleted = {
    ...removed.fields,
    tasks: (removed.fields.tasks as Data[]).filter((task) => task.id !== 'linked'),
    datedTasksByDate: Object.fromEntries(
      Object.entries(removed.fields.datedTasksByDate as Record<string, Data[]>).map(([date, tasks]) => [
        date,
        tasks.filter((task) => task.id !== 'linked'),
      ]),
    ),
    weeklyObjectives: [],
  }
  validateDocument(normalize(deleted))
  const restored = restoreInactiveReferences(
    {
      ...deleted,
      tasks: fields.tasks,
      datedTasksByDate: fields.datedTasksByDate,
      weeklyObjectives: fields.weeklyObjectives,
    },
    removed.removed,
  )
  assert.deepEqual(
    (restored.events as Data[])[0]!.taskIds,
    block().taskIds,
    'Task deletion Undo restores session membership and order',
  )
  const rolled = project(rollWorkspaceDate(normalize(fields), addDays(today, 1)))
  assert.deepEqual(rolled.events, fields.events, 'Day rollover preserves sessions')
  for (const patch of [
    { title: ' ' },
    { end: 601 },
    { dateKey: '2026-02-30' },
    { taskIds: ['missing'] },
    { taskIds: ['linked', 'linked'] },
    { color: '' },
  ]) {
    assert.throws(() => updateCalendarSession(fields, 'session', patch))
  }
  const base = normalize(fields)
  const local = normalize(updateCalendarSession(fields, 'session', { title: 'Local title' }))
  const remote = normalize(updateCalendarSession(fields, 'session', { end: 900 }))
  assert.equal(mergeWorkspace(base, local, remote).conflicts, 0, 'Independent session edits recover cleanly')
  return fields
}

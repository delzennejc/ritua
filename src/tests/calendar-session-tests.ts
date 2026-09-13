import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addSessionTask, createCalendarSession, updateCalendarSession, linkSessionTask, calendarCompletionTasks, moveSessionTask } from '../domain/calendar-sessions'
import { emptyWorkspace } from '../domain/production-workspace'
import { changes, normalize, project, validateDocument, type Data } from '../domain/workspace'
import { toggleWorkspaceTaskCompletion } from '../domain/task-completion'
import { detachInactiveReferences, restoreInactiveReferences } from '../domain/workspace-organization'
import { localDateKey, rollWorkspaceDate, addDays } from '../domain/live-calendar'
import { openDatabase } from '../main/db/database'
import { mergeWorkspace } from '../domain/workspace-recovery'

export function testCalendarSessions() {
  const today = localDateKey()
  const initial = project(emptyWorkspace(today))
  initial.tasks = [{ id: 'linked', title: 'Existing task', complete: false, minutes: 30, channel: 'Work' }]
  initial.weeklyObjectives = [{ id: 'project', title: 'Project', tasks: [{ id: 'mirror', taskId: 'linked', title: 'Existing task', complete: false }] }]
  let fields = createCalendarSession(initial, { id: 'session', title: ' Focus ', dateKey: today, start: 540 })
  const block = () => (fields.events as Data[])[0]!
  assert.equal(block().end, 720, 'A new session defaults to three hours')
  assert.equal(block().title, 'Focus')
  assert.equal(block().channel, undefined, 'Sessions have no Area')
  assert.equal(normalize(fields).entities.filter(entity => entity.kind === 'task').length, 1, 'Creating a session must not create a task')
  const originalTasks = structuredClone(fields.tasks)
  fields = linkSessionTask(fields, 'session', 'linked')
  assert.deepEqual(fields.tasks, originalTasks, 'Dragging a task into a session retains its lane and Area')
  assert.equal(linkSessionTask(fields, 'session', 'linked'), fields, 'Repeated drops do not duplicate tasks')
  assert.equal(linkSessionTask(fields, 'session', 'missing'), fields, 'Non-task drops do not link')
  const beforeCompletion = structuredClone(block())
  fields = toggleWorkspaceTaskCompletion(fields, 'linked', new Date(`${today}T10:00:00`))
  const completedTasks = normalize(fields).entities.filter(entity => entity.kind === 'task').map(entity => entity.data.content as Data)
  assert.equal(calendarCompletionTasks([], completedTasks, today).length, 1, 'Completion appears even when the task is outside this day list')
  assert.equal(calendarCompletionTasks(completedTasks, completedTasks, today).length, 1, 'Completion markers do not duplicate session tasks')
  assert.equal(calendarCompletionTasks([], completedTasks, addDays(today, 1)).length, 0, 'Completion does not follow a session to another day')
  const reopened = toggleWorkspaceTaskCompletion(fields, 'linked')
  assert.equal(calendarCompletionTasks([], normalize(reopened).entities.filter(entity => entity.kind === 'task').map(entity => entity.data.content as Data), today).length, 0, 'Reopening removes its completion marker')
  assert.deepEqual(block(), beforeCompletion, 'Completion never shrinks or fills a session')
  assert.equal(((fields.weeklyObjectives as Data[])[0]!.tasks as Data[])[0]!.complete, true, 'Completion updates the canonical project task')
  fields = addSessionTask(fields, 'session', { id: 'new', title: 'New work' })
  assert.equal((fields.tasks as Data[])[0]!.id, 'new', 'New tasks appear before completed work')
  assert.deepEqual(block().taskIds, ['linked', 'new'])
  assert.equal(normalize(fields).entities.filter(entity => entity.kind === 'task').length, 2)
  const tasksBeforeMove = structuredClone(fields.tasks)
  let reordered = moveSessionTask(fields, 'session', 'new', 'session', 'linked')
  assert.deepEqual((reordered.events as Data[])[0]!.taskIds, ['new', 'linked'])
  reordered = moveSessionTask(reordered, 'session', 'new', null)
  assert.deepEqual((reordered.events as Data[])[0]!.taskIds, ['linked'])
  assert.deepEqual(reordered.tasks, tasksBeforeMove, 'Dragging out removes only membership')
  let transferred = createCalendarSession(fields, { id: 'second-session', title: 'Later', dateKey: today, start: 800 })
  transferred = moveSessionTask(transferred, 'session', 'new', 'second-session')
  assert.deepEqual((transferred.events as Data[])[0]!.taskIds, ['linked'])
  assert.deepEqual((transferred.events as Data[])[1]!.taskIds, ['new'])
  assert.deepEqual(transferred.tasks, tasksBeforeMove, 'Transferring across sessions preserves canonical tasks')
  fields = updateCalendarSession(fields, 'session', { start: 600, end: 840, dateKey: addDays(today, 1), taskIds: ['new', 'linked'] })
  assert.deepEqual(fields.tasks, tasksBeforeMove, 'Moving/resizing a session must not change task durations or locations')
  fields = addSessionTask(fields, 'session', { id: 'future', title: 'Tomorrow work' })
  assert.ok(normalize(fields).entities.some(entity => entity.id === 'future' && entity.data.lane === `date:${addDays(today, 1)}`))
  assert.deepEqual(project(normalize(fields)), fields, 'Canonical projections round-trip session references')
  const removed = detachInactiveReferences(fields, ['linked'])
  const deleted = { ...removed.fields, tasks: (removed.fields.tasks as Data[]).filter(task => task.id !== 'linked'), weeklyObjectives: [] }
  validateDocument(normalize(deleted))
  const restored = restoreInactiveReferences({ ...deleted, tasks: fields.tasks, weeklyObjectives: fields.weeklyObjectives }, removed.removed)
  assert.deepEqual((restored.events as Data[])[0]!.taskIds, block().taskIds, 'Task deletion Undo restores session membership and order')
  const rolled = project(rollWorkspaceDate(normalize(fields), addDays(today, 1)))
  assert.deepEqual(rolled.events, fields.events, 'Day rollover preserves sessions')
  for (const patch of [{ title: ' ' }, { end: 601 }, { dateKey: '2026-02-30' }, { taskIds: ['missing'] }, { taskIds: ['linked', 'linked'] }]) {
    assert.throws(() => updateCalendarSession(fields, 'session', patch))
  }
  const base = normalize(fields)
  const local = normalize(updateCalendarSession(fields, 'session', { title: 'Local title' }))
  const remote = normalize(updateCalendarSession(fields, 'session', { end: 900 }))
  assert.equal(mergeWorkspace(base, local, remote).conflicts, 0, 'Independent session edits recover cleanly')
  const directory = mkdtempSync(join(tmpdir(), 'ritua-sessions-'))
  try {
    const path = join(directory, 'workspace.sqlite')
    const db = openDatabase(path)
    const before = db.loadWorkspace()
    db.commitWorkspace(changes(before, normalize(fields), 'session-write'))
    const current = db.loadWorkspace()
    const invalid = structuredClone(current)
    ;(invalid.entities.find(entity => entity.id === 'session')!.data.content as Data).taskIds = ['missing']
    assert.throws(() => db.commitWorkspace(changes(current, invalid, 'session-invalid')), 'IPC commit rejects dangling references atomically')
    assert.equal(db.loadWorkspace().revision, current.revision)
    db.close()
    const reopened = openDatabase(path)
    assert.deepEqual(project(reopened.loadWorkspace()).events, fields.events, 'Session schedule and membership survive native database restart')
    reopened.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

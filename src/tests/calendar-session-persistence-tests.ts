import { testTaskCalendarBlocks } from './task-calendar-tests'
import { testOvernightCalendar } from './overnight-calendar-tests'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../main/db/database'
import { changes, normalize, project, type Data } from '../domain/workspace'
import { testCalendarSessions } from './calendar-session-tests'
import { testSessionRecurrence } from './session-recurrence-tests'
export function testCalendarSessionsPersistence() {
  const fields = testCalendarSessions()
  const directory = mkdtempSync(join(tmpdir(), 'ritua-sessions-'))
  try {
    const path = join(directory, 'workspace.sqlite')
    const db = openDatabase(path)
    const before = db.loadWorkspace()
    db.commitWorkspace(changes(before, normalize(fields), 'session-write'))
    const current = db.loadWorkspace()
    const invalid = structuredClone(current)
    ;(invalid.entities.find((entity) => entity.id === 'session')!.data.content as Data).taskIds = ['missing']
    assert.throws(
      () => db.commitWorkspace(changes(current, invalid, 'session-invalid')),
      'IPC commit rejects dangling references atomically',
    )
    assert.equal(db.loadWorkspace().revision, current.revision)
    db.close()
    const reopened = openDatabase(path)
    assert.deepEqual(
      project(reopened.loadWorkspace()).events,
      fields.events,
      'Session schedule and membership survive native database restart',
    )
    const split = testTaskCalendarBlocks()
    reopened.commitWorkspace(changes(reopened.loadWorkspace(), split, 'split-work-write'))
    reopened.close()
    const splitRestart = openDatabase(path)
    assert.deepEqual(
      project(splitRestart.loadWorkspace()).events,
      project(split).events,
      'Multiple task blocks survive SQLite restart',
    )
    assert.deepEqual(
      splitRestart
        .loadWorkspace()
        .entities.find((entity) => entity.kind === 'task' && entity.id === 'split-work')?.data.content,
      split.entities.find((entity) => entity.kind === 'task' && entity.id === 'split-work')?.data.content,
      'Combined duration and completion survive SQLite restart',
    )
    const overnight = testOvernightCalendar()
    splitRestart.commitWorkspace(changes(splitRestart.loadWorkspace(), overnight, 'overnight-write'))
    splitRestart.close()
    const overnightRestart = openDatabase(path)
    assert.deepEqual(
      project(overnightRestart.loadWorkspace()).events,
      project(overnight).events,
      'Overnight block survives SQLite restart',
    )
    const recurring = testSessionRecurrence()
    overnightRestart.commitWorkspace(
      changes(overnightRestart.loadWorkspace(), normalize(recurring), 'session-recurrence-write'),
    )
    overnightRestart.close()
    const recurrenceRestart = openDatabase(path)
    const persisted = project(recurrenceRestart.loadWorkspace())
    assert.deepEqual(
      persisted.sessionRecurrenceDefinitions,
      recurring.sessionRecurrenceDefinitions,
      'Session repeat definitions survive native database restart',
    )
    assert.deepEqual(
      persisted.sessionRecurrenceProgress,
      recurring.sessionRecurrenceProgress,
      'Session repeat progress survives native database restart',
    )
    assert.deepEqual(
      persisted.events,
      recurring.events,
      'Recurring session occurrences survive native database restart',
    )
    recurrenceRestart.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

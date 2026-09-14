import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../main/db/database'
import { changes, normalize, project, type Data } from '../domain/workspace'
import { testCalendarSessions } from './calendar-session-tests'
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
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

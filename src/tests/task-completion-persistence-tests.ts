import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../main/db/database'
import { changes, normalize, project, type Data } from '../domain/workspace'
import { testTaskCompletion, fixture, completeAt, block } from './task-completion-tests'
export function testTaskCompletionPersistence() {
  testTaskCompletion()
  const directory = mkdtempSync(join(tmpdir(), 'ritua-completion-'))
  try {
    const path = join(directory, 'workspace.sqlite')
    const db = openDatabase(path)
    const initial = db.loadWorkspace()
    db.commitWorkspace(changes(initial, normalize(fixture()), 'completion-fixture'))
    const before = db.loadWorkspace()
    const after = normalize(completeAt(project(before), 690), before.revision)
    db.commitWorkspace(changes(before, after, 'completion'))
    db.close()
    const reopened = openDatabase(path)
    const persistedDocument = reopened.loadWorkspace()
    const persisted = project(persistedDocument)
    const persistedTask = persistedDocument.entities.find(
      (entity) => entity.kind === 'task' && entity.id === 'first',
    )!.data.content as Data
    assert.equal(
      persistedTask.complete,
      true,
      'Completion persists even when startup rolls the fixture into a past day',
    )
    assert.equal(persistedTask.actualMinutes, 90, 'Recorded calendar time survives a database restart')
    assert.equal(block(persisted, 'first').end, 690)
    assert.equal(block(persisted, 'next').start, 690, 'Completion and following tasks persist together')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

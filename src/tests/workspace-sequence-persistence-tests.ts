import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../main/db/database'
import { changes, project } from '../domain/workspace'
import { exerciseWorkspaceSequence } from './workspace-sequences'

export function testWorkspaceSequencePersistence() {
  const directory = mkdtempSync(join(tmpdir(), 'ritua-sequences-'))
  let step = 0
  try {
    exerciseWorkspaceSequence((document) => {
      const path = join(directory, 'workspace.sqlite')
      const db = openDatabase(path)
      try {
        db.commitWorkspace(changes(db.loadWorkspace(), document, `sequence-${step++}`))
      } finally {
        db.close()
      }
      const reopened = openDatabase(path)
      try {
        const saved = reopened.loadWorkspace()
        assert.deepEqual(
          project(saved),
          project(document),
          'Every command survives an actual database restart',
        )
        return saved
      } finally {
        reopened.close()
      }
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

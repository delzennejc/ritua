import assert from 'node:assert/strict'
import { localDateKey } from '../domain/live-calendar'
import { emptyWorkspace } from '../domain/production-workspace'
import { recurrenceForPreset } from '../domain/recurrence'
import { normalize, project, validateDocument, type Data, type Fields } from '../domain/workspace'
import {
  addSessionTask,
  changeWorkspaceSessionRecurrence,
  createCalendarSession,
} from './view-command-adapters'

/** Plain-function scenario shared by the pure suite and the SQLite restart test. */
export function testSessionRecurrence(): Fields {
  const today = localDateKey()
  let fields = project(emptyWorkspace(today))
  fields = createCalendarSession(fields, {
    id: 'session-persist',
    title: 'Persisted repeat',
    dateKey: today,
    start: 600,
    end: 720,
  })
  fields = addSessionTask(fields, 'session-persist', { id: 'persist-write', title: 'Write' })
  fields = changeWorkspaceSessionRecurrence(fields, 'session-persist', recurrenceForPreset('weekly', today), {
    today,
    seriesId: 'series-persist',
  })
  const occurrences = (fields.events as Data[]).filter(
    (event) => event.recurrenceSeriesId === 'series-persist',
  )
  assert.equal(occurrences.length, 53)
  assert.deepEqual(occurrences[0]!.taskIds, ['persist-write'])
  assert.ok(
    (fields.sessionRecurrenceDefinitions as Data)['series-persist'],
    'A recurring session stores its repeat definition',
  )
  validateDocument(normalize(fields))
  return fields
}

import assert from 'node:assert/strict'
import { localDateKey } from '../domain/live-calendar'
import { emptyWorkspace } from '../domain/production-workspace'
import { recurrenceForPreset } from '../domain/recurrence'
import { normalize, project, validateDocument, type Data, type Fields } from '../domain/workspace'
import {
  addSessionTask,
  changeWorkspaceSessionRecurrence,
  createCalendarSession,
  updateCalendarSession,
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
  fields = updateCalendarSession(fields, 'session-persist', { notes: 'Agenda\n- [ ] Outline' })
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
    occurrences.every((event) => event.notes === 'Agenda\n- [ ] Outline'),
    'Repeated occurrences inherit the session notes',
  )
  assert.equal(
    (((fields.sessionRecurrenceDefinitions as Data)['series-persist'] as Data).session as Data).notes,
    'Agenda\n- [ ] Outline',
    'The repeat definition keeps the session notes for future occurrences',
  )
  validateDocument(normalize(fields))
  return fields
}

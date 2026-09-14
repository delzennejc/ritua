import { editWorkspaceTask } from './view-command-adapters'
import type { Fields } from '../domain/workspace-types'
import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from './view-command-adapters'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, validateDocument, type Data } from '../domain/workspace'

function fixture(): Fields {
  const fields = project(emptyWorkspace('2026-09-13'))
  fields.tasks = [
    { id: 'before', title: 'Before' },
    { id: 'task', title: 'Remove', recurrenceSeriesId: 'series', recurrenceIndex: 1 },
    { id: 'after', title: 'After' },
  ]
  fields.datedTasksByDate = {
    '2026-09-14': [{ id: 'future', title: 'Future', recurrenceSeriesId: 'series', recurrenceIndex: 2 }],
  }
  for (const collection of ['weeklyObjectives', 'archivedObjectives', 'weekly.accomplishedObjectives'])
    fields[collection] = [
      { id: collection, title: collection, tasks: [{ id: 'link', taskId: 'task', title: 'Remove' }] },
    ]
  fields.events = [
    { id: 'task', title: 'Remove', start: 600, end: 630 },
    {
      id: 'session',
      kind: 'session',
      title: 'Session',
      start: 600,
      end: 780,
      dateKey: '2026-09-13',
      taskIds: ['before', 'task', 'after'],
    },
  ]
  return fields
}
const ids = (fields: Fields) => (fields.tasks as Data[]).map((task) => task.id)

test('deletion removes canonical work and all references, and Undo retains later edits', () => {
  const fields = fixture(),
    before = structuredClone(fields)
  const result = deleteWorkspaceTask(fields, 'task')
  assert.deepEqual(fields, before)
  validateDocument(normalize(result.fields))
  assert.deepEqual(ids(result.fields), ['before', 'after'])
  const edited = structuredClone(result.fields)
  ;(edited.tasks as Data[])[0]!.title = 'Edited after deletion'
  ;(edited.tasks as Data[]).push({ id: 'new', title: 'New work' })
  const restored = undoWorkspaceTaskDeletion(edited, result.undo)
  assert.deepEqual(ids(restored), ['before', 'task', 'after', 'new'])
  assert.equal((restored.tasks as Data[])[0]!.title, 'Edited after deletion')
  assert.deepEqual((restored.events as Data[]).find((event) => event.id === 'session')!.taskIds, [
    'before',
    'task',
    'after',
  ])
  for (const collection of ['weeklyObjectives', 'archivedObjectives', 'weekly.accomplishedObjectives'])
    assert.equal(((restored[collection] as Data[])[0]!.tasks as Data[])[0]!.taskId, 'task')
  validateDocument(normalize(restored))
  assert.deepEqual(
    undoWorkspaceTaskDeletion(restored, result.undo),
    restored,
    'Repeated Undo cannot duplicate work',
  )
})

test('following deletion stops the series and Undo restores its prior stop state', () => {
  const fields = fixture()
  const result = deleteWorkspaceTask(fields, 'task', 'following')
  assert.deepEqual(result.deletedIds, ['task', 'future'])
  assert.equal((result.fields.recurrenceStops as Data).series, true)
  const restored = undoWorkspaceTaskDeletion(result.fields, result.undo)
  assert.equal((restored.recurrenceStops as Data).series, undefined)
  assert.equal(((restored.datedTasksByDate as Data)['2026-09-14'] as Data[])[0]!.id, 'future')
  validateDocument(normalize(restored))
})

test('Undo does not recreate a project or session removed after task deletion', () => {
  const result = deleteWorkspaceTask(fixture(), 'task')
  const fields = { ...result.fields, weeklyObjectives: [], events: [] }
  const restored = undoWorkspaceTaskDeletion(fields, result.undo)
  assert.deepEqual(restored.weeklyObjectives, [])
  assert.ok(!(restored.events as Data[]).some((event) => event.kind === 'session'))
  validateDocument(normalize(restored))
})

test('a no-op task edit followed by deletion and Undo preserves reference metadata', () => {
  const fields = fixture()
  const before = normalize(fields)
  const edited = editWorkspaceTask(
    fields,
    'task',
    { title: 'Remove' },
    { actor: 'You', now: new Date('2026-09-14T12:00:00Z') },
  )
  const deleted = deleteWorkspaceTask(edited, 'task')
  const restored = normalize(undoWorkspaceTaskDeletion(deleted.fields, deleted.undo))
  assert.deepEqual(
    restored.entities.filter((entity) => entity.kind === 'project').map((entity) => entity.data.links),
    before.entities.filter((entity) => entity.kind === 'project').map((entity) => entity.data.links),
  )
})

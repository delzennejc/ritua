import test from 'node:test'
import assert from 'node:assert/strict'
import { project, normalize, validateDocument, type Fields, type Data } from '../domain/workspace'
import { emptyWorkspace } from '../domain/production-workspace'
import { renameWorkspaceArea, archiveWorkspaceArea, deleteWorkspaceArea } from './view-command-adapters'
import { removeWorkspaceProject, undoWorkspaceProjectRemoval } from './view-command-adapters'
import { changeWorkspaceRecurrence } from './view-command-adapters'
import { recurrenceForPreset } from '../domain/recurrence'

function fixture(): Fields {
  return {
    ...project(emptyWorkspace('2026-09-14')),
    tasks: [
      { id: 'work', title: 'Work task', channel: 'Work', objectiveId: 'project', minutes: 30 },
      { id: 'personal', title: 'Personal task', channel: 'Personal' },
    ],
    weeklyObjectives: [
      {
        id: 'project',
        title: 'Project',
        channel: 'Work',
        tasks: [{ id: 'member', taskId: 'work', title: 'Work task' }],
      },
    ],
    weeklyObjectiveOrder: ['project'],
    taskScope: 'project:project',
    events: [
      {
        id: 'session',
        kind: 'session',
        title: 'Session',
        dateKey: '2026-09-14',
        start: 600,
        end: 780,
        taskIds: ['work', 'personal'],
      },
    ],
  }
}

test('renaming and deleting an Area update canonical tasks and references together', () => {
  const fields = fixture(),
    before = structuredClone(fields)
  const renamed = renameWorkspaceArea(fields, 'work', 'Studio')
  assert.equal((renamed.tasks as Data[])[0]!.channel, 'Studio')
  assert.equal((renamed.weeklyObjectives as Data[])[0]!.channel, 'Studio')
  assert.throws(() => renameWorkspaceArea(fields, 'work', 'personal'), /already exists/)
  assert.deepEqual(fields, before)
  const removed = deleteWorkspaceArea(renamed, 'work')
  assert.deepEqual(removed.deletedTaskIds, ['work'])
  assert.deepEqual((removed.fields.events as Data[])[0]!.taskIds, ['personal'])
  assert.deepEqual(removed.fields.weeklyObjectives, [])
  assert.equal(removed.fields.taskScope, 'anytime')
  validateDocument(normalize(removed.fields))
})

test('archiving an Area retains its work and records its restoration position', () => {
  const fields = fixture()
  const archived = archiveWorkspaceArea(fields, 'work', new Date('2026-09-14T10:00:00Z'))
  assert.deepEqual(archived.tasks, fields.tasks)
  assert.deepEqual(archived.weeklyObjectives, fields.weeklyObjectives)
  assert.equal((archived.archivedAreas as Data[])[0]!.position, 0)
  assert.equal(archived.taskScope, 'anytime')
})

test('project archive Undo preserves later task edits and reassignment', () => {
  const fields = fixture()
  const result = removeWorkspaceProject(fields, 'project', 'archive', new Date('2026-09-14T10:00:00Z'))!
  assert.equal((result.fields.tasks as Data[])[0]!.objectiveId, undefined)
  const updated = structuredClone(result.fields)
  ;(updated.tasks as Data[])[0]!.title = 'Edited while archived'
  ;(updated.tasks as Data[])[0]!.objectiveId = 'different'
  const restored = undoWorkspaceProjectRemoval(updated, result.undo)
  assert.equal((restored.tasks as Data[])[0]!.title, 'Edited while archived')
  assert.equal((restored.tasks as Data[])[0]!.objectiveId, 'different')
  assert.deepEqual(restored.weeklyObjectiveOrder, ['project'])
  assert.equal(restored.taskScope, 'project:project')
  assert.deepEqual(restored.archivedObjectives, [])
  validateDocument(normalize(restored))
})

test('changing recurrence preserves completed history and edited future exceptions', () => {
  const fields = fixture()
  fields.tasks = [
    {
      id: 'work',
      title: 'Work task',
      channel: 'Work',
      minutes: 30,
      recurrenceSeriesId: 'old',
      recurrenceIndex: 1,
    },
  ]
  fields.datedTasksByDate = {
    '2026-09-13': [
      { id: 'past', title: 'History', complete: true, recurrenceSeriesId: 'old', recurrenceIndex: 0 },
    ],
    '2026-09-15': [
      {
        id: 'exception',
        title: 'Individually edited',
        minutes: 45,
        recurrenceEdited: true,
        recurrenceSeriesId: 'old',
        recurrenceIndex: 2,
      },
    ],
  }
  fields.events = []
  const before = structuredClone(fields)
  const rule = recurrenceForPreset('weekly', '2026-09-14')
  rule.end = { type: 'after', count: 2, date: '' }
  const changed = changeWorkspaceRecurrence(fields, 'work', rule, {
    today: '2026-09-14',
    seriesId: 'new',
    prepareTask: (task) => task,
  })
  assert.deepEqual(fields, before)
  const dates = changed.fields.datedTasksByDate as Record<string, Data[]>
  assert.deepEqual(dates['2026-09-13'], (fields.datedTasksByDate as Data)['2026-09-13'])
  assert.equal(dates['2026-09-15']![0]!.title, 'Individually edited')
  assert.equal(dates['2026-09-15']![0]!.recurrenceSeriesId, undefined)
  assert.equal(dates['2026-09-21']!.length, 1)
  assert.equal((changed.fields.recurrenceStops as Data).old, true)
  validateDocument(normalize(changed.fields))
})

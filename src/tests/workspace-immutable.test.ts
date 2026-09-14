import { noRecurrence } from '../domain/recurrence'
import { changeWorkspaceRecurrence } from '../domain/task-recurrence'
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyWorkspace } from '../domain/production-workspace'
import { executeTaskCommand } from '../domain/task-commands'
import { editWorkspaceTask } from '../domain/task-editing'
import { changeWorkspaceField } from '../domain/workspace-commands'
import { createWorkspaceView } from '../domain/workspace-view'
import { changes } from '../domain/workspace-projection'
import { validateImmutableSnapshot } from '../domain/workspace-validation'
import { editDocument } from '../domain/workspace-immutable'

const context = { today: '2026-09-14', now: new Date('2026-09-14T10:00:00'), actor: 'Test' }
function fixture() {
  const tasks = executeTaskCommand(
    emptyWorkspace(context.today),
    {
      type: 'task.create',
      tasks: [
        { task: { id: 'one', title: 'One', channel: 'Work' }, lane: 'today' },
        { task: { id: 'two', title: 'Two', channel: 'Personal' }, lane: 'date:2026-09-15' },
      ],
    },
    context,
  )
  return changeWorkspaceField(tasks, 'weeklyObjectives', [
    {
      id: 'project',
      title: 'Project',
      channel: 'Work',
      tasks: [{ id: 'reference', taskId: 'one', title: 'One' }],
    },
  ])
}
test('canonical edits share untouched records and derived collections', () => {
  const before = fixture(),
    select = createWorkspaceView(),
    views = select(before)
  const after = editWorkspaceTask(before, 'one', { title: 'Changed', notes: 'A note' }, context),
    next = select(after)
  const unchanged = before.entities.find((e) => e.id === 'two')
  assert.equal(
    after.entities.find((e) => e.id === 'two'),
    unchanged,
  )
  assert.equal(after.fields, before.fields)
  assert.equal(next.datedTasksByDate, views.datedTasksByDate)
  assert.equal(next.areas, views.areas)
  assert.notEqual(next.tasks, views.tasks)
  assert.equal((next.weeklyObjectives as { tasks: { title: string }[] }[])[0]!.tasks[0]!.title, 'Changed')
  assert.equal((views.tasks as { title: string }[])[0]!.title, 'One')
  assert.deepEqual(
    changes(before, after, 'edit').put.map((e) => e.id),
    ['one'],
  )
  assert.equal(editWorkspaceTask(before, 'missing', { title: 'Nothing' }, context), before)
  const preference = changeWorkspaceField(after, 'navigationOpen', false)
  const preferenceView = select(preference)
  assert.equal(preference.entities, after.entities)
  assert.equal(preferenceView.tasks, next.tasks)
})
test('cached entity validation still rejects dangling references after a deletion', () => {
  const before = fixture()
  validateImmutableSnapshot(before)
  const invalid = editDocument(before, (draft) => {
    draft.entities = draft.entities.filter((e) => e.id !== 'one')
  })
  assert.throws(() => validateImmutableSnapshot(invalid), /references missing task/)
  validateImmutableSnapshot(before)
})
test('canonical optional properties are omitted while invalid values remain rejectable', () => {
  const before = fixture()
  const after = editWorkspaceTask(before, 'one', { durationLabel: undefined }, context)
  validateImmutableSnapshot(after)
  assert.ok(
    !Object.hasOwn(after.entities.find((e) => e.id === 'one')!.data.content as object, 'durationLabel'),
  )
  const bad = editWorkspaceTask(before, 'one', { minutes: NaN }, context)
  assert.throws(() => validateImmutableSnapshot(bad), /Invalid number/)
})

test('recurrence copies nested task details out of collection drafts', () => {
  const before = editWorkspaceTask(
    fixture(),
    'one',
    { subtasks: [{ id: 'step', title: 'Nested work', complete: false }], notes: 'Keep this note' },
    context,
  )
  const rule = {
    ...noRecurrence(),
    preset: 'daily' as const,
    frequency: 'day' as const,
    end: { ...noRecurrence().end, type: 'after' as const, count: 3 },
  }
  const result = changeWorkspaceRecurrence(before, 'one', rule, {
    today: context.today,
    seriesId: 'nested-series',
    prepareTask: (task) => ({ ...task }),
  })
  validateImmutableSnapshot(result.document)
  assert.equal(
    result.document.entities.filter(
      (e) =>
        e.kind === 'task' &&
        (e.data.content as { recurrenceSeriesId?: string }).recurrenceSeriesId === 'nested-series',
    ).length,
    3,
  )
  assert.doesNotThrow(() => structuredClone(result.document))
  assert.equal(
    (before.entities.find((e) => e.id === 'one')!.data.content as { notes: string }).notes,
    'Keep this note',
  )
})

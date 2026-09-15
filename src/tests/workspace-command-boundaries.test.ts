import test from 'node:test'
import assert from 'node:assert/strict'
import { executeTaskCommand } from './view-command-adapters'
import { executeTaskDetailCommand } from './view-command-adapters'
import { moveWorkspaceTaskArea, undoWorkspaceTaskArea } from './view-command-adapters'
import { changeWorkspaceField } from './view-command-adapters'
import { editWorkspaceCalendar } from './view-command-adapters'
import { emptyWorkspace } from '../domain/production-workspace'
import { project, normalize, validateDocument, type Data } from '../domain/workspace'
import { workspaceCollections } from '../domain/workspace-collections'
import { selectTask } from '../domain/workspace-selectors'
import { assertWorkspaceInvariants } from './workspace-sequences'
const context = { today: '2026-09-14', now: new Date('2026-09-14T10:00:00'), actor: 'Test' }
function fixture() {
  let fields = changeWorkspaceField(project(emptyWorkspace(context.today)), 'weeklyObjectives', [
    { id: 'project', title: 'Work', channel: 'Work', tasks: [] },
  ])
  fields = executeTaskCommand(
    fields,
    {
      type: 'task.create',
      tasks: ['first', 'second'].map((id) => ({
        task: { id, title: id, channel: 'Work', objectiveId: 'project', minutes: 30, complete: false },
        lane: 'backlog:anytime',
      })),
    },
    context,
  )
  return fields
}
test('project projections cannot overwrite shared task data, while project metadata remains editable', () => {
  const fields = fixture()
  const owners = workspaceCollections(fields).weeklyObjectives
  const result = changeWorkspaceField(
    fields,
    'weeklyObjectives',
    owners.map((owner) => ({
      ...owner,
      title: 'Project title changed',
      tasks: owner.tasks!.map((task) => ({ ...task, title: 'Stale mirror title', minutes: 999 })),
    })),
  )
  assert.equal(workspaceCollections(result).weeklyObjectives[0].title, 'Project title changed')
  assert.equal(selectTask(normalize(result), 'first')!.title, 'first')
  assert.equal(selectTask(normalize(result), 'first')!.minutes, 30)
  assertWorkspaceInvariants(result)
})
test('completing undated work orders project references after remaining work', () => {
  const result = executeTaskCommand(fixture(), { type: 'task.complete-undated', taskId: 'first' }, context)
  assert.deepEqual(
    workspaceCollections(result).weeklyObjectives[0].tasks!.map((t) => t.taskId),
    ['second', 'first'],
  )
  assert.equal(selectTask(normalize(result), 'first')!.completedDateKey, context.today)
})
test('bulk project assignment preserves task locations and calendar data and updates every projection', () => {
  let fields = changeWorkspaceField(fixture(), 'weeklyObjectives', [
    ...workspaceCollections(fixture()).weeklyObjectives,
    { id: 'destination', title: 'Destination', channel: 'Work', tasks: [] },
  ])
  fields = executeTaskCommand(
    fields,
    {
      type: 'task.schedule',
      taskId: 'second',
      dateKey: context.today,
      start: 480,
      end: 525,
    },
    context,
  )
  const before = structuredClone(fields)
  const result = executeTaskCommand(
    fields,
    {
      type: 'task.assign-many',
      taskIds: ['first', 'second', 'first'],
      projectId: 'destination',
    },
    context,
  )
  assert.deepEqual(fields, before)
  assert.deepEqual(result.events, before.events)
  for (const id of ['first', 'second']) {
    const prior = selectTask(normalize(before), id)!
    assert.deepEqual(selectTask(normalize(result), id), { ...prior, objectiveId: 'destination' })
    assert.equal(
      normalize(result).entities.find((e) => e.kind === 'task' && e.id === id)!.data.lane,
      normalize(before).entities.find((e) => e.kind === 'task' && e.id === id)!.data.lane,
    )
  }
  const projects = workspaceCollections(result).weeklyObjectives
  assert.deepEqual(projects[0].tasks, [])
  assert.deepEqual(
    projects[1].tasks!.map((task) => task.taskId),
    ['first', 'second'],
  )
  assertWorkspaceInvariants(result)
})

test('bulk project assignment rejects invalid selections atomically', () => {
  let fields = changeWorkspaceField(fixture(), 'weeklyObjectives', [
    ...workspaceCollections(fixture()).weeklyObjectives,
    { id: 'destination', title: 'Destination', channel: 'Work', tasks: [] },
    { id: 'completed', title: 'Completed', channel: 'Work', complete: true, tasks: [] },
  ])
  fields = executeTaskCommand(
    fields,
    {
      type: 'task.assign',
      taskId: 'second',
      projectId: null,
      channel: 'Personal',
    },
    context,
  )
  const before = structuredClone(fields)
  for (const [taskIds, projectId] of [
    [['first', 'second'], 'destination'],
    [['first', 'missing'], 'destination'],
    [['first'], 'completed'],
    [['first'], 'missing'],
  ] as [string[], string][]) {
    assert.throws(() => executeTaskCommand(fields, { type: 'task.assign-many', taskIds, projectId }, context))
    assert.deepEqual(fields, before)
  }
})
test('calendar resize, cross-date move and removal update the canonical task', () => {
  let fields = executeTaskCommand(
    fixture(),
    { type: 'task.schedule', taskId: 'first', dateKey: context.today, start: 480, end: 510 },
    context,
  )
  fields = editWorkspaceCalendar(
    fields,
    workspaceCollections(fields).events.map((event) => ({ ...event, dateKey: '2026-09-15', end: 540 })),
  )
  assertWorkspaceInvariants(fields)
  assert.equal(selectTask(normalize(fields), 'first')!.minutes, 60)
  fields = editWorkspaceCalendar(fields, [])
  assert.equal(selectTask(normalize(fields), 'first')!.time, null)
})
test('Area move Undo preserves subsequent detail edits and respects later ownership changes', () => {
  const before = fixture()
  const moved = moveWorkspaceTaskArea(before, 'first', 'Personal', 'green', true, context)!
  let fields = executeTaskDetailCommand(
    moved.fields,
    { type: 'comment.add', taskId: 'first', text: 'Keep this comment' },
    context,
  )
  fields = undoWorkspaceTaskArea(fields, moved.undo, 'violet', context)
  assertWorkspaceInvariants(fields)
  assert.equal(selectTask(normalize(fields), 'first')!.comments!.length, 1)
  assert.equal(selectTask(normalize(fields), 'first')!.objectiveId, 'project')
  const again = moveWorkspaceTaskArea(fields, 'first', 'Personal', 'green', true, context)!
  const subsequentlyMoved = executeTaskCommand(
    again.fields,
    { type: 'task.assign', taskId: 'first', projectId: null, channel: 'Work' },
    context,
  )
  assert.deepEqual(undoWorkspaceTaskArea(subsequentlyMoved, again.undo, 'violet', context), subsequentlyMoved)
})
test('task detail commands preserve identity and reject malformed nested data at the boundary', () => {
  let fields = executeTaskDetailCommand(
    fixture(),
    { type: 'subtask.add', taskId: 'first', subtask: { id: 'step', title: 'Step', complete: false } },
    context,
  )
  fields = executeTaskDetailCommand(
    fields,
    { type: 'subtask.toggle', taskId: 'first', subtaskId: 'step' },
    context,
  )
  assert.equal(selectTask(normalize(fields), 'first')!.subtasks![0].complete, true)
  const invalid = normalize(fields)
  const task = invalid.entities.find((e) => e.kind === 'task' && e.id === 'first')!
  ;(task.data.content as Data).activity = [{ id: 'bad', label: 42 }]
  assert.throws(() => validateDocument(invalid), /activity text/)
})

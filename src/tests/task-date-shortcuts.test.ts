import assert from 'node:assert/strict'
import test from 'node:test'
import { taskDateShortcuts } from '../domain/task-date-shortcuts'
import { emptyWorkspace } from '../domain/production-workspace'
import { executeTaskCommand } from '../domain/task-commands'
import { moveScheduledTask, promoteWorkspaceTask } from '../domain/task-scheduling'
import { project } from '../domain/workspace-projection'
import { workspaceCollections } from '../domain/workspace-collections'

test('date shortcuts offer tomorrow and the remaining weekdays without duplicating tomorrow', () => {
  assert.deepEqual(taskDateShortcuts('2026-09-14'), [
    { id: 'tomorrow', label: 'Tomorrow', dateKey: '2026-09-15' },
    { id: '2026-09-16', label: 'Wednesday', dateKey: '2026-09-16' },
    { id: '2026-09-17', label: 'Thursday', dateKey: '2026-09-17' },
    { id: '2026-09-18', label: 'Friday', dateKey: '2026-09-18' },
    { id: 'next-week', label: 'Next Week', dateKey: '2026-09-21' },
    { id: 'next-month', label: 'Next Month', dateKey: '2026-10-01' },
  ])
  for (const today of ['2026-09-18', '2026-09-19', '2026-09-20']) {
    assert.deepEqual(
      taskDateShortcuts(today).map((choice) => choice.label),
      ['Tomorrow', 'Next Week', 'Next Month'],
    )
  }
  assert.equal(taskDateShortcuts('2026-09-18')[0]!.dateKey, '2026-09-19')
})

test('shortcuts cross year, leap-day and weekend month boundaries using calendar dates', () => {
  assert.deepEqual(
    taskDateShortcuts('2026-12-31').map((choice) => choice.dateKey),
    ['2027-01-01', '2027-01-04', '2027-01-01'],
  )
  assert.equal(taskDateShortcuts('2028-02-28')[0]!.dateKey, '2028-02-29')
  assert.equal(taskDateShortcuts('2026-10-30').at(-1)!.dateKey, '2026-11-02')
  assert.equal(taskDateShortcuts('2026-07-31').at(-1)!.dateKey, '2026-08-03')
})

test('date moves promote undated tasks and preserve timed blocks when moving board tasks', () => {
  const today = '2026-09-14'
  const context = { today, now: new Date(`${today}T10:00:00`), actor: 'Test' }
  const initial = executeTaskCommand(
    emptyWorkspace(today),
    {
      type: 'task.create',
      tasks: [
        { task: { id: 'task', title: 'Move me', channel: 'Work', minutes: 45 }, lane: 'backlog:anytime' },
      ],
    },
    context,
  )
  const dateKey = taskDateShortcuts(today)[0]!.dateKey
  let document = promoteWorkspaceTask(initial, { taskId: 'task', dateKey, accent: 'violet' }, context)
  let fields = workspaceCollections(project(document))
  assert.equal(fields.backlogGroups.flatMap((group) => group.items).length, 0)
  assert.equal(fields.datedTasksByDate[dateKey]![0]!.id, 'task')
  assert.equal(fields.events.length, 0)
  document = executeTaskCommand(
    document,
    {
      type: 'task.schedule',
      taskId: 'task',
      dateKey,
      start: 600,
      end: 645,
    },
    context,
  )
  const targetDateKey = '2026-09-21'
  document = moveScheduledTask(
    document,
    { taskId: 'task', sourceDateKey: dateKey, targetDateKey },
    today,
  ).document
  fields = workspaceCollections(project(document))
  assert.equal(fields.datedTasksByDate[dateKey]?.length ?? 0, 0)
  assert.equal(fields.datedTasksByDate[targetDateKey]![0]!.id, 'task')
  assert.equal(fields.events[0]!.dateKey, targetDateKey)
  assert.equal(fields.events[0]!.start, 600)
  assert.equal(fields.events[0]!.end, 645)
  assert.equal(document.entities.filter((entity) => entity.kind === 'task').length, 1)
  assert.equal(initial.entities.find((entity) => entity.id === 'task')!.data.lane, 'backlog:anytime')
})

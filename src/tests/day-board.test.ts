import assert from 'node:assert/strict'
import test from 'node:test'
import { dayBoardTasks } from '../domain/day-board'
import { createWorkspaceTasks } from '../domain/task-creation'
import { executeTaskCommand } from '../domain/task-commands'
import { emptyWorkspace } from '../domain/production-workspace'
import { project } from '../domain/workspace'
import { workspaceCollections } from '../domain/workspace-collections'
import { moveTaskToTodayBoard } from '../domain/today-board'

const context = { today: '2026-09-25', now: new Date('2026-09-25T08:00:00'), actor: 'Test' }
test('each scheduled day retains one board card sharing canonical edits and completion', () => {
  let { document } = createWorkspaceTasks(
    emptyWorkspace(context.today),
    {
      seriesId: 'task',
      title: 'Shared task',
      area: 'Work',
      accent: 'violet',
      dateKey: context.today,
      minutes: 30,
      schedule: { start: 600, end: 630 },
    },
    context,
  )
  for (const [dateKey, start] of [
    [context.today, 720],
    ['2026-09-26', 840],
  ] as const) {
    document = executeTaskCommand(
      document,
      {
        type: 'task.schedule',
        taskId: 'task',
        dateKey,
        start,
        end: start + 30,
      },
      context,
    )
  }
  const before = structuredClone(document)
  const boards = () => dayBoardTasks(workspaceCollections(project(document)), context.today)
  assert.equal(boards()[context.today]!.length, 1)
  assert.equal(boards()['2026-09-26']!.length, 1)
  assert.equal(boards()[context.today]![0]!.time, '10:00')
  assert.equal(boards()['2026-09-26']![0]!.time, '14:00')
  assert.deepEqual(document, before)
  document = moveTaskToTodayBoard(document, 'task', 'done', context.now)
  assert.ok(boards()[context.today]![0]!.complete)
  assert.ok(boards()['2026-09-26']![0]!.complete)
  assert.equal(document.entities.filter((entity) => entity.kind === 'task').length, 1)
  document = executeTaskCommand(document, { type: 'task.unschedule', taskId: 'task' }, context)
  assert.equal(boards()[context.today]!.length, 0)
  assert.equal(boards()['2026-09-26']!.length, 1, 'Unscheduling preserves the assigned board')
})

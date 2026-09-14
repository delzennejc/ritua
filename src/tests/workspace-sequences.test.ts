import test from 'node:test'
import assert from 'node:assert/strict'
import { assertWorkspaceInvariants, exerciseWorkspaceSequence } from './workspace-sequences'
import { type TaskCommand } from '../domain/task-commands'
import { executeTaskCommand } from './view-command-adapters'
import { project, normalize } from '../domain/workspace'
import { emptyWorkspace } from '../domain/production-workspace'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from './view-command-adapters'
import { selectTask } from '../domain/workspace-selectors'

test('recurrence, scheduling, project archive, reassignment, Undo and restart stay consistent', () => {
  exerciseWorkspaceSequence()
})

test('seeded action sequences retain unique tasks, valid references and reversible deletion', () => {
  const context = { today: '2026-09-14', now: new Date('2026-09-14T10:00:00'), actor: 'Test' }
  for (let seed = 1; seed <= 12; seed++) {
    let state = seed
    const random = (n: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % n
    }
    let fields = project(emptyWorkspace(context.today))
    for (let i = 0; i < 12; i++)
      fields = executeTaskCommand(
        fields,
        {
          type: 'task.create',
          tasks: [
            {
              task: { id: `task-${i}`, title: `Work ${i}`, minutes: 30, channel: 'Work' },
              lane: 'backlog:anytime',
            },
          ],
        },
        context,
      )
    for (let step = 0; step < 80; step++) {
      const taskId = `task-${random(12)}`
      const task = selectTask(normalize(fields), taskId)!
      const action = random(5)
      let command: TaskCommand
      if (action === 0)
        command = {
          type: 'task.schedule',
          taskId,
          dateKey: `2026-09-${14 + random(5)}`,
          start: 480 + random(10) * 30,
          end: 810,
        }
      else if (action === 1) command = { type: 'task.unschedule', taskId }
      else if (action === 2)
        command = { type: 'task.move', taskId, lane: random(2) ? 'backlog:anytime' : 'backlog:someday' }
      else if (action === 3) command = { type: 'task.complete-undated', taskId }
      else {
        const deleted = deleteWorkspaceTask(fields, taskId)
        assertWorkspaceInvariants(deleted.fields)
        fields = undoWorkspaceTaskDeletion(deleted.fields, deleted.undo)
        assert.equal(selectTask(normalize(fields), taskId)!.title, task.title)
        assertWorkspaceInvariants(fields)
        continue
      }
      fields = executeTaskCommand(fields, command, context)
      assertWorkspaceInvariants(fields)
    }
  }
})

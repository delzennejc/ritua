import type { openDatabase } from '../../main/db/database'
import { emptyWorkspace } from '../../domain/production-workspace'
import { normalize, project, changes } from '../../domain/workspace'

export function testWorkspace() {
  const fields = project(emptyWorkspace())
  fields.tasks = [
    {
      id: 'main',
      title: 'Task with a subtask',
      channel: 'Work',
      minutes: 30,
      complete: false,
      accent: 'violet',
      objectiveId: 'test-project',
      subtasks: [{ id: 'subtask', title: 'A step', minutes: 15, complete: false }],
    },
    {
      id: 'before',
      title: 'Calendar resize task',
      channel: 'Work',
      minutes: 30,
      complete: false,
      accent: 'violet',
      time: '08:00',
      subtasks: [
        { id: 'order-first', title: 'First reorder step', minutes: 10, complete: false },
        { id: 'order-second', title: 'Second reorder step', minutes: 15, complete: true },
      ],
    },
  ]
  fields.weeklyObjectives = [
    {
      id: 'test-project',
      title: 'Test Project',
      channel: 'Work',
      tasks: [
        { id: 'project-main', taskId: 'main', title: 'Task with a subtask', minutes: 30, complete: false },
      ],
    },
  ]
  fields.events = [
    { id: 'before', title: 'Calendar resize task', start: 480, end: 510, color: 'violet', complete: false },
  ]
  return normalize(fields)
}
export function seedTestWorkspace(database: ReturnType<typeof openDatabase>) {
  database.commitWorkspace(changes(database.loadWorkspace(), testWorkspace(), 'test-fixture'))
}

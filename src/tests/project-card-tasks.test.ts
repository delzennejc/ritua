import test from 'node:test'
import assert from 'node:assert/strict'
import { currentProjectCardTasks } from '../domain/project-card-tasks'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import { rollWorkspaceDate } from '../domain/live-calendar'
import { workspaceCollections } from '../domain/workspace-collections'
import type { Project } from '../domain/models'
import { toggleWorkspaceTaskCompletion } from '../domain/task-completion'
import { isPreviousWeekCompletedTask } from '../domain/project-task-order'

test('project cards hide previous weeks completion using canonical records, preserving open work and membership', () => {
  const fields = project(emptyWorkspace('2026-09-14'))
  fields.datedTasksByDate = {
    '2026-09-13': [
      { id: 'old', title: 'Finished Sunday', complete: true, completedDateKey: '2026-09-13' },
      { id: 'fallback', title: 'Finished without a completion timestamp', complete: true },
      { id: 'open', title: 'Still open', complete: false },
      { id: 'recent', title: 'Finished Monday', complete: true, completedDateKey: '2026-09-14' },
    ],
  }
  const objective: Project = {
    id: 'p',
    title: 'Project',
    tasks: ['old', 'fallback', 'open', 'recent'].map((id) => ({ id: `member-${id}`, taskId: id, title: id })),
  }
  fields.weeklyObjectives = [objective]
  const document = normalize(fields)
  const before = structuredClone(document)
  assert.deepEqual(
    currentProjectCardTasks(objective, document, '2026-09-14').map((task) => task.taskId),
    ['open'],
  )
  assert.deepEqual(document, before)
  assert.equal(objective.tasks!.length, 4)
})

test('checking off a previous-week task today hides it from cards and places it in collapsible history', () => {
  const today = '2026-09-14'
  const assignedDate = '2026-09-10'
  const fields = project(emptyWorkspace(today))
  fields.datedTasksByDate = {
    [assignedDate]: [{ id: 'backdated', title: 'Backdated work', objectiveId: 'p', complete: false }],
  }
  fields.weeklyObjectives = [
    {
      id: 'p',
      title: 'Project',
      tasks: [{ id: 'member', taskId: 'backdated', title: 'Backdated work', complete: false }],
    },
  ]
  const document = normalize(fields)
  const objective = workspaceCollections(project(document)).weeklyObjectives[0]!
  assert.equal(currentProjectCardTasks(objective, document, today).length, 1)

  const completed = toggleWorkspaceTaskCompletion(document, 'backdated', new Date(`${today}T12:00:00`))
  const completedFields = workspaceCollections(project(completed))
  const task = completedFields.datedTasksByDate[assignedDate]![0]!
  assert.equal(task.completedDateKey, today)
  assert.equal(currentProjectCardTasks(completedFields.weeklyObjectives[0]!, completed, today).length, 0)
  assert.equal(isPreviousWeekCompletedTask({ ...task, dateKey: assignedDate }, today), true)

  const reopened = toggleWorkspaceTaskCompletion(completed, 'backdated', new Date(`${today}T12:01:00`))
  assert.equal(currentProjectCardTasks(objective, reopened, today).length, 1)
})

test('starting a new week hides last week’s completed tasks without deleting history', () => {
  const fields = project(emptyWorkspace('2026-09-20'))
  fields.tasks = [
    { id: 'done', title: 'Done', complete: true, completedDateKey: '2026-09-20' },
    { id: 'open', title: 'Open', complete: false },
  ]
  fields.weeklyObjectives = [
    {
      id: 'p',
      title: 'Project',
      tasks: [
        { id: 'done', title: 'Done' },
        { id: 'open', title: 'Open' },
      ],
    },
  ]
  const document = normalize(fields)
  const objective = workspaceCollections(project(document)).weeklyObjectives[0]!
  assert.equal(currentProjectCardTasks(objective, document, '2026-09-14').length, 2)
  const rolled = rollWorkspaceDate(document, '2026-09-21')
  const rolledObjective = workspaceCollections(project(rolled)).weeklyObjectives[0]!
  assert.deepEqual(
    currentProjectCardTasks(rolledObjective, rolled, '2026-09-21').map((task) => task.id),
    ['open'],
  )
  assert.equal(rolledObjective.tasks!.length, 2)
  assert.equal(rolled.entities.filter((entity) => entity.kind === 'task').length, 2)
})

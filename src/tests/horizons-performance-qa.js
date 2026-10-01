// Explicit fixture and navigation measurement for the isolated native QA harness.
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import {
  replaceWorkspaceDocument,
  flushWorkspace,
  getWorkspaceFields,
} from '../renderer/src/desktop/workspace-store'
import { addDays, localDateKey, mondayOf } from '../domain/calendar-dates'
export { flushWorkspace, getWorkspaceFields }

export async function seedHorizonsPerformance(count = 2000, horizon = 'Anytime', projectSize = 0) {
  const fields = project(emptyWorkspace(localDateKey()))
  fields.view = 'today'
  fields['daily.completedDate'] = localDateKey()
  fields['weekly.completedWeek'] = mondayOf(localDateKey())
  fields.weeklyObjectives = ['Work', 'Personal'].map((channel) => ({
    id: `qa-project-${channel}`,
    title: `${channel} project`,
    channel,
    complete: false,
    focusedThisWeek: true,
    tasks: [],
  }))
  const tasks = Array.from({ length: count }, (_, index) => ({
    id: `qa-horizon-${index}`,
    title:
      index % 11 === 0
        ? `Task ${index + 1}: Review the detailed notes and prepare the next steps for the team, including the longer follow-up work that wraps onto another line`
        : `Task ${index + 1}: Prepare next steps`,
    channel: index < count / 2 ? 'Work' : 'Personal',
    complete: false,
    minutes: 30,
  }))
  if (projectSize) {
    fields.weeklyObjectives = []
    for (const [index, task] of tasks.entries()) {
      const projectIndex = Math.floor(index / projectSize)
      let objective = fields.weeklyObjectives[projectIndex]
      if (!objective) {
        objective = {
          id: `qa-project-${projectIndex}`,
          title: `Project ${projectIndex + 1}`,
          channel: task.channel,
          complete: false,
          focusedThisWeek: true,
          tasks: [],
        }
        fields.weeklyObjectives.push(objective)
      }
      task.objectiveId = objective.id
      objective.tasks.push(task)
    }
  }
  if (horizon === 'Scheduled') {
    fields.datedTasksByDate = {}
    for (const [index, task] of tasks.entries()) {
      const date = addDays(localDateKey(), 1 + Math.floor(index / 1000))
      ;(fields.datedTasksByDate[date] ??= []).push(task)
    }
  } else {
    fields.backlogGroups.find((group) => group.label === horizon).items = tasks
  }
  replaceWorkspaceDocument(normalize(fields))
  await flushWorkspace()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return { count, horizon, ready: true }
}

export async function measureHorizonsNavigation(rounds = 5, horizon = 'Anytime') {
  const measurements = []
  const measure = async (label, click, expected) => {
    const start = performance.now()
    click()
    // The second frame follows a paint of the committed destination view.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (!expected()) throw new Error(`Navigation did not reach ${label}`)
    measurements.push({ label, ms: +(performance.now() - start).toFixed(1) })
  }
  for (let i = 0; i < rounds; i++) {
    await measure(
      'enter',
      () =>
        [...document.querySelectorAll('.task-list-item')]
          .find((item) => item.textContent.trim() === horizon)
          .click(),
      () => document.querySelector('.backlog-view')?.dataset.backlogPageScope === horizon.toLowerCase(),
    )
    await measure(
      'leave',
      () =>
        [...document.querySelectorAll('.nav-item')]
          .find((item) => item.textContent.trim() === 'Today')
          .click(),
      () => !document.querySelector('.backlog-view'),
    )
  }
  return measurements
}

// Explicit fixture for the isolated hidden Electron harness.
import * as store from '../renderer/src/desktop/workspace-store'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import { localDateKey, mondayOf, addDays } from '../domain/calendar-dates'

export async function seedCompletionAnimation(view = 'today') {
  await store.initializeWorkspace()
  const today = localDateKey()
  const task = (id, title, extra = {}) => ({
    id,
    title,
    channel: 'Work',
    accent: 'violet',
    complete: false,
    ...extra,
  })
  const first = task('qa-animation-task', 'Prepare the launch checklist', {
    objectiveId: 'qa-animation-project',
    subtasks: [
      { id: 'qa-animation-subtask', title: 'Check the navigation states', complete: false },
      { id: 'qa-animation-subtask-two', title: 'Review the empty states', complete: false },
    ],
  })
  const second = task('qa-animation-peer', 'Share the final prototype')
  const backlog = task('qa-animation-backlog', 'Collect the team’s feedback', {
    objectiveId: 'qa-animation-project',
  })
  store.replaceWorkspaceDocument(
    normalize({
      ...project(emptyWorkspace(today)),
      view,
      planningStep: 0,
      weeklyStep: 2,
      taskScope: 'anytime',
      navigationOpen: true,
      rightPanelOpenByPage: { today: true, home: false, backlog: false, weekly: false },
      'daily.completedDate': today,
      'weekly.completedWeek': mondayOf(today),
      tasks: [first, second],
      datedTasksByDate: {
        [addDays(today, -1)]: [task('qa-animation-yesterday', 'Review yesterday’s decisions')],
      },
      backlogGroups: [
        {
          id: 'anytime',
          label: 'Anytime',
          items: [backlog, task('qa-animation-backlog-peer', 'Arrange the next workshop')],
        },
        { id: 'someday', label: 'Someday', items: [] },
      ],
      weeklyObjectives: [
        {
          id: 'qa-animation-project',
          title: 'Website refresh',
          channel: 'Work',
          complete: false,
          focusedThisWeek: true,
          tasks: [first, backlog],
        },
      ],
      weeklyObjectiveOrder: ['qa-animation-project'],
      events: [
        {
          id: 'qa-animation-session',
          kind: 'session',
          title: 'Design review',
          color: 'violet',
          dateKey: today,
          start: 540,
          end: 720,
          taskIds: [first.id, second.id],
        },
      ],
    }),
  )
  await store.flushWorkspace()
}

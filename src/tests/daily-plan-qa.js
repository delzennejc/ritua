// Import this module explicitly in the isolated Electron QA harness, then call seedDailyPlanning().
// Never imported by production startup.
import * as store from '../renderer/src/desktop/workspace-store'
import { normalize } from '../domain/workspace'
import { localDateKey, addDays } from '../domain/calendar-dates'

export async function seedDailyPlanning() {
  const today = localDateKey(),
    yesterday = addDays(today, -1)
  const task = (id, title, channel = 'Work', extra = {}) => ({
    id,
    title,
    channel,
    complete: false,
    minutes: 30,
    ...extra,
  })
  const fields = store.getWorkspaceFields()
  store.replaceWorkspaceDocument(
    normalize({
      ...fields,
      view: 'planning',
      planningStep: 0,
      'daily.selection': null,
      'daily.highlightTaskId': null,
      'daily.completedDate': null,
      'daily.reviewedDate': null,
      tasks: [
        task('qa-draft', 'Finish the onboarding proposal'),
        task('qa-review', 'Review the new illustrations'),
      ],
      datedTasksByDate: {
        [addDays(today, -5)]: [
          task('qa-done-old', 'Send the updated project brief', 'Work', {
            complete: true,
            completedDateKey: yesterday,
          }),
        ],
        [yesterday]: [
          task('qa-done', 'Take a walk after lunch', 'Personal', {
            complete: true,
            completedDateKey: yesterday,
          }),
          task('qa-unfinished', 'Outline the September retrospective'),
        ],
      },
      backlogGroups: [
        {
          id: 'anytime',
          label: 'Anytime',
          items: [
            task('qa-backlog', 'Book a weekend away', 'Personal'),
            task('qa-backlog2', 'Gather feedback from the team'),
          ],
        },
        { id: 'someday', label: 'Someday', items: [] },
      ],
      weeklyObjectives: [
        {
          id: 'qa-project',
          title: 'Website refresh',
          channel: 'Work',
          complete: false,
          tasks: [
            task(
              'qa-project-task',
              'Review the accessibility feedback and finalize the navigation for the new customer workspace',
              'Work',
              { objectiveId: 'qa-project' },
            ),
          ],
        },
      ],
      weeklyObjectiveOrder: ['qa-project'],
      events: [],
    }),
  )
  await store.flushWorkspace()
  return 'Seeded isolated planning QA'
}

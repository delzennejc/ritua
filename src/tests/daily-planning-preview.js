// Explicit browser-only test entry. Normal startup never imports this fixture.
import {
  initializeWorkspace,
  getWorkspaceFields,
  replaceWorkspaceDocument,
} from '../renderer/src/desktop/workspace-store'
import { normalize } from '../domain/workspace'
import { addDays, localDateKey } from '../domain/calendar-dates'
import { seedDailyPlanning } from './daily-plan-qa'

if (
  import.meta.env.DEV &&
  !window.ritua &&
  new URLSearchParams(location.search).get('testMode') === 'planning'
) {
  await initializeWorkspace()
  await seedDailyPlanning()
  const today = localDateKey()
  const yesterday = addDays(today, -1)
  const task = (id, title, channel = 'Work', extra = {}) => ({
    id: `preview-${id}`,
    title,
    channel,
    complete: false,
    ...extra,
  })
  const fields = getWorkspaceFields()
  const completed = [
    task('done-1', 'Share the first onboarding prototype'),
    task('done-2', 'Send the revised estimate to the client'),
    task('done-3', 'Resolve the navigation feedback from last week'),
    task('done-4', 'Prepare questions for customer interviews'),
    task('done-5', 'Go for a run by the river', 'Personal'),
    task('done-6', 'Book the dentist appointment', 'Personal'),
  ].map((item) => ({ ...item, complete: true, completedDateKey: yesterday }))
  const unfinished = [
    task('carry-1', 'Review the launch checklist with the team'),
    task('carry-2', 'Reply to the three outstanding client questions'),
    task('carry-3', 'Return the library books', 'Personal'),
  ]
  const anytime = [
    task('any-1', 'Write a short update on this week’s priorities'),
    task('any-2', 'Review the copy for the new pricing page'),
    task('any-3', 'Tidy up the research notes from the last five customer interviews'),
    task('any-4', 'Send invoices for September'),
    task('any-5', 'Order coffee and groceries', 'Personal'),
    task('any-6', 'Plan dinners for the week', 'Personal'),
    task('any-7', 'Call Alex about Saturday', 'Personal'),
    task('any-8', 'Find a birthday gift for Emma', 'Personal'),
  ]
  const project = (id, title, channel, titles) => ({
    id: `preview-project-${id}`,
    title,
    channel,
    complete: false,
    tasks: titles.map((title, index) =>
      task(`${id}-${index}`, title, channel, { objectiveId: `preview-project-${id}` }),
    ),
  })
  const projects = [
    ...fields.weeklyObjectives,
    project('launch', 'Autumn launch', 'Work', [
      'Draft the announcement email',
      'Check the mobile signup flow before sharing it with the launch partners',
      'Prepare three screenshots for the launch post',
    ]),
    project('home', 'Make home feel better', 'Personal', [
      'Measure the wall for the new bookshelf',
      'Choose a desk lamp',
      'Donate clothes we no longer wear',
    ]),
  ]
  replaceWorkspaceDocument(
    normalize({
      ...fields,
      planningStep: 1,
      datedTasksByDate: {
        ...fields.datedTasksByDate,
        [yesterday]: [...fields.datedTasksByDate[yesterday], ...completed, ...unfinished],
      },
      backlogGroups: fields.backlogGroups.map((group) => ({
        ...group,
        items: [
          ...group.items,
          ...(group.id === 'anytime'
            ? anytime
            : [
                task('later-1', 'Explore a pottery class', 'Personal'),
                task('later-2', 'Collect ideas for a small side project'),
              ]),
        ],
      })),
      weeklyObjectives: projects,
      weeklyObjectiveOrder: projects.map((item) => item.id),
      'daily.selection': {
        taskIds: ['qa-draft', 'preview-launch-1', 'preview-any-6', 'qa-backlog'],
        highlightId: 'qa-draft',
      },
    }),
  )
}

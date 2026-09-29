// Explicit fixture for the isolated native QA harness only.
import { seedDailyPlanning } from './daily-plan-qa'
import {
  getWorkspaceFields,
  replaceWorkspaceDocument,
  flushWorkspace,
} from '../renderer/src/desktop/workspace-store'
import { normalize } from '../domain/workspace'
import { addDays, localDateKey } from '../domain/calendar-dates'

export async function seedDailyReview() {
  await seedDailyPlanning()
  const fields = structuredClone(getWorkspaceFields())
  const yesterday = addDays(localDateKey(), -1)
  const work = fields.datedTasksByDate[yesterday].find((task) => task.id === 'qa-unfinished')
  work.subtasks = [{ id: 'qa-sub', title: 'Collect the team’s notes', complete: false }]
  work.objectiveId = 'qa-project'
  fields.weeklyObjectives[0].tasks.push(work)
  const extra = [
    { id: 'health', label: 'Health', color: '#65a4cd', accent: 'blue' },
    { id: 'learning', label: 'Learning', color: '#dfa94f', accent: 'amber' },
    { id: 'home', label: 'Home', color: '#36a89b', accent: 'teal' },
  ]
  const titles = {
    Health: ['Prepare meals for the next few days', 'Go for a run by the river'],
    Learning: [
      'Finish the chapter and write down three ideas to try in the next project',
      'Practice Spanish for twenty minutes',
    ],
    Home: ['Water the plants', 'Fix the loose cupboard handle'],
  }
  replaceWorkspaceDocument(
    normalize({
      ...fields,
      areas: [...fields.areas.filter((area) => !extra.some((item) => item.id === area.id)), ...extra],
      'daily.reviewOrder': [],
      datedTasksByDate: {
        ...fields.datedTasksByDate,
        [yesterday]: [
          ...fields.datedTasksByDate[yesterday],
          {
            id: 'qa-personal-open',
            title: 'Book the dentist appointment',
            channel: 'Personal',
            complete: false,
          },
          ...extra.flatMap((area) =>
            titles[area.label].map((title, index) => ({
              id: `qa-${area.id}-${index}`,
              title,
              channel: area.label,
              accent: area.accent,
              complete: index === 1,
              ...(index === 1 ? { completedDateKey: yesterday } : {}),
            })),
          ),
        ],
      },
    }),
  )
  await flushWorkspace()
  return 'Five-area review ready'
}

export async function seedDailyReviewTime() {
  await seedDailyReview()
  const fields = structuredClone(getWorkspaceFields())
  const yesterday = addDays(localDateKey(), -1)
  const recorded = {
    'qa-done-old': 180,
    'qa-unfinished': 60,
    'qa-done': 45,
    'qa-health-1': 35,
    'qa-learning-1': 25,
    'qa-home-1': 15,
  }
  for (const tasks of Object.values(fields.datedTasksByDate)) {
    for (const task of tasks) {
      if (recorded[task.id]) task.actualMinutes = recorded[task.id]
    }
  }
  fields.events = [
    {
      id: 'qa-empty-session',
      kind: 'session',
      title: 'Open focus time',
      dateKey: yesterday,
      start: 900,
      end: 930,
      taskIds: [],
    },
  ]
  replaceWorkspaceDocument(normalize(fields))
  await flushWorkspace()
  return 'Yesterday: 390 recorded minutes across five areas and an empty session'
}

export async function seedDailyActivity() {
  await seedDailyReviewTime()
  const fields = structuredClone(getWorkspaceFields())
  for (let offset = 2; offset <= 180; offset++) {
    const dateKey = addDays(localDateKey(), -offset)
    if (offset % 5 === 0) continue
    fields.datedTasksByDate[dateKey] = [
      ...(fields.datedTasksByDate[dateKey] || []),
      ...Array.from({ length: (offset % 4) + 1 }, (_, index) => ({
        id: `qa-activity-${offset}-${index}`,
        title: 'Previous work',
        channel: offset % 2 === 0 ? 'Work' : 'Personal',
        complete: true,
        completedDateKey: dateKey,
        actualMinutes: ((offset % 4) + 1) * 30,
      })),
    ]
  }
  replaceWorkspaceDocument(normalize(fields))
  await flushWorkspace()
  return 'Six-month activity ready'
}

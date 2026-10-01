// Explicit fixture for the isolated native QA harness only.
import * as store from '../renderer/src/desktop/workspace-store'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import { addDays, localDateKey, mondayOf } from '../domain/calendar-dates'
import { markDayReviewed } from '../domain/day-review'

export async function seedHomeDayReviews(state = 'mixed') {
  await store.initializeWorkspace()
  const today = localDateKey()
  const yesterday = addDays(today, -1)
  const earlier = addDays(today, -3)
  const task = (id, title, complete = false, dateKey = today, extra = {}) => ({
    id,
    title,
    channel: 'Work',
    accent: 'violet',
    complete,
    minutes: 60,
    ...(complete ? { completedDateKey: dateKey } : {}),
    ...extra,
  })
  const todayTasks =
    state === 'empty'
      ? []
      : [
          task('home-today-open', 'Prepare the launch checklist', state === 'complete', today, {
            time: '10:00',
          }),
          task('home-today-done', 'Share the revised prototype', true, today, { time: '09:00' }),
        ]
  const fields = {
    ...project(emptyWorkspace(today)),
    view: 'home',
    navigationOpen: true,
    rightPanelOpenByPage: { home: false },
    rightPanes: { home: 'board' },
    'daily.completedDate': today,
    'weekly.completedWeek': mondayOf(today),
    tasks: todayTasks,
    datedTasksByDate: {
      [yesterday]: [task('home-yesterday', 'Resolve the navigation feedback', true, yesterday)],
      [addDays(today, -2)]: [task('home-earlier-open', 'Review the release notes')],
      [earlier]: [task('home-reviewed', 'Send the milestone update', true, earlier)],
    },
    events: [
      ...todayTasks.map((task, index) => ({
        id: task.id,
        color: 'violet',
        title: task.title,
        dateKey: today,
        start: 600 - index * 60,
        end: 660 - index * 60,
      })),
      {
        id: 'home-yesterday',
        color: 'violet',
        title: 'Resolve the navigation feedback',
        dateKey: yesterday,
        start: 600,
        end: 660,
      },
      {
        id: 'home-reviewed',
        color: 'violet',
        title: 'Send the milestone update',
        dateKey: earlier,
        start: 600,
        end: 660,
      },
    ],
  }
  store.replaceWorkspaceDocument(markDayReviewed(normalize(fields), earlier, today))
  await store.flushWorkspace()
  return `Home ${state} day headers ready`
}

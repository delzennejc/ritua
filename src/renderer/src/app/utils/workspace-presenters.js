import { DEFAULT_DATED_TASKS, DEFAULT_AREAS } from '../../../../domain/workspace-defaults'
import { completedTasksLast } from '../../../../domain/tasks'
import { AREA_COLOR_OPTIONS } from '../data/areaColors'

import { CURRENT_DATE_KEY } from './dates'

export const initialDatedTasks = () =>
  Object.fromEntries(
    Object.entries(DEFAULT_DATED_TASKS).map(([dateKey, dateTasks]) => [
      dateKey,
      completedTasksLast(
        dateTasks.map((task) => ({
          ...task,
          subtasks: task.subtasks?.map((subtask) => ({ ...subtask })),
        })),
      ),
    ]),
  )

export const objectiveChannel = (channel) => channel

export const areaAccentForLabel = (label, areas = DEFAULT_AREAS) => {
  const resolvedLabel = objectiveChannel(label)
  const area = areas.find((candidate) => candidate.label === resolvedLabel)
  return area?.accent || AREA_COLOR_OPTIONS.find((option) => option.color === area?.color)?.accent || 'violet'
}

export const areaIdFromLabel = (label, areas) => {
  const baseId =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'area'
  const existingIds = new Set(areas.map((area) => area.id))
  if (!existingIds.has(baseId)) return baseId

  let suffix = 2
  while (existingIds.has(`${baseId}-${suffix}`)) suffix += 1
  return `${baseId}-${suffix}`
}

export const reorderAreas = (areas, { itemId, targetIndex }) => {
  const sourceIndex = areas.findIndex((area) => area.id === itemId)
  if (sourceIndex === -1) return areas

  const nextAreas = [...areas]
  const [movedArea] = nextAreas.splice(sourceIndex, 1)
  const insertionIndex = Math.max(
    0,
    Math.min(Number.isFinite(targetIndex) ? targetIndex : nextAreas.length, nextAreas.length),
  )
  if (sourceIndex === insertionIndex) return areas

  nextAreas.splice(insertionIndex, 0, movedArea)
  return nextAreas
}

export const WEEKLY_OBJECTIVE_COLLECTION_ID = 'weekly-objectives'

export const RIGHT_PANEL_OBJECTIVE_SURFACE_ID = 'right-panel-objectives'

export const THIS_WEEK_OBJECTIVE_LANE_ID = 'this-week-projects'

export const OTHER_OBJECTIVE_LANE_ID = 'other-projects'

export const NAVIGATION_AREA_COLLECTION_ID = 'navigation-areas'

export const NAVIGATION_AREA_SURFACE_ID = 'primary-navigation'

export const CARD_CROSSING_THRESHOLD_RATIO = 0.1

export const backlogTaskDetailsAdapter = (task, areas = DEFAULT_AREAS) => ({
  ...task,
  accent: task.accent || areaAccentForLabel(task.channel, areas),
  minutes: Number.isFinite(task.minutes) && task.minutes > 0 ? task.minutes : 30,
  time: task.time || null,
})

export const withoutTaskRecurrence = (task) => {
  const { recurrence, recurrenceIndex, recurrenceSeriesId, recurrenceStartDateKey, ...singleTask } = task
  return singleTask
}

export const linkTaskInList = (items, taskId, objectiveId) =>
  items.map((task) => {
    if (task.id !== taskId) return task

    const nextTask = { ...task }
    if (objectiveId) nextTask.objectiveId = objectiveId
    else delete nextTask.objectiveId
    return nextTask
  })

export { syncedDurationLabel } from '../../../../domain/task-editing'

export const findTaskDateKey = ({ tasks, datedTasksByDate }, taskId) => {
  if (tasks.some((task) => task.id === taskId)) return CURRENT_DATE_KEY

  return (
    Object.entries(datedTasksByDate).find(([, dateTasks]) =>
      dateTasks.some((task) => task.id === taskId),
    )?.[0] || null
  )
}

export const tasksForDateKey = ({ tasks, datedTasksByDate }, dateKey) =>
  dateKey === CURRENT_DATE_KEY ? tasks : datedTasksByDate[dateKey] || []

export const BOARD_TRANSFER_OVERLAP_RATIO = 0.35

export const BACKLOG_CARD_PREVIEW_ENTER_DISTANCE = 84

export const BACKLOG_CARD_PREVIEW_EXIT_DISTANCE = 48

export const BOARD_INSERTION_PREVIEW_DURATION_MS = 160

export const BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT = 68

export const POST_DRAG_CLICK_GUARD_DURATION_MS = 80

export const TASK_CARD_POINTER_TOP_OFFSET = 10

export const captureIndexedEntries = (items, predicate) =>
  items.reduce((entries, item, index) => (predicate(item) ? [...entries, { index, item }] : entries), [])

export const restoreIndexedEntries = (items, entries, identity) => {
  if (!entries?.length) return items

  const nextItems = [...items]
  ;[...entries]
    .sort((first, second) => first.index - second.index)
    .forEach(({ index, item }) => {
      const itemIdentity = identity(item)
      if (nextItems.some((candidate) => identity(candidate) === itemIdentity)) return
      nextItems.splice(Math.min(Math.max(index, 0), nextItems.length), 0, item)
    })
  return nextItems
}

export const taskIdentity = (task) => task.taskId || task.id

export const objectiveIdentity = (objective) => objective.id

export const eventIdentity = (calendarEvent) =>
  `${calendarEvent.id}:${calendarEvent.dateKey || CURRENT_DATE_KEY}`

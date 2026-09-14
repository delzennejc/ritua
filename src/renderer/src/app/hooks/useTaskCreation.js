import { createTasks } from '../../desktop/workspace-actions'
import { CURRENT_DATE_KEY, dateFromKey } from '../utils/dates'
import { recurrenceLabel } from '../../../../domain/recurrence'
import { areaAccentForLabel } from '../utils/workspace-presenters.js'

import { replaceWorkspaceDocument, getWorkspaceDocument } from '../../desktop/workspace-store'
import { createCalendarSession } from '../../../../domain/calendar-sessions'

export function useTaskCreation({ setAddingTask, areas, setToast }) {
  const openAddTask = (context) => {
    setAddingTask(
      typeof context === 'string'
        ? { dateKey: context }
        : {
            dateKey: CURRENT_DATE_KEY,
            ...(context && typeof context === 'object' ? context : {}),
          },
    )
  }

  const addTask = ({ area, dateKey, minutes, objectiveId, recurrence, title }, { prepend = false } = {}) => {
    const { recurring, firstTaskId } = createTasks({
      seriesId: `task-${crypto.randomUUID()}`,
      area,
      accent: areaAccentForLabel(area, areas),
      dateKey,
      minutes,
      objectiveId,
      recurrence,
      title,
      prepend,
    })
    setAddingTask(null)
    const dateLabel = dateFromKey(dateKey).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    setToast(
      recurring
        ? `${title} · ${recurrenceLabel(recurrence, dateKey)}.`
        : dateKey === CURRENT_DATE_KEY
          ? 'Task added to today.'
          : `Task added to ${dateLabel}.`,
    )
    return firstTaskId
  }

  const createBoardTask = ({ title, dateKey }) =>
    addTask(
      {
        area: areas[0]?.label || 'Ritua',
        dateKey,
        minutes: 30,
        title,
      },
      { prepend: true },
    )

  const createCalendarSessionFromSelection = ({ dateKey, title, start, end }) => {
    const id = `session-${crypto.randomUUID()}`
    replaceWorkspaceDocument(
      createCalendarSession(getWorkspaceDocument(), {
        id,
        title,
        dateKey,
        start,
        end,
      }),
    )
    setToast('Session created.')
    return id
  }
  return { openAddTask, addTask, createBoardTask, createCalendarSessionFromSelection }
}

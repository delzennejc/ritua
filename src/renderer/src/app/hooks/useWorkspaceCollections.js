import { useCallback, useMemo } from 'react'
import { useWorkspaceProjection, useWorkspaceState } from '../../desktop/workspace-store'
import { updateCalendarEvents } from '../../desktop/workspace-actions'
import { dayBoardTasks } from '../../../../domain/day-board'
import { CURRENT_DATE_KEY } from '../utils/dates'
import {
  DEFAULT_AREAS,
  DEFAULT_TASKS,
  DEFAULT_PROJECTS,
  DEFAULT_EVENTS,
  DEFAULT_BACKLOG_GROUPS,
} from '../../../../domain/workspace-defaults'
const EMPTY_DATES = Object.freeze({})
const EMPTY_ORDER = Object.freeze([])

/** Views subscribe at their boundary; shared workspace data is not passed through page props. */
export function useWorkspaceCollections() {
  const areas = useWorkspaceProjection('areas', DEFAULT_AREAS)
  const tasks = useWorkspaceProjection('tasks', DEFAULT_TASKS)
  const datedTasksByDate = useWorkspaceProjection('datedTasksByDate', EMPTY_DATES)
  const events = useWorkspaceProjection('events', DEFAULT_EVENTS)
  const boardTasksByDate = useMemo(
    () => dayBoardTasks({ tasks, datedTasksByDate, events }, CURRENT_DATE_KEY),
    [tasks, datedTasksByDate, events],
  )
  const backlogGroups = useWorkspaceProjection('backlogGroups', DEFAULT_BACKLOG_GROUPS)
  const [objectives, setObjectives] = useWorkspaceState('weeklyObjectives', DEFAULT_PROJECTS)
  const [order, setOrder] = useWorkspaceState('weeklyObjectiveOrder', EMPTY_ORDER)
  const weeklyFocusedObjectives = useMemo(() => {
    const positions = new Map(order.map((id, index) => [id, index]))
    return objectives
      .filter((project) => project.focusedThisWeek !== false)
      .sort(
        (a, b) =>
          (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )
  }, [objectives, order])
  const setWeeklyFocusedObjectives = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(weeklyFocusedObjectives) : update
      setOrder(next.map((project) => project.id))
    },
    [weeklyFocusedObjectives, setOrder],
  )
  const rightPanelUnavailableTaskIds = useMemo(
    () => [
      ...new Set([...tasks, ...Object.values(datedTasksByDate).flat(), ...events].map((item) => item.id)),
    ],
    [tasks, datedTasksByDate, events],
  )
  return {
    areas,
    tasks,
    datedTasksByDate,
    boardTasksByDate,
    events,
    setEvents: updateCalendarEvents,
    backlogGroups,
    objectives,
    setObjectives,
    weeklyFocusedObjectives,
    setWeeklyFocusedObjectives,
    rightPanelUnavailableTaskIds,
  }
}

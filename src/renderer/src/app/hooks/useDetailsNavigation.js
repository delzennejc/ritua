import { useState, useRef, useMemo, useCallback } from 'react'
import { backlogTaskDetailsAdapter, findTaskDateKey } from '../utils/workspace-presenters.js'
import { CURRENT_DATE_KEY } from '../utils/dates'

export function useDetailsNavigation({
  weeklyObjectives,
  areas,
  tasks,
  datedTasksByDate,
  backlogGroups,
  events,
  accomplishedObjectives,
  setAddingTask,
}) {
  const [activeAreaId, setActiveAreaId] = useState(null)

  const [activeObjectiveId, setActiveObjectiveId] = useState(null)

  const [objectiveDetailsEntryMode, setObjectiveDetailsEntryMode] = useState('direct')

  const [objectiveDetailsParentTaskId, setObjectiveDetailsParentTaskId] = useState(null)

  const [activeTaskId, setActiveTaskId] = useState(null)

  const [taskDetailsEntryMode, setTaskDetailsEntryMode] = useState('direct')

  const [taskDetailsParentObjectiveId, setTaskDetailsParentObjectiveId] = useState(null)

  const areaDetailsReturnFocusRef = useRef(null)

  const objectiveDetailsReturnFocusRef = useRef(null)

  const objectiveDetailsScrollTopRef = useRef(0)

  const objectiveDetailsTaskFocusIdRef = useRef(null)

  const objectiveDetailsParentTaskEntryModeRef = useRef('direct')

  const objectiveDetailsParentTaskObjectiveIdRef = useRef(null)

  const taskDetailsReturnFocusRef = useRef(null)

  const activeObjective = useMemo(
    () => weeklyObjectives.find((objective) => objective.id === activeObjectiveId) || null,
    [activeObjectiveId, weeklyObjectives],
  )

  const activeAreaDetails = useMemo(
    () => areas.find((area) => area.id === activeAreaId) || null,
    [activeAreaId, areas],
  )

  const activeTask = useMemo(
    () =>
      tasks.find((task) => task.id === activeTaskId) ||
      Object.values(datedTasksByDate)
        .flat()
        .find((task) => task.id === activeTaskId) ||
      (() => {
        const backlogTask = backlogGroups
          .flatMap((group) => group.items)
          .find((task) => task.id === activeTaskId)
        return backlogTask ? backlogTaskDetailsAdapter(backlogTask, areas) : null
      })() ||
      null,
    [activeTaskId, areas, backlogGroups, datedTasksByDate, tasks],
  )

  const activeTaskDateKey = useMemo(() => {
    if (!activeTaskId) return null
    const boardDateKey = findTaskDateKey({ tasks, datedTasksByDate }, activeTaskId)
    if (boardDateKey) return boardDateKey
    const isBacklogTask = backlogGroups.some((group) => group.items.some((task) => task.id === activeTaskId))
    return isBacklogTask ? CURRENT_DATE_KEY : null
  }, [activeTaskId, backlogGroups, datedTasksByDate, tasks])

  const activeTaskEvent = useMemo(
    () =>
      events.find(
        (calendarEvent) =>
          calendarEvent.id === activeTaskId &&
          (calendarEvent.dateKey || CURRENT_DATE_KEY) === activeTaskDateKey,
      ) ||
      events.find((calendarEvent) => calendarEvent.id === activeTaskId) ||
      null,
    [activeTaskDateKey, activeTaskId, events],
  )

  const activeTaskObjective = useMemo(
    () =>
      weeklyObjectives.find((objective) => objective.id === activeTask?.objectiveId) ||
      accomplishedObjectives.find((objective) => objective.id === activeTask?.objectiveId) ||
      null,
    [activeTask, weeklyObjectives, accomplishedObjectives],
  )

  const openTaskDetails = useCallback((task, returnFocusElement) => {
    taskDetailsReturnFocusRef.current = returnFocusElement || document.activeElement
    setAddingTask(null)
    setTaskDetailsEntryMode('direct')
    setTaskDetailsParentObjectiveId(null)
    setObjectiveDetailsParentTaskId(null)
    setActiveObjectiveId(null)
    setActiveTaskId(task.id)
  }, [])

  const openAreaDetails = useCallback((area, returnFocusElement) => {
    areaDetailsReturnFocusRef.current = returnFocusElement || document.activeElement
    setAddingTask(null)
    setActiveTaskId(null)
    setActiveObjectiveId(null)
    setActiveAreaId(area.id)
  }, [])

  const closeAreaDetails = useCallback(() => {
    setActiveAreaId(null)
  }, [])

  const closeTaskDetails = useCallback(() => {
    if (
      taskDetailsParentObjectiveId &&
      weeklyObjectives.some((objective) => objective.id === taskDetailsParentObjectiveId)
    ) {
      setObjectiveDetailsEntryMode('from-task')
      setActiveTaskId(null)
      setActiveObjectiveId(taskDetailsParentObjectiveId)
      setTaskDetailsParentObjectiveId(null)
      return
    }

    setActiveTaskId(null)
    setTaskDetailsParentObjectiveId(null)
  }, [taskDetailsParentObjectiveId, weeklyObjectives])

  const openObjectiveDetails = useCallback((objective, returnFocusElement) => {
    objectiveDetailsReturnFocusRef.current = returnFocusElement || document.activeElement
    objectiveDetailsScrollTopRef.current = 0
    objectiveDetailsTaskFocusIdRef.current = null
    setAddingTask(null)
    setObjectiveDetailsEntryMode('direct')
    setObjectiveDetailsParentTaskId(null)
    setTaskDetailsParentObjectiveId(null)
    setActiveTaskId(null)
    setActiveObjectiveId(objective.id)
  }, [])

  const closeObjectiveDetails = useCallback(() => {
    const parentTaskId = objectiveDetailsParentTaskId
    const parentTaskEntryMode = objectiveDetailsParentTaskEntryModeRef.current
    const parentTaskObjectiveId = objectiveDetailsParentTaskObjectiveIdRef.current
    objectiveDetailsScrollTopRef.current = 0
    objectiveDetailsTaskFocusIdRef.current = null
    objectiveDetailsParentTaskEntryModeRef.current = 'direct'
    objectiveDetailsParentTaskObjectiveIdRef.current = null
    setActiveObjectiveId(null)
    setObjectiveDetailsParentTaskId(null)
    if (!parentTaskId) return

    setTaskDetailsEntryMode(parentTaskEntryMode)
    setTaskDetailsParentObjectiveId(parentTaskObjectiveId)
    setActiveTaskId(parentTaskId)
  }, [objectiveDetailsParentTaskId])

  const openObjectiveTaskDetails = useCallback(
    (task, returnFocusElement, scrollTop) => {
      if (!activeObjective || !task?.id) return

      taskDetailsReturnFocusRef.current = returnFocusElement || document.activeElement
      objectiveDetailsScrollTopRef.current = scrollTop
      objectiveDetailsTaskFocusIdRef.current = task.id
      setAddingTask(null)
      setTaskDetailsEntryMode('from-project')
      setTaskDetailsParentObjectiveId(activeObjective.id)
      setActiveObjectiveId(null)
      setActiveTaskId(task.id)
    },
    [activeObjective],
  )

  const openActiveTaskObjectiveDetails = useCallback(
    (returnFocusElement, { taskDeleted = false } = {}) => {
      if (
        !activeTask?.id ||
        !activeTaskObjective ||
        !weeklyObjectives.some((objective) => objective.id === activeTaskObjective.id)
      )
        return

      const returningToParent = taskDetailsParentObjectiveId === activeTaskObjective.id
      objectiveDetailsReturnFocusRef.current = returnFocusElement || document.activeElement
      if (!returningToParent) {
        objectiveDetailsScrollTopRef.current = 0
        objectiveDetailsTaskFocusIdRef.current = null
      }
      objectiveDetailsParentTaskEntryModeRef.current = taskDetailsEntryMode
      objectiveDetailsParentTaskObjectiveIdRef.current = taskDetailsParentObjectiveId
      setAddingTask(null)
      setObjectiveDetailsEntryMode('from-task')
      setObjectiveDetailsParentTaskId(taskDeleted ? null : activeTask.id)
      setTaskDetailsParentObjectiveId(null)
      setActiveTaskId(null)
      setActiveObjectiveId(activeTaskObjective.id)
    },
    [activeTask, activeTaskObjective, taskDetailsEntryMode, taskDetailsParentObjectiveId, weeklyObjectives],
  )
  return {
    setActiveAreaId,
    activeObjectiveId,
    objectiveDetailsEntryMode,
    activeTaskId,
    setActiveTaskId,
    taskDetailsEntryMode,
    areaDetailsReturnFocusRef,
    objectiveDetailsReturnFocusRef,
    objectiveDetailsScrollTopRef,
    objectiveDetailsTaskFocusIdRef,
    taskDetailsReturnFocusRef,
    activeObjective,
    activeAreaDetails,
    activeTask,
    activeTaskDateKey,
    activeTaskEvent,
    activeTaskObjective,
    openTaskDetails,
    openAreaDetails,
    closeAreaDetails,
    closeTaskDetails,
    openObjectiveDetails,
    closeObjectiveDetails,
    openObjectiveTaskDetails,
    openActiveTaskObjectiveDetails,
  }
}

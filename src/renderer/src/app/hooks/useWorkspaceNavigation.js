import { useCallback, useMemo, useState, useEffect } from 'react'
import { useWorkspaceState } from '../../desktop/workspace-store'

/** Navigation, panel preferences and date-focus requests form one UI controller. */
export function useWorkspaceNavigation({ areas, weeklyObjectives, autoScheduleRequest, finishAutoSchedule }) {
  const [view, setView] = useWorkspaceState('view', 'home')
  const [planningStep, setPlanningStep] = useWorkspaceState('planningStep', 0)
  const [weeklyStep, setWeeklyStep] = useWorkspaceState('weeklyStep', 0)
  const [taskScope, setTaskScope] = useWorkspaceState('taskScope', 'anytime')
  const [navigationOpen, setNavigationOpen] = useWorkspaceState('navigationOpen', true)
  const [homeWeekStartRequest, setHomeWeekStartRequest] = useState(0)
  const [homeTodayFocusRequest, setHomeTodayFocusRequest] = useState(0)
  const [rightPanelOpenByPage, setRightPanelOpenByPage] = useWorkspaceState('rightPanelOpenByPage', {
    home: true,
    today: true,
    planning: true,
    backlog: true,
    weekly: true,
  })
  const [rightPanes, setRightPanes] = useWorkspaceState('rightPanes', {
    home: 'calendar',
    today: 'calendar',
    planning: 'calendar',
    backlog: 'board',
    weekly: 'objectives',
  })
  const activeTitle = useMemo(() => {
    if (view === 'backlog') {
      if (taskScope.startsWith('project:')) {
        const id = taskScope.slice('project:'.length)
        return weeklyObjectives.find((objective) => objective.id === id)?.title || 'Project'
      }
      if (taskScope.startsWith('area:')) {
        const id = taskScope.slice('area:'.length)
        return areas.find((area) => area.id === id)?.label || 'Area'
      }
      return taskScope === 'scheduled' ? 'Scheduled' : taskScope === 'someday' ? 'Someday' : 'Anytime'
    }

    return (
      {
        home: 'Home',
        today: 'Today',
        planning: 'Daily planning',
        'weekly-planning': 'Weekly planning',
      }[view] || 'Ritua'
    )
  }, [areas, taskScope, view, weeklyObjectives])
  const rightPaneKey =
    view === 'today'
      ? 'today'
      : view === 'planning'
        ? 'planning'
        : view === 'weekly-planning'
          ? 'weekly'
          : view === 'backlog'
            ? 'backlog'
            : 'home'
  const rightPanelOpen = rightPanelOpenByPage[rightPaneKey] ?? true
  const updateRightPanelOpen = useCallback(
    (nextOpen) => {
      setRightPanelOpenByPage((current) => ({
        ...current,
        [rightPaneKey]: typeof nextOpen === 'function' ? nextOpen(current[rightPaneKey] ?? true) : nextOpen,
      }))
    },
    [rightPaneKey],
  )
  const updateNavigationOpen = useCallback(
    (nextOpen) => {
      if (view === 'home') {
        updateRightPanelOpen(nextOpen)
        if (nextOpen) {
          setHomeTodayFocusRequest((current) => current + 1)
        } else {
          setHomeWeekStartRequest((current) => current + 1)
        }
      }
      setNavigationOpen(nextOpen)
    },
    [updateRightPanelOpen, view],
  )
  const handleToggleNavigation = useCallback(() => {
    updateNavigationOpen(!navigationOpen)
  }, [navigationOpen, updateNavigationOpen])
  const rightPanelAvailable =
    view === 'home' ||
    view === 'today' ||
    view === 'backlog' ||
    (view === 'planning' && planningStep > 0 && planningStep < 4) ||
    (view === 'weekly-planning' && weeklyStep > 1)
  const activeRightPane = rightPanes[rightPaneKey]
  useEffect(() => {
    if (autoScheduleRequest && autoScheduleRequest.pageKey !== rightPaneKey) {
      finishAutoSchedule(autoScheduleRequest)
    }
  }, [autoScheduleRequest, finishAutoSchedule, rightPaneKey])
  const selectRightPane = (pane) => {
    setRightPanes((current) => ({ ...current, [rightPaneKey]: pane }))
  }
  const handleAppContentClickCapture = (event) => {
    if (!rightPanelOpen && event.target.closest?.('.rail-button')) {
      updateRightPanelOpen(true)
    }
  }
  const navigate = (nextView) => {
    if (nextView === 'weekly-planning') {
      setView('weekly-planning')
      setWeeklyStep(0)
      return
    }
    setView(nextView)
    if (nextView === 'planning') setPlanningStep(0)
  }
  const openTaskScope = (scope) => {
    setTaskScope(scope)
    setView('backlog')
  }
  return {
    view,
    setView,
    planningStep,
    setPlanningStep,
    weeklyStep,
    setWeeklyStep,
    taskScope,
    setTaskScope,
    navigationOpen,
    homeWeekStartRequest,
    homeTodayFocusRequest,
    activeTitle,
    rightPaneKey,
    rightPanelOpen,
    updateRightPanelOpen,
    updateNavigationOpen,
    handleToggleNavigation,
    rightPanelAvailable,
    activeRightPane,
    selectRightPane,
    handleAppContentClickCapture,
    navigate,
    openTaskScope,
  }
}

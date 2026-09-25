import { useWorkspaceTaskActions } from '../hooks/useWorkspaceTaskActions.js'
import { useWorkspaceCollections } from '../hooks/useWorkspaceCollections.js'

import { useLayoutEffect, useRef, useState } from 'react'
import { CalendarBlank, Lightning, SidebarSimple, Stack, PushPin, X } from '@phosphor-icons/react'

import { useAutoSchedule } from './AutoScheduleAnimation'

import { CURRENT_DATE_KEY, calendarDaysAround, dateFromKey } from '../utils/dates'

import { CalendarPane } from './CalendarPanel'

import { DateControl } from './TopControls'

import { BoardPane } from './right-panel/BoardPane.jsx'
import { ObjectivesPane } from './right-panel/ObjectivesPane.jsx'
import { BacklogPane } from './right-panel/BacklogPane.jsx'
import { LatestUpdatesPane } from './right-panel/LatestUpdatesPane.jsx'
const RIGHT_PANEL_PANES = [
  { id: 'calendar', label: 'Calendar', icon: CalendarBlank },
  { id: 'board', label: 'Board', icon: SidebarSimple },
  { id: 'objectives', label: 'Projects', icon: PushPin },
  { id: 'backlog', label: 'Tasks', icon: Stack },
  { id: 'latest-updates', label: 'Latest Updates', icon: Lightning },
]

export function RightPanel({
  activePane,
  onPaneChange,
  tasks = [],
  dateKey = CURRENT_DATE_KEY,
  onFocusObjectiveInWeek,
  weeklyFocusedObjectives,
  setWeeklyFocusedObjectives,
  visibleTaskIds,
  selectedAreaIds = [],
  availableDateKeys,
  onDateChange,
  calendarFocusRequest,
  calendarOnly = false,
  showWorkflowStatus = true,
}) {
  const {
    onCreateBoardTask,
    onCreateCalendarSession,
    onCreateCalendarTask,
    onCompleteUndatedTask,
    onAssignObjective,
    onQuickSchedule,
    onUnscheduleTask,
    onOpenObjective,
    onOpenTask,
  } = useWorkspaceTaskActions()

  const {
    areas,
    datedTasksByDate,
    events,
    setEvents,
    objectives,
    setObjectives,
    backlogGroups,
    rightPanelUnavailableTaskIds: unavailableTaskIds,
  } = useWorkspaceCollections()

  const tabRefs = useRef([])
  const autoSchedule = useAutoSchedule()
  const handledAutoScheduleRef = useRef(null)
  const handledCalendarFocusRef = useRef(null)
  const [autoScheduleRevealed, setAutoScheduleRevealed] = useState(false)
  const [fallbackDateKey, setFallbackDateKey] = useState(dateKey)
  const activeDefinition = calendarOnly
    ? RIGHT_PANEL_PANES[0]
    : RIGHT_PANEL_PANES.find((pane) => pane.id === activePane) || RIGHT_PANEL_PANES[0]
  const resolvedActivePane = activeDefinition.id
  const resolvedDateKey = onDateChange ? dateKey : fallbackDateKey
  const resolvedAvailableDateKeys = availableDateKeys?.length
    ? availableDateKeys
    : calendarDaysAround(dateKey || CURRENT_DATE_KEY).map((day) => day.dateKey)
  const changeDate = onDateChange || setFallbackDateKey
  useLayoutEffect(() => {
    if (!autoSchedule || handledAutoScheduleRef.current === autoSchedule) return
    handledAutoScheduleRef.current = autoSchedule
    setAutoScheduleRevealed(true)
    changeDate(autoSchedule.dateKey)
  }, [autoSchedule, changeDate])
  useLayoutEffect(() => {
    if (!calendarFocusRequest || handledCalendarFocusRef.current === calendarFocusRequest) return
    handledCalendarFocusRef.current = calendarFocusRequest
    setAutoScheduleRevealed(true)
    changeDate(calendarFocusRequest.dateKey)
  }, [calendarFocusRequest, changeDate])
  const resolvedTasks = resolvedDateKey === CURRENT_DATE_KEY ? tasks : datedTasksByDate[resolvedDateKey] || []
  const resolvedVisibleTaskIds = resolvedDateKey === dateKey ? visibleTaskIds : null
  const selectedDateLabel = dateFromKey(resolvedDateKey).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  })
  const dateToolbarContent = (
    <DateControl
      className="day-summary-current"
      dateKey={resolvedDateKey}
      dateLabel={resolvedDateKey === CURRENT_DATE_KEY ? 'Today' : selectedDateLabel}
      availableDateKeys={resolvedAvailableDateKeys}
      onDateChange={changeDate}
      showAdjacentControls
    />
  )

  const selectPane = (paneId, focusIndex) => {
    onPaneChange?.(paneId)
    if (focusIndex !== undefined) tabRefs.current[focusIndex]?.focus()
  }

  const handleRailKeyDown = (event) => {
    const tab = event.target.closest?.('[role="tab"]')
    if (!tab) return
    const currentIndex = Number(tab.dataset.index)
    let nextIndex

    if (event.key === 'ArrowUp')
      nextIndex = (currentIndex - 1 + RIGHT_PANEL_PANES.length) % RIGHT_PANEL_PANES.length
    else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % RIGHT_PANEL_PANES.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = RIGHT_PANEL_PANES.length - 1
    else return

    event.preventDefault()
    selectPane(RIGHT_PANEL_PANES[nextIndex].id, nextIndex)
  }

  const renderPane = (paneId) => {
    switch (paneId) {
      case 'calendar':
        return (
          <CalendarPane
            areas={areas}
            events={events}
            removingEvent={autoSchedule?.kind === 'unschedule' ? autoSchedule.calendarEvent : null}
            setEvents={setEvents}
            tasks={resolvedTasks}
            dateKey={resolvedDateKey}
            focusRequest={calendarFocusRequest}
            toolbarContent={calendarOnly ? null : dateToolbarContent}
            selectedAreaIds={selectedAreaIds}
            visibleTaskIds={resolvedVisibleTaskIds}
            onCreateSession={onCreateCalendarSession}
            onCreateTask={onCreateCalendarTask}
            onOpenTask={onOpenTask}
          />
        )
      case 'board':
        return (
          <BoardPane
            showWorkflowStatus={showWorkflowStatus}
            tasks={resolvedTasks}
            setEvents={setEvents}
            setObjectives={setObjectives}
            objectives={objectives}
            dateKey={resolvedDateKey}
            onCreateBoardTask={onCreateBoardTask}
            onAssignObjective={onAssignObjective}
            onQuickSchedule={onQuickSchedule}
            onUnscheduleTask={onUnscheduleTask}
            onOpenTask={onOpenTask}
            selectedAreaIds={selectedAreaIds}
            visibleTaskIds={resolvedVisibleTaskIds}
            toolbarContent={dateToolbarContent}
          />
        )
      case 'objectives':
        return (
          <ObjectivesPane
            areas={areas}
            objectives={objectives}
            setObjectives={setObjectives}
            onFocusObjectiveInWeek={onFocusObjectiveInWeek}
            onOpenObjective={onOpenObjective}
            weeklyFocusedObjectives={weeklyFocusedObjectives}
            setWeeklyFocusedObjectives={setWeeklyFocusedObjectives}
            toolbarContent={dateToolbarContent}
          />
        )
      case 'backlog':
        return (
          <BacklogPane
            areas={areas}
            groups={backlogGroups}
            objectives={objectives}
            onCompleteUndatedTask={onCompleteUndatedTask}
            onOpenObjective={onOpenObjective}
            onOpenTask={onOpenTask}
            setObjectives={setObjectives}
            unavailableTaskIds={unavailableTaskIds}
            weeklyFocusedObjectives={weeklyFocusedObjectives}
            toolbarContent={dateToolbarContent}
          />
        )
      case 'latest-updates':
        return <LatestUpdatesPane toolbarContent={dateToolbarContent} />
      default:
        return null
    }
  }

  return (
    <aside
      id="right-panel"
      className={`calendar-panel right-panel right-panel-${resolvedActivePane}${calendarOnly ? ' today-calendar-only' : ''}${autoScheduleRevealed && !calendarOnly ? ' auto-schedule-revealed' : ''}`}
      aria-label={`${activeDefinition.label} panel`}
    >
      {autoScheduleRevealed && !calendarOnly ? (
        <button
          className="icon-button auto-schedule-panel-close"
          aria-label="Close scheduled calendar"
          type="button"
          onClick={() => setAutoScheduleRevealed(false)}
        >
          <X size={16} />
        </button>
      ) : null}
      {!calendarOnly ? (
        <div
          className="calendar-rail"
          role="tablist"
          aria-label="Right panel"
          aria-orientation="vertical"
          onKeyDown={handleRailKeyDown}
        >
          {RIGHT_PANEL_PANES.map(({ id, label, icon: Icon }, index) => {
            const active = id === resolvedActivePane
            return (
              <button
                ref={(element) => {
                  tabRefs.current[index] = element
                }}
                className={`rail-button ${active ? 'active' : ''}`}
                id={`right-panel-tab-${id}`}
                key={id}
                type="button"
                role="tab"
                aria-label={label}
                aria-selected={active}
                aria-controls={`right-panel-pane-${id}`}
                data-index={index}
                data-tooltip={label}
                tabIndex={active ? 0 : -1}
                onClick={() => selectPane(id)}
              >
                <Icon size={17} />
              </button>
            )
          })}
        </div>
      ) : null}
      {(calendarOnly ? [RIGHT_PANEL_PANES[0]] : RIGHT_PANEL_PANES).map((pane) => {
        const active = pane.id === resolvedActivePane
        return (
          <section
            className={`right-panel-pane right-panel-pane-${pane.id}`}
            id={`right-panel-pane-${pane.id}`}
            key={pane.id}
            role={calendarOnly ? 'region' : 'tabpanel'}
            aria-label={calendarOnly ? 'Calendar' : undefined}
            aria-labelledby={calendarOnly ? undefined : `right-panel-tab-${pane.id}`}
            hidden={!active}
            tabIndex={0}
          >
            {active ? renderPane(pane.id) : null}
          </section>
        )
      })}
    </aside>
  )
}

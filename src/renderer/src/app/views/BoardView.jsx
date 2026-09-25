import { useWorkspaceTaskActions } from '../hooks/useWorkspaceTaskActions.js'
import { useWorkspaceCollections } from '../hooks/useWorkspaceCollections.js'
import { toggleTaskSubtask } from '../../desktop/workspace-actions'
import { toggleTaskCompletion } from '../../desktop/workspace-actions'
import { useLayoutEffect, useRef, useState } from 'react'
import { InlineTaskStack } from '../components/InlineTaskStack'

import { CURRENT_DATE_KEY, calendarDaysAround, dateFromKey } from '../utils/dates'
import { filterItemsByArea } from '../utils/areas'
import { lockBoardScrollAxis } from '../utils/boardScroll'
import { RightPanel } from '../components/RightPanel'
import { SortableTaskLane } from '../components/SortableTaskLane'
import { TaskCard } from '../components/TaskCard'
import { ProjectProgressCircle } from '../components/ProjectProgressCircle'
import { TopControls } from '../components/TopControls'
import { WeekCalendarView, weekDateKeysFor, weekDateLabel } from './WeekCalendarView'
import { todayBoardStatus } from '../../../../domain/today-board'

const TODAY_BOARD_COLUMNS = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'to-review', label: 'To Review' },
  { id: 'done', label: 'Done' },
]

function BoardDayColumn({
  column,
  boardSurfaceId,
  singleDay,
  todayStatus,
  onCreateBoardTask,
  onToggle,
  onToggleSubtask,
  onAssignObjective,
  onOpenTask,
  onQuickSchedule,
  onUnscheduleTask,
  projects,
}) {
  return (
    <SortableTaskLane
      boardSurfaceId={boardSurfaceId}
      dateKey={column.dateKey}
      todayStatus={todayStatus}
      tasks={column.tasks}
      allTasks={column.allTasks}
      className={`day-column ${column.active ? 'active-day' : ''} ${singleDay ? 'today-status-column' : ''} ${!singleDay && column.dateKey < CURRENT_DATE_KEY ? 'past-day' : ''}`}
    >
      {({ taskBoardProps }) => {
        const taskCards = column.tasks.map((task, visibleIndex) => (
          <TaskCard
            key={task.id}
            task={task}
            projects={projects}
            {...taskBoardProps(task, visibleIndex)}
            onToggle={onToggle}
            onToggleSubtask={onToggleSubtask}
            onAssignObjective={onAssignObjective}
            onOpen={onOpenTask}
            onUnschedule={onUnscheduleTask}
            onSchedule={
              onQuickSchedule ? (source) => onQuickSchedule(task, column.dateKey, source) : undefined
            }
          />
        ))
        return (
          <>
            <header>
              <h2>
                {todayStatus
                  ? TODAY_BOARD_COLUMNS.find((item) => item.id === todayStatus)?.label
                  : column.day}
              </h2>
              <p>{column.date}</p>
              {column.active && !singleDay ? (
                <span
                  className="day-progress"
                  role="progressbar"
                  aria-label="Today task completion"
                  aria-valuemin={0}
                  aria-valuemax={column.tasks.length || 1}
                  aria-valuenow={column.tasks.filter((task) => task.complete).length}
                >
                  <span
                    style={{
                      width: `${column.tasks.length ? (column.tasks.filter((task) => task.complete).length / column.tasks.length) * 100 : 0}%`,
                    }}
                  />
                </span>
              ) : null}
            </header>
            <InlineTaskStack
              dateKey={column.dateKey}
              firstTaskId={column.tasks[0]?.id}
              onCreateTask={(draft) => onCreateBoardTask({ ...draft, todayStatus })}
            >
              {taskCards}
            </InlineTaskStack>
          </>
        )
      }}
    </SortableTaskLane>
  )
}

export function BoardView({
  weekStartRequest = 0,
  todayFocusRequest = 0,
  activeRightPane,
  onRightPaneChange,
  onWorkspaceViewChange,
  singleDay = false,
}) {
  const {
    onCreateBoardTask,
    onCreateCalendarSession,
    onCompleteUndatedTask,
    onAssignObjective,
    onQuickSchedule,
    onUnscheduleTask,
    onOpenObjective,
    onOpenTask,
  } = useWorkspaceTaskActions()

  const {
    areas,
    boardTasksByDate,
    events,
    setEvents,
    objectives,
    setObjectives,
    weeklyFocusedObjectives,
    setWeeklyFocusedObjectives,
    rightPanelUnavailableTaskIds,
    backlogGroups,
  } = useWorkspaceCollections()

  const boardColumnsRef = useRef(null)
  const boardFocusLockRef = useRef(null)
  const [selectedDateKey, setSelectedDateKey] = useState(CURRENT_DATE_KEY)
  const [selectedAreaIds, setSelectedAreaIds] = useState([])
  const [workspaceView, setWorkspaceView] = useState('board')
  const [calendarAnchor, setCalendarAnchor] = useState(CURRENT_DATE_KEY)
  const calendarDays = calendarDaysAround(calendarAnchor)
  const availableDateKeys = calendarDays.map((day) => day.dateKey)
  const selectedWeekDateKeys = weekDateKeysFor(selectedDateKey)

  const toggle = toggleTaskCompletion
  const toggleSubtask = (taskId, subtaskId) => toggleTaskSubtask(taskId, subtaskId)

  const columns = (
    singleDay ? calendarDays.filter((day) => day.dateKey === selectedDateKey) : calendarDays
  ).map((day) => {
    const allDayTasks = boardTasksByDate[day.dateKey] || []
    const dayTasks = filterItemsByArea(allDayTasks, selectedAreaIds, areas)

    return {
      ...day,
      tasks: dayTasks,
      allTasks: allDayTasks,
      active: day.dateKey === CURRENT_DATE_KEY,
    }
  })
  const selectedColumn = columns.find((column) => column.dateKey === selectedDateKey) || columns[0]
  const todayColumns = singleDay
    ? TODAY_BOARD_COLUMNS.map(({ id, label }) => {
        const dayTasks = selectedColumn.allTasks
        const tasksForStatus = dayTasks.filter((task) => todayBoardStatus(task) === id)
        return {
          ...selectedColumn,
          id,
          label,
          tasks: filterItemsByArea(tasksForStatus, selectedAreaIds, areas),
          allTasks: dayTasks,
        }
      })
    : null
  const boardSurfaceId = singleDay ? 'today-board' : 'home-board'

  const jumpToTodayStatus = (statusId) => {
    const boardColumns = boardColumnsRef.current
    const lane = boardColumns?.querySelector(`[data-today-status="${statusId}"]`)
    if (!boardColumns || !lane) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    boardColumns.scrollTo({
      left: lane.offsetLeft - boardColumns.offsetLeft,
      behavior: reducedMotion ? 'instant' : 'smooth',
    })
  }

  const selectDate = (nextDateKey) => {
    if (!availableDateKeys.includes(nextDateKey)) {
      setCalendarAnchor(nextDateKey)
      setSelectedDateKey(nextDateKey)
      return
    }
    setSelectedDateKey(nextDateKey)
    if (singleDay) return

    const boardColumns = boardColumnsRef.current
    const firstColumn = boardColumns?.querySelector('.day-column')
    if (!boardColumns || !firstColumn) return
    const nextIndex = availableDateKeys.indexOf(nextDateKey)
    boardFocusLockRef.current = {
      dateKey: nextDateKey,
      scrollLeft: nextIndex * firstColumn.offsetWidth,
    }
    boardColumns.scrollTo({
      left: nextIndex * firstColumn.offsetWidth,
      behavior: 'instant',
    })
  }

  const selectWorkspaceView = (nextView) => {
    setWorkspaceView(nextView)
    onRightPaneChange?.(nextView === 'week-calendar' ? 'board' : 'calendar')
    onWorkspaceViewChange?.(nextView)
  }

  useLayoutEffect(() => {
    if (singleDay || workspaceView !== 'board' || !boardColumnsRef.current) return
    return lockBoardScrollAxis(boardColumnsRef.current)
  }, [singleDay, workspaceView])

  useLayoutEffect(() => {
    if (singleDay || workspaceView !== 'board') return
    const boardColumns = boardColumnsRef.current
    const firstColumn = boardColumns?.querySelector('.day-column')
    if (!boardColumns || !firstColumn) return
    const selectedDayIndex = calendarDays.findIndex((day) => day.dateKey === selectedDateKey)
    boardColumns.scrollTo({ left: selectedDayIndex * firstColumn.offsetWidth, behavior: 'instant' })
  }, [singleDay, workspaceView, calendarAnchor])

  useLayoutEffect(() => {
    if (singleDay || !weekStartRequest) return
    const boardColumns = boardColumnsRef.current
    const firstColumn = boardColumns?.querySelector('.day-column')
    if (!boardColumns || !firstColumn) return

    const currentDayIndex = columns.findIndex((day) => day.dateKey === CURRENT_DATE_KEY)
    const currentDay = dateFromKey(CURRENT_DATE_KEY)
    const mondayOffset = (currentDay.getDay() + 6) % 7
    const mondayIndex = Math.max(0, currentDayIndex - mondayOffset)
    const mondayScrollLeft = mondayIndex * firstColumn.offsetWidth

    boardFocusLockRef.current = {
      dateKey: CURRENT_DATE_KEY,
      scrollLeft: mondayScrollLeft,
    }
    boardColumns.scrollTo({
      left: mondayScrollLeft,
      behavior: 'instant',
    })
    setSelectedDateKey(CURRENT_DATE_KEY)
  }, [singleDay, weekStartRequest])

  useLayoutEffect(() => {
    if (singleDay || !todayFocusRequest) return
    const boardColumns = boardColumnsRef.current
    const firstColumn = boardColumns?.querySelector('.day-column')
    if (!boardColumns || !firstColumn) return

    const currentDayIndex = columns.findIndex((day) => day.dateKey === CURRENT_DATE_KEY)
    boardFocusLockRef.current = null
    boardColumns.scrollTo({
      left: currentDayIndex * firstColumn.offsetWidth,
      behavior: 'instant',
    })
    setSelectedDateKey(CURRENT_DATE_KEY)
  }, [singleDay, todayFocusRequest])

  const syncCalendarToLeftmostDay = (event) => {
    if (singleDay) return
    const boardColumns = event.currentTarget
    const focusLock = boardFocusLockRef.current
    if (focusLock && Math.abs(boardColumns.scrollLeft - focusLock.scrollLeft) < 1) {
      setSelectedDateKey(focusLock.dateKey)
      return
    }
    boardFocusLockRef.current = null
    const firstColumn = boardColumns.querySelector('.day-column')
    if (!firstColumn) return
    const columnWidth = firstColumn.offsetWidth
    const firstVisibleIndex = Math.floor(boardColumns.scrollLeft / columnWidth)
    const clippedWidth = boardColumns.scrollLeft - firstVisibleIndex * columnWidth
    const visibleWidth = columnWidth - clippedWidth
    const thresholdIndex = visibleWidth >= columnWidth / 2 ? firstVisibleIndex : firstVisibleIndex + 1
    const dayIndex = Math.max(0, Math.min(columns.length - 1, thresholdIndex))
    const nextDateKey = columns[dayIndex]?.dateKey
    if (nextDateKey) setSelectedDateKey((current) => (current === nextDateKey ? current : nextDateKey))
  }

  const board = (
    <section className={`board-surface ${singleDay ? 'single-day' : ''}`}>
      {!singleDay ? (
        <TopControls
          dateKey={selectedDateKey}
          availableDateKeys={availableDateKeys}
          onDateChange={selectDate}
          areas={areas}
          selectedAreaIds={selectedAreaIds}
          onAreaFilterChange={setSelectedAreaIds}
          viewMode={workspaceView}
          onViewModeChange={selectWorkspaceView}
        />
      ) : null}
      <div
        className="board-columns"
        ref={boardColumnsRef}
        onScroll={syncCalendarToLeftmostDay}
        data-board-scroll-container="true"
      >
        {(singleDay ? todayColumns : columns).map((column) => (
          <BoardDayColumn
            key={singleDay ? column.id : column.dateKey}
            column={column}
            boardSurfaceId={boardSurfaceId}
            singleDay={singleDay}
            todayStatus={singleDay ? column.id : undefined}
            onCreateBoardTask={onCreateBoardTask}
            onToggle={toggle}
            onToggleSubtask={toggleSubtask}
            onAssignObjective={onAssignObjective}
            onOpenTask={onOpenTask}
            onQuickSchedule={onQuickSchedule}
            onUnscheduleTask={onUnscheduleTask}
            projects={objectives}
          />
        ))}
        {!singleDay ? <div className="board-scroll-tail" aria-hidden="true" /> : null}
      </div>
    </section>
  )

  if (singleDay) {
    return (
      <div className="surface-row today-layout">
        <TopControls
          showAdjacentControls
          todayStatuses={todayColumns}
          onTodayStatusSelect={jumpToTodayStatus}
          todayTasks={selectedColumn.tasks}
          dateKey={selectedDateKey}
          availableDateKeys={availableDateKeys}
          onDateChange={selectDate}
          areas={areas}
          selectedAreaIds={selectedAreaIds}
          onAreaFilterChange={setSelectedAreaIds}
        />
        <div className="today-workspace">
          <RightPanel
            calendarOnly
            selectedAreaIds={selectedAreaIds}
            activePane="calendar"
            tasks={selectedColumn.allTasks}
            dateKey={selectedColumn.dateKey}
            availableDateKeys={availableDateKeys}
            onDateChange={selectDate}
            visibleTaskIds={selectedAreaIds.length ? selectedColumn.tasks.map((task) => task.id) : null}
          />
          {board}
        </div>
      </div>
    )
  }

  const mainSurface =
    workspaceView === 'week-calendar' ? (
      <section className="week-calendar-surface" aria-label="Week calendar view">
        <TopControls
          dateKey={selectedDateKey}
          dateDisplayLabel={weekDateLabel(selectedWeekDateKeys)}
          availableDateKeys={availableDateKeys}
          onDateChange={selectDate}
          areas={areas}
          selectedAreaIds={selectedAreaIds}
          onAreaFilterChange={setSelectedAreaIds}
          viewMode={workspaceView}
          onViewModeChange={selectWorkspaceView}
        />
        <WeekCalendarView
          selectedAreaIds={selectedAreaIds}
          selectedDateKey={selectedDateKey}
          availableDateKeys={availableDateKeys}
          onDateChange={selectDate}
        />
      </section>
    ) : (
      board
    )

  return (
    <div className="surface-row">
      {mainSurface}
      <RightPanel
        selectedAreaIds={selectedAreaIds}
        activePane={activeRightPane}
        onPaneChange={onRightPaneChange}
        tasks={selectedColumn.allTasks}
        dateKey={selectedColumn.dateKey}
        availableDateKeys={availableDateKeys}
        onDateChange={selectDate}
        visibleTaskIds={selectedAreaIds.length ? selectedColumn.tasks.map((task) => task.id) : null}
        weeklyFocusedObjectives={weeklyFocusedObjectives}
        setWeeklyFocusedObjectives={setWeeklyFocusedObjectives}
      />
    </div>
  )
}

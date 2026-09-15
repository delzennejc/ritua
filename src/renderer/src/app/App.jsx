import { WorkspaceTaskActionsContext } from './hooks/useWorkspaceTaskActions.js'
import { useWorkspaceNavigation } from './hooks/useWorkspaceNavigation.js'
import { dispatchTaskDetailCommand } from '../desktop/workspace-actions'
import { useWorkspaceProjection } from '../desktop/workspace-store'
import { updateCalendarEvents as setEvents } from '../desktop/workspace-actions'
import { dispatchTaskCommand } from '../desktop/workspace-actions'
import { useTaskScheduling } from './hooks/useTaskScheduling.js'
import { useTaskDetailsActions } from './hooks/useTaskDetailsActions.js'

import { useProjectActions } from './hooks/useProjectActions.js'
import { useTaskCreation } from './hooks/useTaskCreation.js'
import { useAreaActions } from './hooks/useAreaActions.js'

import { useDetailsNavigation } from './hooks/useDetailsNavigation.js'
import { useWorkspaceDrag } from './interactions/useWorkspaceDrag.js'
import {
  getWorkspaceFields,
  getWorkspaceDocument,
  useWorkspaceState,
  replaceWorkspaceDocument,
} from '../desktop/workspace-store'
import {
  DEFAULT_AREAS,
  DEFAULT_TASKS,
  DEFAULT_BACKLOG_GROUPS,
  DEFAULT_PROJECTS,
  DEFAULT_EVENTS,
} from '../../../domain/workspace-defaults'
import { nextScheduledOccurrences, upcomingScheduledTasks } from '../../../domain/tasks'
import { reorderProjectSubset } from '../../../domain/backlog-organization'
import { objectiveChannel } from './utils/workspace-presenters.js'
import { useState, useCallback, useRef, useMemo } from 'react'
import { CURRENT_DATE_KEY, previousWeekDays, mondayOf } from './utils/dates'
import { reportActionError } from '../desktop/ActionErrors'

import { minutesLabel } from './utils/time'

import { AutoScheduleAnimation } from './components/AutoScheduleAnimation'

import { CalendarSessionsProvider } from './components/CalendarSessions'
import { AreaFoldersProvider } from './components/FolderLabel'
import { TaskAreaActionsProvider } from './components/TaskAreaAction'
import { DragDropProvider, DragOverlay } from '@dnd-kit/react'
import { configureDndPlugins, configureDndSensors } from './interactions/drag-config.js'
import { TaskReorderAnimator } from './components/TaskReorderAnimator'
import { RituaMenu } from './components/RituaMenu'
import { NavigationToggle, RightPanelToggle } from './components/TopControls'
import { BoardView } from './views/BoardView'
import { BacklogView } from './views/BacklogView'
import { DailyPlanningView } from './views/daily-planning/DailyPlanningView'
import { WeeklyPlanningView } from './views/weekly-planning/WeeklyPlanningView'
import { completeWeeklyPlanning } from '../../../domain/planning-entry'
import { AddTaskForm } from './components/AddTaskForm'
import { ScheduleTaskDialog } from './components/ScheduleTaskDialog'
import { ObjectiveDetails } from './components/ObjectiveDetails'
import { AreaDetails } from './components/AreaDetails'
import { TaskDetails } from './components/TaskDetails'
import { UndoSnackbar } from './components/UndoSnackbar'
import { DndPreview } from './interactions/DragPreview.jsx'

export function App() {
  const [accomplishedObjectives] = useWorkspaceState('weekly.accomplishedObjectives', [])
  const [areas, setAreas] = useWorkspaceState('areas', DEFAULT_AREAS)

  const [dailyCompletedDate, setDailyCompletedDate] = useWorkspaceState('daily.completedDate', null)
  const [weeklyCompletedWeek] = useWorkspaceState('weekly.completedWeek', null)

  const tasks = useWorkspaceProjection('tasks', DEFAULT_TASKS)
  const datedTasksByDate = useWorkspaceProjection('datedTasksByDate', {})
  const backlogGroups = useWorkspaceProjection('backlogGroups', DEFAULT_BACKLOG_GROUPS)
  const [weeklyObjectives, setWeeklyObjectives] = useWorkspaceState('weeklyObjectives', DEFAULT_PROJECTS)
  const [, setWeeklyObjectiveOrder] = useWorkspaceState('weeklyObjectiveOrder', () =>
    DEFAULT_PROJECTS.filter((objective) => objective.focusedThisWeek !== false).map(
      (objective) => objective.id,
    ),
  )

  const events = useWorkspaceProjection('events', DEFAULT_EVENTS)
  const [addingTask, setAddingTask] = useState(null)

  const [pendingScheduleDrop, setPendingScheduleDrop] = useState(null)
  // Keep the original callback contract without prototype-only action notices.
  const setToast = useCallback(() => {}, [])
  const [autoScheduleRequest, setAutoScheduleRequest] = useState(null)
  const finishAutoSchedule = useCallback((request) => {
    setAutoScheduleRequest((current) => (current === request ? null : current))
  }, [])
  const {
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
  } = useWorkspaceNavigation({ areas, weeklyObjectives, autoScheduleRequest, finishAutoSchedule })

  const [taskDeletionUndo, setTaskDeletionUndo] = useState(null)
  const [projectActionUndo, setProjectActionUndo] = useState(null)
  const [taskAreaUndo, setTaskAreaUndo] = useState(null)
  const taskAreaRevisionRef = useRef(0)

  const boardStateRef = useRef({ tasks, datedTasksByDate })

  const taskDeletionRevisionRef = useRef(0)
  const projectActionRevisionRef = useRef(0)
  boardStateRef.current = { tasks, datedTasksByDate }
  const scheduledBacklogTasks = useMemo(
    () => nextScheduledOccurrences(upcomingScheduledTasks(tasks, datedTasksByDate, CURRENT_DATE_KEY)),
    [datedTasksByDate, tasks],
  )
  const weeklyCompletedDays = previousWeekDays(CURRENT_DATE_KEY).map((day) => ({
    ...day,
    tasks: datedTasksByDate[day.dateKey] || [],
  }))

  const {
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
  } = useDetailsNavigation({
    weeklyObjectives,
    areas,
    tasks,
    datedTasksByDate,
    backlogGroups,
    events,
    accomplishedObjectives,
    setAddingTask,
  })

  const taskLayoutRevision = useMemo(() => {
    const completionRevision = [
      ...tasks,
      ...Object.values(datedTasksByDate).flat(),
      ...backlogGroups.flatMap((group) => group.items),
      ...weeklyObjectives.flatMap((objective) => objective.tasks || []),
    ]
      .map((task) => `${task.taskId || task.id}:${task.complete ? 1 : 0}`)
      .join('|')

    return [
      view,
      taskScope,
      activeRightPane,
      activeObjectiveId || '',
      activeTaskId || '',
      planningStep,
      weeklyStep,
      navigationOpen ? 1 : 0,
      rightPanelOpen ? 1 : 0,
      completionRevision,
    ].join('::')
  }, [
    activeObjectiveId,
    activeRightPane,
    activeTaskId,
    backlogGroups,
    datedTasksByDate,
    navigationOpen,
    planningStep,
    rightPanelOpen,
    taskScope,
    tasks,
    view,
    weeklyObjectives,
    weeklyStep,
  ])

  const {
    createAreaProject,
    createArea,
    moveArea,
    restoreAreaOrder,
    publishActionDocument,
    changeAreaColorFromDetails,
    renameAreaFromDetails,
    archiveAreaFromDetails,
    deleteAreaFromDetails,
  } = useAreaActions({
    setWeeklyObjectives,
    setToast,
    areas,
    setAreas,
    setTaskScope,
    setView,
    boardStateRef,
    setActiveAreaId,
    setPendingScheduleDrop,
  })

  const { openAddTask, addTask, createBoardTask, createCalendarSessionFromSelection } = useTaskCreation({
    setAddingTask,
    areas,
    setToast,
  })

  const assignTaskToWeeklyObjective = (task, objectiveId) => {
    const channel = objectiveChannel(task.channel)
    const objective = objectiveId ? weeklyObjectives.find((item) => item.id === objectiveId) : null

    if (objective && (objective.complete || objectiveChannel(objective.channel) !== channel)) {
      reportActionError(`Choose an active project in ${channel}.`)
      return
    }

    if ((task.objectiveId || null) === (objective?.id || null)) return

    dispatchTaskCommand({ type: 'task.assign', taskId: task.id, projectId: objective?.id || null })
    setToast(
      objective
        ? `${task.title} added to ${objective.title}.`
        : `${task.title} is no longer linked to a project.`,
    )
  }

  const completeUndatedTaskToday = (taskId, { activityEntry } = {}) => {
    const sourceTask = backlogGroups.flatMap((group) => group.items).find((task) => task.id === taskId)
    if (!sourceTask || sourceTask.complete) return false

    const minutes = Number.isFinite(sourceTask.minutes) && sourceTask.minutes > 0 ? sourceTask.minutes : 15
    const fields = dispatchTaskCommand({ type: 'task.complete-undated', taskId, activity: activityEntry })
    boardStateRef.current = getWorkspaceFields()
    setToast(`${sourceTask.title} completed today · ${minutesLabel(minutes)}.`)
    return true
  }

  const {
    updateObjectiveFromDetails,
    addObjectiveCommentFromDetails,
    toggleObjectiveFromDetails,
    removeObjectiveFromWeekFromDetails,
    moveProjectOutOfActiveDetails,
    undoProjectAction,
    toggleObjectiveTaskFromDetails,
    addObjectiveTaskFromDetails,
  } = useProjectActions({
    setWeeklyObjectives,
    tasks,
    datedTasksByDate,
    backlogGroups,
    areas,
    weeklyObjectives,
    setToast,
    setWeeklyObjectiveOrder,
    publishActionDocument,
    closeObjectiveDetails,
    projectActionRevisionRef,
    setTaskDeletionUndo,
    setTaskAreaUndo,
    setProjectActionUndo,
    projectActionUndo,
    activeObjective,
    completeUndatedTaskToday,
  })

  const {
    updateTaskFromDetails,
    moveTaskToArea,
    undoTaskAreaMove,
    updateTaskRecurrenceFromDetails,
    toggleTaskFromDetails,
    deleteTaskFromDetails,
    undoTaskDeletion,
    toggleScheduledTaskFromBacklog,
    toggleSubtaskFromDetails,
    updateSubtaskFromDetails,
    addSubtaskFromDetails,
    addCommentFromDetails,
  } = useTaskDetailsActions({
    areas,
    boardStateRef,
    setToast,
    setTaskDeletionUndo,
    setProjectActionUndo,
    taskAreaRevisionRef,
    setTaskAreaUndo,
    taskAreaUndo,
    setActiveTaskId,
    activeTask,
    completeUndatedTaskToday,
    pendingScheduleDrop,
    setPendingScheduleDrop,
    objectiveDetailsTaskFocusIdRef,
    closeTaskDetails,
    taskDeletionRevisionRef,
    taskDeletionUndo,
  })

  const {
    moveBoardTask,

    promoteBacklogTask,
    scheduleBacklogTaskFromDrop,
    moveTaskToBacklog,
    scheduleTaskFromDetails,
    scheduleTaskAtFirstAvailableTime,
    removeTaskSchedule,
  } = useTaskScheduling({
    boardStateRef,
    backlogGroups,
    areas,
    setToast,
    pendingScheduleDrop,
    weeklyObjectives,
    setPendingScheduleDrop,
    activeTask,
    autoScheduleRequest,
    events,
    setAutoScheduleRequest,
    rightPaneKey,
    updateRightPanelOpen,
    selectRightPane,
  })

  const { dragPreviewPresentation, handleDragStart, handleDragOver, handleDragMove, handleDragEnd } =
    useWorkspaceDrag({
      boardStateRef,

      moveBoardTask,
      setEvents,
      weeklyObjectives,

      setToast,
      moveTaskToBacklog,
      setPendingScheduleDrop,
      promoteBacklogTask,
    })

  const taskActions = {
    onAddTask: openAddTask,
    onCreateBoardTask: createBoardTask,
    onCreateCalendarSession: createCalendarSessionFromSelection,
    onCompleteUndatedTask: completeUndatedTaskToday,
    onAssignObjective: assignTaskToWeeklyObjective,
    onQuickSchedule: scheduleTaskAtFirstAvailableTime,
    onUnscheduleTask: removeTaskSchedule,
    onOpenObjective: openObjectiveDetails,
    onOpenTask: openTaskDetails,
  }
  return (
    <WorkspaceTaskActionsContext.Provider value={taskActions}>
      <CalendarSessionsProvider onOpenTask={openTaskDetails}>
        <AreaFoldersProvider areas={areas}>
          <TaskAreaActionsProvider areas={areas} projects={weeklyObjectives} onMove={moveTaskToArea}>
            <DragDropProvider
              plugins={configureDndPlugins}
              sensors={configureDndSensors}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <TaskReorderAnimator revision={taskLayoutRevision} events={events} />
              <AutoScheduleAnimation
                request={autoScheduleRequest?.pageKey === rightPaneKey ? autoScheduleRequest : null}
                onFinish={finishAutoSchedule}
              >
                <main className="app-window" aria-label={`${activeTitle}`}>
                  <div
                    className={`app-shell${!navigationOpen ? ' navigation-collapsed' : ''}${!rightPanelOpen ? ' right-panel-collapsed' : ''}`}
                    data-view={view}
                  >
                    <div
                      className="app-workspace"
                      aria-hidden={
                        activeTask || activeObjective || activeAreaDetails || pendingScheduleDrop
                          ? 'true'
                          : undefined
                      }
                      inert={
                        activeTask || activeObjective || activeAreaDetails || pendingScheduleDrop
                          ? true
                          : undefined
                      }
                    >
                      {navigationOpen ? (
                        <RituaMenu
                          areas={areas}
                          view={view}
                          taskScope={taskScope}
                          objectives={weeklyObjectives}
                          dailyComplete={dailyCompletedDate === CURRENT_DATE_KEY}
                          weeklyComplete={weeklyCompletedWeek === mondayOf(CURRENT_DATE_KEY)}
                          onCreateArea={createArea}
                          onCreateAreaProject={createAreaProject}
                          onNavigate={navigate}
                          onOpenTaskScope={openTaskScope}
                          onReorderArea={moveArea}
                          onRestoreAreaOrder={restoreAreaOrder}
                          onReorderProject={(projectIds, move) =>
                            setWeeklyObjectives((items) => reorderProjectSubset(items, projectIds, move))
                          }
                          onRestoreProjectOrder={setWeeklyObjectives}
                        />
                      ) : null}
                      <div className="app-content" onClickCapture={handleAppContentClickCapture}>
                        <NavigationToggle
                          navigationOpen={navigationOpen}
                          onToggleNavigation={handleToggleNavigation}
                        />
                        {rightPanelAvailable ? (
                          <RightPanelToggle
                            rightPanelOpen={rightPanelOpen}
                            onToggleRightPanel={() => updateRightPanelOpen((open) => !open)}
                          />
                        ) : null}
                        {view === 'home' ? (
                          <BoardView
                            weekStartRequest={homeWeekStartRequest}
                            todayFocusRequest={homeTodayFocusRequest}
                            activeRightPane={activeRightPane}
                            onRightPaneChange={selectRightPane}
                            onWorkspaceViewChange={(nextView) => updateNavigationOpen(nextView === 'board')}
                          />
                        ) : null}
                        {view === 'today' ? (
                          <BoardView
                            activeRightPane={activeRightPane}
                            onRightPaneChange={selectRightPane}
                            singleDay
                          />
                        ) : null}
                        {view === 'backlog' ? (
                          <BacklogView
                            scheduledItems={scheduledBacklogTasks}
                            scope={taskScope}
                            onScopeChange={openTaskScope}
                            activeRightPane={activeRightPane}
                            onRightPaneChange={selectRightPane}
                            onOpenArea={openAreaDetails}
                            onToggleObjective={toggleObjectiveFromDetails}
                            onToggleScheduledTask={toggleScheduledTaskFromBacklog}
                          />
                        ) : null}
                        {view === 'planning' ? (
                          <DailyPlanningView
                            onRevealCalendar={() => {
                              selectRightPane('calendar')
                              updateRightPanelOpen(true)
                            }}
                            activeRightPane={activeRightPane}
                            onRightPaneChange={selectRightPane}
                            step={planningStep}
                            setStep={setPlanningStep}
                            onDone={() => {
                              setDailyCompletedDate(CURRENT_DATE_KEY)
                              setView('home')
                              setToast('Day planned!')
                            }}
                            setToast={setToast}
                          />
                        ) : null}
                        {view === 'weekly-planning' ? (
                          <WeeklyPlanningView
                            days={weeklyCompletedDays}
                            activeRightPane={activeRightPane}
                            onRightPaneChange={selectRightPane}
                            step={weeklyStep}
                            setStep={setWeeklyStep}
                            onExit={() => setView('home')}
                            onDone={() => {
                              replaceWorkspaceDocument(
                                completeWeeklyPlanning(getWorkspaceDocument(), CURRENT_DATE_KEY),
                              )
                              setToast('Week planned!')
                            }}
                            setToast={setToast}
                          />
                        ) : null}
                      </div>
                      {addingTask ? (
                        <AddTaskForm
                          areas={areas}
                          dateKey={addingTask.dateKey}
                          initialArea={addingTask.area}
                          initialRecurrencePreset={addingTask.recurrencePreset}
                          objectiveId={addingTask.objectiveId}
                          onAdd={addTask}
                          onClose={() => setAddingTask(null)}
                        />
                      ) : null}
                    </div>
                    {pendingScheduleDrop ? (
                      <ScheduleTaskDialog
                        onCancel={() => setPendingScheduleDrop(null)}
                        onSchedule={scheduleBacklogTaskFromDrop}
                        taskTitle={pendingScheduleDrop.taskTitle}
                      />
                    ) : null}
                    {activeObjective ? (
                      <ObjectiveDetails
                        areas={areas}
                        backlogGroups={backlogGroups}
                        datedTasksByDate={datedTasksByDate}
                        entryMode={objectiveDetailsEntryMode}
                        initialScrollTop={objectiveDetailsScrollTopRef.current}
                        objective={activeObjective}
                        onAddComment={(text, attachment) =>
                          addObjectiveCommentFromDetails(activeObjective.id, text, attachment)
                        }
                        onAddTask={(title) => addObjectiveTaskFromDetails(activeObjective.id, title)}
                        onArchive={() => moveProjectOutOfActiveDetails(activeObjective.id, 'archive')}
                        onClose={closeObjectiveDetails}
                        onDelete={() => moveProjectOutOfActiveDetails(activeObjective.id, 'delete')}
                        onOpenTask={openObjectiveTaskDetails}
                        onRemoveFromWeek={() => removeObjectiveFromWeekFromDetails(activeObjective.id)}
                        onToggle={() => toggleObjectiveFromDetails(activeObjective.id)}
                        onToggleTask={(objectiveTaskId, canonicalTaskId) =>
                          toggleObjectiveTaskFromDetails(activeObjective.id, objectiveTaskId, canonicalTaskId)
                        }
                        onUpdate={(patch) => updateObjectiveFromDetails(activeObjective.id, patch)}
                        returnTaskFocusId={objectiveDetailsTaskFocusIdRef.current}
                        returnFocusElement={objectiveDetailsReturnFocusRef.current}
                        tasks={tasks}
                      />
                    ) : null}
                    {activeAreaDetails ? (
                      <AreaDetails
                        area={activeAreaDetails}
                        backlogGroups={backlogGroups}
                        datedTasksByDate={datedTasksByDate}
                        objectives={weeklyObjectives}
                        onArchive={() => archiveAreaFromDetails(activeAreaDetails.id)}
                        onColorChange={(colorOption) =>
                          changeAreaColorFromDetails(activeAreaDetails.id, colorOption)
                        }
                        onClose={closeAreaDetails}
                        onDelete={() => deleteAreaFromDetails(activeAreaDetails.id)}
                        onRename={(label) => renameAreaFromDetails(activeAreaDetails.id, label)}
                        returnFocusElement={areaDetailsReturnFocusRef.current}
                        tasks={tasks}
                      />
                    ) : null}
                    {activeTask && activeTaskDateKey ? (
                      <TaskDetails
                        areas={areas}
                        calendarEvents={events}
                        entryMode={taskDetailsEntryMode}
                        event={activeTaskEvent}
                        objective={activeTaskObjective}
                        projects={weeklyObjectives}
                        onAddComment={(text, attachment) =>
                          addCommentFromDetails(activeTask.id, text, attachment)
                        }
                        onAddSubtask={(subtask) => addSubtaskFromDetails(activeTask.id, subtask)}
                        onAssignProject={(objectiveId) =>
                          assignTaskToWeeklyObjective(activeTask, objectiveId)
                        }
                        onChangeArea={(channel, options) =>
                          updateTaskFromDetails(activeTask.id, { channel }, options)
                        }
                        onClose={closeTaskDetails}
                        onDelete={(scope) => deleteTaskFromDetails(activeTask.id, scope)}
                        onOpenObjective={
                          activeTaskObjective &&
                          weeklyObjectives.some((objective) => objective.id === activeTaskObjective.id)
                            ? openActiveTaskObjectiveDetails
                            : undefined
                        }
                        onRemoveSchedule={() => removeTaskSchedule(activeTask.id)}
                        onSchedule={(schedule) => scheduleTaskFromDetails(activeTask.id, schedule)}
                        onToggle={() => toggleTaskFromDetails(activeTask.id)}
                        onToggleSubtask={(subtaskId) => toggleSubtaskFromDetails(activeTask.id, subtaskId)}
                        onUpdateSubtask={(subtaskId, patch) =>
                          updateSubtaskFromDetails(activeTask.id, subtaskId, patch)
                        }
                        onReorderSubtasks={(move) => {
                          if (move.sourceLaneId !== 'subtasks' || move.targetLaneId !== 'subtasks') return
                          dispatchTaskDetailCommand({
                            type: 'subtask.reorder',
                            taskId: activeTask.id,
                            subtaskId: move.itemId,
                            index: move.targetIndex,
                          })
                        }}
                        onUpdateRecurrence={(recurrence) =>
                          updateTaskRecurrenceFromDetails(activeTask.id, recurrence)
                        }
                        onUpdateTask={(patch) => updateTaskFromDetails(activeTask.id, patch)}
                        returnFocusElement={taskDetailsReturnFocusRef.current}
                        task={activeTask}
                        taskDateKey={activeTaskDateKey}
                      />
                    ) : null}
                  </div>
                </main>
              </AutoScheduleAnimation>
              {taskAreaUndo ? (
                <UndoSnackbar
                  key={`area-${taskAreaUndo.id}`}
                  message={taskAreaUndo.message}
                  notificationId={taskAreaUndo.id}
                  onDismiss={() => setTaskAreaUndo(null)}
                  onUndo={undoTaskAreaMove}
                />
              ) : projectActionUndo ? (
                <UndoSnackbar
                  key={projectActionUndo.id}
                  message={projectActionUndo.message}
                  notificationId={projectActionUndo.id}
                  onDismiss={() => setProjectActionUndo(null)}
                  onUndo={undoProjectAction}
                />
              ) : taskDeletionUndo ? (
                <UndoSnackbar
                  key={taskDeletionUndo.id}
                  message={taskDeletionUndo.message}
                  notificationId={taskDeletionUndo.id}
                  onDismiss={() => setTaskDeletionUndo(null)}
                  onUndo={undoTaskDeletion}
                />
              ) : null}
              <DragOverlay
                className="dnd-overlay"
                dropAnimation={null}
                disabled={(source) => source?.data?.kind === 'calendar-resize'}
              >
                {(source) => (
                  <DndPreview areas={areas} presentation={dragPreviewPresentation} source={source} />
                )}
              </DragOverlay>
            </DragDropProvider>
          </TaskAreaActionsProvider>
        </AreaFoldersProvider>
      </CalendarSessionsProvider>
    </WorkspaceTaskActionsContext.Provider>
  )
}

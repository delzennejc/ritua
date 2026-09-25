import { useWorkspaceTaskActions } from '../../hooks/useWorkspaceTaskActions.js'
import { useWorkspaceCollections } from '../../hooks/useWorkspaceCollections.js'
import { toggleTaskSubtask } from '../../../desktop/workspace-actions'
import { toggleTaskCompletion } from '../../../desktop/workspace-actions'
import { syncAccomplishedObjectiveTasks } from '../../../../../domain/weekly-review'
import { taskTimeTotals } from '../../../../../domain/task-time'
import { useWorkspaceState } from '../../../desktop/workspace-store'
import { useState } from 'react'
import { RightPanel } from '../../components/RightPanel'

import { filterItemsByArea, mergeVisibleItemOrder } from '../../utils/areas'
import { CURRENT_DATE_KEY } from '../../utils/dates'
import { WeeklyHistoryStep } from './WeeklyHistoryStep'
import { WeeklyObjectivesStep } from './WeeklyObjectivesStep'
import { WeeklyPlanStep } from './WeeklyPlanStep'
import { WeeklyReviewStep } from './WeeklyReviewStep'

const completedTasks = (days) => days.flatMap((day) => day.tasks).filter((task) => task.complete)

const buildReviewText = (days) =>
  `Tasks finished this week\n${completedTasks(days)
    .map((task) => `• ${task.title}`)
    .join('\n')}`

const buildPlanText = (objectives, days) =>
  `Planned for this week\n${objectives.map((objective) => `• ${objective.title}`).join('\n')}\n\nFinished last week\n${completedTasks(
    days,
  )
    .map((task) => `• ${task.title}`)
    .join('\n')}`

export function WeeklyPlanningView({
  days,
  setDays,
  activeRightPane,
  onRightPaneChange,
  step,
  setStep,
  onExit,
  onDone,
  setToast,
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
    datedTasksByDate,
    tasks,
    events,
    setEvents,
    objectives,
    setObjectives,
    weeklyFocusedObjectives,
    setWeeklyFocusedObjectives,
    rightPanelUnavailableTaskIds,
    backlogGroups,
  } = useWorkspaceCollections()

  const [reviewText, setReviewText] = useWorkspaceState('weekly.reviewText', () => buildReviewText(days))
  const [planText, setPlanText] = useWorkspaceState('weekly.planText', () => buildPlanText(objectives, days))
  const [selectedAreaIds, setSelectedAreaIds] = useState([])
  const [accomplishedObjectives, setAccomplishedObjectives] = useWorkspaceState(
    'weekly.accomplishedObjectives',
    objectives.filter((objective) =>
      days.some((day) => day.tasks.some((task) => task.objectiveId === objective.id)),
    ),
  )
  const syncedAccomplishedObjectives = syncAccomplishedObjectiveTasks(
    [
      ...accomplishedObjectives,
      ...objectives.filter(
        (objective) =>
          !accomplishedObjectives.some((item) => item.id === objective.id) &&
          days.some((day) => day.tasks.some((task) => task.objectiveId === objective.id)),
      ),
    ],
    days,
  )
  const focusedObjectives = weeklyFocusedObjectives
  const setFocusedObjectives = setWeeklyFocusedObjectives
  const areaFilterProps = {
    showDate: false,
    areas,
    selectedAreaIds,
    onAreaFilterChange: setSelectedAreaIds,
  }
  const filteredDays = days.map((day) => ({
    ...day,
    tasks: filterItemsByArea(day.tasks, selectedAreaIds, areas),
    allTasks: day.tasks,
  }))
  const filteredFocusedObjectives = filterItemsByArea(focusedObjectives, selectedAreaIds, areas)
  const filteredAccomplishedObjectives = filterItemsByArea(
    syncedAccomplishedObjectives,
    selectedAreaIds,
    areas,
  )
  const setFilteredFocusedObjectives = (updater) => {
    setFocusedObjectives((items) => {
      const visibleItems = filterItemsByArea(items, selectedAreaIds, areas)
      const nextVisibleItems = typeof updater === 'function' ? updater(visibleItems) : updater
      return mergeVisibleItemOrder(items, nextVisibleItems, selectedAreaIds, areas)
    })
  }
  const setFilteredAccomplishedObjectives = (updater) => {
    setAccomplishedObjectives((items) => {
      const visibleItems = filterItemsByArea(items, selectedAreaIds, areas)
      const nextVisibleItems = typeof updater === 'function' ? updater(visibleItems) : updater
      return mergeVisibleItemOrder(items, nextVisibleItems, selectedAreaIds, areas)
    })
  }

  const toggleTask = toggleTaskCompletion

  const toggleObjective = (id) => {
    setObjectives((items) =>
      items.map((objective) =>
        objective.id === id ? { ...objective, complete: !objective.complete } : objective,
      ),
    )
  }

  const addObjective = (title) => {
    const id = `objective-${Date.now()}`
    const objective = {
      id,
      title,
      channel: 'Ritua',
      complete: false,
      focusedThisWeek: true,
      tasks: [],
    }
    setObjectives((items) => [objective, ...items])
    setFocusedObjectives((items) => [objective, ...items])
    return id
  }

  const focusObjectiveInWeek = (id, targetIndex) => {
    const objective = objectives.find((item) => item.id === id)
    const wasFocused = objective?.focusedThisWeek !== false
    setObjectives((items) =>
      items.map((objective) => (objective.id === id ? { ...objective, focusedThisWeek: true } : objective)),
    )
    setFocusedObjectives((items) => {
      const currentIndex = items.findIndex((item) => item.id === id)
      const remainingItems = items.filter((item) => item.id !== id)
      let insertionIndex = Math.max(
        0,
        Math.min(remainingItems.length, Number.isInteger(targetIndex) ? targetIndex : remainingItems.length),
      )
      if (currentIndex !== -1 && currentIndex < insertionIndex) insertionIndex -= 1
      return [...remainingItems.slice(0, insertionIndex), objective, ...remainingItems.slice(insertionIndex)]
    })
    setToast?.(
      wasFocused
        ? `${objective?.title || 'Project'} repositioned in this week.`
        : `${objective?.title || 'Project'} added to this week.`,
    )
  }

  const unfocusObjective = (id, targetIndex) => {
    const objective = objectives.find((item) => item.id === id)
    setObjectives((items) => {
      const nextObjectives = items.map((objective) =>
        objective.id === id ? { ...objective, focusedThisWeek: false } : objective,
      )
      if (!Number.isInteger(targetIndex)) return nextObjectives

      const otherObjectives = nextObjectives.filter((item) => item.focusedThisWeek === false)
      const movedObjective = otherObjectives.find((item) => item.id === id)
      if (!movedObjective) return nextObjectives
      const remainingObjectives = otherObjectives.filter((item) => item.id !== id)
      const insertionIndex = Math.max(0, Math.min(targetIndex, remainingObjectives.length))
      const orderedOtherObjectives = [
        ...remainingObjectives.slice(0, insertionIndex),
        movedObjective,
        ...remainingObjectives.slice(insertionIndex),
      ]
      let otherIndex = 0
      return nextObjectives.map((item) =>
        item.focusedThisWeek === false ? orderedOtherObjectives[otherIndex++] : item,
      )
    })
    setFocusedObjectives((items) => items.filter((item) => item.id !== id))
    setToast?.(`${objective?.title || 'Project'} removed from this week.`)
  }

  const rightPanel = (
    <RightPanel
      selectedAreaIds={selectedAreaIds}
      activePane={activeRightPane}
      onPaneChange={onRightPaneChange}
      tasks={tasks}
      dateKey={CURRENT_DATE_KEY}
      visibleTaskIds={
        selectedAreaIds.length
          ? filterItemsByArea(tasks, selectedAreaIds, areas).map((task) => task.id)
          : null
      }
      onFocusObjectiveInWeek={focusObjectiveInWeek}
      weeklyFocusedObjectives={focusedObjectives}
      setWeeklyFocusedObjectives={setFocusedObjectives}
    />
  )

  if (step === 0) {
    return (
      <WeeklyHistoryStep
        events={events}
        includeEmptySessions={!selectedAreaIds.length}
        days={filteredDays}
        areaFilterProps={areaFilterProps}
        onToggleTask={toggleTask}
        onToggleSubtask={toggleTaskSubtask}
        onBack={onExit}
        onNext={() => setStep(1)}
        onCreateBoardTask={onCreateBoardTask}
        onOpenTotal={() =>
          setToast(
            `Last week: ${
              Math.round(
                taskTimeTotals(
                  filteredDays.flatMap((day) => day.tasks),
                  events,
                  {
                    dateKeys: filteredDays.map((day) => day.dateKey),
                    includeEmptySessions: !selectedAreaIds.length,
                  },
                ).actual / 6,
              ) / 10
            } hours worked.`,
          )
        }
        onOpenTask={onOpenTask}
      />
    )
  }

  if (step === 1) {
    return (
      <WeeklyReviewStep
        areaFilterProps={areaFilterProps}
        reviewText={reviewText}
        setReviewText={setReviewText}
        accomplishedObjectives={filteredAccomplishedObjectives}
        setAccomplishedObjectives={setFilteredAccomplishedObjectives}
        onBack={() => setStep(0)}
        onNext={() => {
          onRightPaneChange('objectives')
          setStep(2)
        }}
      />
    )
  }

  if (step === 2) {
    return (
      <div className="surface-row planning-row weekly-planning-row">
        <WeeklyObjectivesStep
          areaFilterProps={areaFilterProps}
          objectives={filteredFocusedObjectives}
          setObjectives={setFilteredFocusedObjectives}
          onToggleObjective={toggleObjective}
          onAddObjective={addObjective}
          onFocusObjectiveInWeek={focusObjectiveInWeek}
          onRemoveObjectiveFromWeek={unfocusObjective}
          onBack={() => setStep(1)}
          onOpenObjective={onOpenObjective}
          onNext={() => {
            setPlanText(buildPlanText(focusedObjectives, days))
            setStep(3)
          }}
        />
        {rightPanel}
      </div>
    )
  }

  return (
    <div className="surface-row planning-row weekly-planning-row">
      <WeeklyPlanStep
        areaFilterProps={areaFilterProps}
        planText={planText}
        setPlanText={setPlanText}
        objectives={filteredFocusedObjectives}
        setObjectives={setFilteredFocusedObjectives}
        onToggleObjective={toggleObjective}
        onFocusObjectiveInWeek={focusObjectiveInWeek}
        onRemoveObjectiveFromWeek={unfocusObjective}
        onBack={() => setStep(2)}
        onDone={onDone}
        onOpenObjective={onOpenObjective}
      />
      {rightPanel}
    </div>
  )
}

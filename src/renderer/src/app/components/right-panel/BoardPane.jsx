import { toggleTaskSubtask } from '../../../desktop/workspace-actions'
import { toggleTaskCompletion } from '../../../desktop/workspace-actions'
import { useWorkspaceProjection } from '../../../desktop/workspace-store'

import { CURRENT_DATE_KEY, dateFromKey } from '../../utils/dates'

import { InlineTaskStack } from '.././InlineTaskStack'

import { SortableTaskLane } from '.././SortableTaskLane'
import { TaskCard } from '.././TaskCard'
import { DayCompletionIndicator } from '../DayCompletionIndicator'

export function BoardPane({
  tasks,

  setEvents,
  setObjectives,
  objectives,
  dateKey,
  onCreateBoardTask,
  onAssignObjective,
  onQuickSchedule,
  onUnscheduleTask,
  onOpenTask,
  visibleTaskIds,
  selectedAreaIds = [],
  toolbarContent,
  showWorkflowStatus = true,
  showDayReview = false,
}) {
  const boardSurfaceId = 'right-panel-board'
  const dailyHighlightId = useWorkspaceProjection('daily.highlightTaskId', null)
  const visibleTaskIdSet = visibleTaskIds ? new Set(visibleTaskIds) : null
  const visibleTasks = tasks.filter((task) => !visibleTaskIdSet || visibleTaskIdSet.has(task.id))
  const selectedDate = dateFromKey(dateKey)
  const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' })
  const dateLabel = selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  const toggleTask = toggleTaskCompletion
  const toggleSubtask = (taskId, subtaskId) => toggleTaskSubtask(taskId, subtaskId)

  return (
    <div className="utility-pane right-panel-board">
      <div className="utility-pane-header day-summary-header">{toolbarContent}</div>
      <SortableTaskLane
        boardSurfaceId={boardSurfaceId}
        dateKey={dateKey}
        tasks={visibleTasks}
        allTasks={tasks}
        className="utility-pane-content day-column active-day"
        aria-label={`Board for ${dateLabel}`}
      >
        {({ taskBoardProps }) => (
          <>
            <header>
              <div className="day-column-heading">
                <h2>{dayName}</h2>
                {showDayReview ? <DayCompletionIndicator dateKey={dateKey} tasks={visibleTasks} /> : null}
              </div>
              <p>{dateLabel}</p>
              {!showDayReview && dateKey === CURRENT_DATE_KEY ? (
                <span
                  className="day-progress"
                  role="progressbar"
                  aria-label="Today task completion"
                  aria-valuemin={0}
                  aria-valuemax={visibleTasks.length || 1}
                  aria-valuenow={visibleTasks.filter((task) => task.complete).length}
                >
                  <span
                    style={{
                      width: `${visibleTasks.length ? (visibleTasks.filter((task) => task.complete).length / visibleTasks.length) * 100 : 0}%`,
                    }}
                  />
                </span>
              ) : null}
            </header>
            <InlineTaskStack
              dateKey={dateKey}
              firstTaskId={visibleTasks[0]?.id}
              onCreateTask={onCreateBoardTask}
              addRowClassName="right-panel-add-task"
              stackClassName="right-panel-task-stack"
            >
              {visibleTasks.map((task, visibleIndex) => (
                <TaskCard
                  showWorkflowStatus={showWorkflowStatus}
                  key={task.id}
                  task={task}
                  dailyHighlight={dateKey === CURRENT_DATE_KEY && task.id === dailyHighlightId}
                  projects={objectives}
                  {...taskBoardProps(task, visibleIndex)}
                  onToggle={toggleTask}
                  onToggleSubtask={toggleSubtask}
                  onAssignObjective={onAssignObjective}
                  onOpen={onOpenTask}
                  onUnschedule={onUnscheduleTask}
                  onSchedule={
                    onQuickSchedule ? (source) => onQuickSchedule(task, dateKey, source) : undefined
                  }
                />
              ))}
              {!visibleTasks.length ? <p className="utility-empty">No tasks for this day.</p> : null}
            </InlineTaskStack>
          </>
        )}
      </SortableTaskLane>
    </div>
  )
}

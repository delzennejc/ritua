import { ArrowLeft, RocketLaunch } from '@phosphor-icons/react'
import { SortableTaskLane } from '../../components/SortableTaskLane'
import { TaskCard } from '../../components/TaskCard'
import { TopControls } from '../../components/TopControls'
import { WeeklyTextCard } from '../../components/WeeklyTextCard'
import { CURRENT_DATE_KEY } from '../../utils/dates'

export function DailyPlanReview({
  tasks,
  allTasks = tasks,
  areaFilterProps,
  planText,
  setPlanText,
  onToggle,
  onToggleSubtask,
  onAssignObjective,
  onOpenTask,
  onBack,
  onDone,
  projects,
}) {
  const planTasks = tasks.filter((task) => task.id !== 'planning')

  return (
    <section className="share-view daily-plan-review" data-board-scroll-container="true">
      <TopControls {...areaFilterProps} />
      <div className="share-content">
        <div className="share-heading">
          <h1>Daily plan</h1>
          <p>Document and share your plan for today.</p>
        </div>
        <div className="share-layout">
          <div className="weekly-document-primary">
            <WeeklyTextCard value={planText} onChange={setPlanText} ariaLabel="Daily plan" />
            <div className="share-actions">
              <button className="back-button" aria-label="Back" onClick={onBack}>
                <ArrowLeft size={18} />
              </button>
              <button className="next-button get-started" onClick={onDone}>
                <RocketLaunch size={16} /> Get started
              </button>
            </div>
          </div>
          <SortableTaskLane
            as="div"
            boardSurfaceId="daily-plan-review-board"
            className="task-stack share-task-stack"
            dateKey={CURRENT_DATE_KEY}
            tasks={planTasks}
            allTasks={allTasks}
          >
            {({ taskBoardProps }) =>
              planTasks.map((task, visibleIndex) => (
                <TaskCard
                  task={task}
                  projects={projects}
                  key={task.id}
                  {...taskBoardProps(task, visibleIndex)}
                  onToggle={onToggle}
                  onToggleSubtask={onToggleSubtask}
                  onAssignObjective={onAssignObjective}
                  onOpen={onOpenTask}
                />
              ))
            }
          </SortableTaskLane>
        </div>
      </div>
      <div className="share-footer">Principles · Customize · Refresh · Skip this step in the future</div>
    </section>
  )
}

import { CaretDown, CaretUp, Square } from '@phosphor-icons/react'
import { PieChart } from 'react-minimal-pie-chart'
import { InlineTaskStack } from '../../components/InlineTaskStack'
import { SortableCollectionLane } from '../../components/SortableCollection'
import { TaskCard } from '../../components/TaskCard'
import { TopControls } from '../../components/TopControls'
import { minutesLabel } from '../../utils/time'
import { taskTimeTotals, taskWorkedMinutes } from '../../../../../domain/task-time'

import { CURRENT_DATE_KEY, addDays } from '../../utils/dates'

function TimeSummary({ onOpenTotal, tasks, areas }) {
  const { actual, planned } = taskTimeTotals(tasks)
  const hours = (minutes) => Math.round(minutes / 6) / 10
  const distribution = areas
    .map((area) => ({
      title: area.label,
      color: area.color,
      value: taskTimeTotals(tasks.filter((task) => task.channel === area.label)).actual,
    }))
    .filter((item) => item.value > 0)
  return (
    <section className="review-summary" aria-labelledby="yesterday-review-heading">
      <h1 id="yesterday-review-heading">Yesterday in review</h1>
      <p>
        How you spent your time yesterday in{' '}
        <button className="review-total-link" onClick={onOpenTotal}>
          total
        </button>
      </p>

      <div className="review-total-time">
        <h2>Total time</h2>
        <div className="review-time-meter">
          <div
            className="actual-time-callout"
            style={{
              left: `${Math.min(100, (hours(actual) / Math.max(12, hours(actual), hours(planned))) * 100)}%`,
            }}
          >
            <strong>{hours(actual)} hr</strong>
            <CaretDown size={14} weight="fill" />
          </div>
          <progress
            max={Math.max(12, hours(actual), hours(planned))}
            value={hours(actual)}
            aria-label={`${hours(actual)} hours spent yesterday`}
          />
          <span className="hour-tick six-hour-tick" aria-hidden="true" />
          <span className="hour-tick eight-hour-tick" aria-hidden="true" />
          <span className="hour-label six-hours">6 hr</span>
          <span className="hour-label eight-hours">8 hr</span>
          <div
            className="planned-time-callout"
            style={{
              left: `${Math.min(100, (hours(planned) / Math.max(12, hours(actual), hours(planned))) * 100)}%`,
            }}
          >
            <CaretUp size={14} weight="fill" />
            <strong>
              {hours(planned)} hr
              <br />
              planned
            </strong>
          </div>
        </div>
      </div>

      <div className="review-time-breakdown">
        <h2>How you spent your time</h2>
        <div
          className="review-chart-figure"
          role="img"
          aria-label={`Time spent by area: ${distribution.map((item) => `${hours(item.value)} hours on ${item.title}`).join(', ') || 'No time logged'}`}
        >
          <PieChart data={distribution} lineWidth={34} startAngle={270} paddingAngle={1} animate={false} />
        </div>
        <div className="review-chart-legend" aria-hidden="true">
          {distribution.map((item) => (
            <span key={item.title}>
              <Square size={10} weight="fill" style={{ color: item.color }} /> {item.title}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

const reviewDurationLabel = (task) =>
  `${minutesLabel(taskWorkedMinutes(task))} / ${minutesLabel(task.minutes || 0)}`

function ReviewTaskColumn({
  collectionSnapshot,
  laneId,
  title,
  tasks,
  onMoveTask,
  onRestoreTasks,
  onToggle,
  onToggleSubtask,
  onCreateBoardTask,
  onAssignObjective,
  onOpenTask,
  projects,
}) {
  return (
    <SortableCollectionLane
      as="section"
      axis="horizontal"
      className="review-task-column"
      collectionId="yesterday-review-tasks"
      collectionSnapshot={collectionSnapshot}
      items={tasks}
      laneId={laneId}
      onMove={onMoveTask}
      onRestore={onRestoreTasks}
      surfaceId="yesterday-review-board"
    >
      {({ collectionItemProps }) => (
        <>
          <h2>{title}</h2>
          <InlineTaskStack
            dateKey={addDays(CURRENT_DATE_KEY, -1)}
            firstTaskId={tasks[0]?.id}
            onCreateTask={(draft) => onCreateBoardTask(draft, laneId)}
          >
            {tasks.map((task, index) => (
              <TaskCard
                showWorkflowStatus={false}
                collectionItem={collectionItemProps(task, index)}
                key={task.id}
                task={task}
                projects={projects}
                onToggle={onToggle}
                onToggleSubtask={onToggleSubtask}
                onAssignObjective={onAssignObjective}
                onOpen={onOpenTask}
              />
            ))}
          </InlineTaskStack>
        </>
      )}
    </SortableCollectionLane>
  )
}

export function YesterdayReview({
  tasks,
  areaFilterProps,
  taskIdsByLane,
  setTaskIdsByLane,
  onMoveTask,
  onToggle,
  onToggleSubtask,
  onCreateBoardTask,
  onNext,
  onOpenTotal,
  onAssignObjective,
  onOpenTask,
  projects,
}) {
  const reviewedTasks = tasks.map((task) => ({
    ...task,
    durationLabel: reviewDurationLabel(task),
  }))
  const workedOn = taskIdsByLane.worked
    .map((id) => reviewedTasks.find((task) => task.id === id))
    .filter(Boolean)
  const didNotGetTo = taskIdsByLane.missed
    .map((id) => reviewedTasks.find((task) => task.id === id))
    .filter(Boolean)
  const createReviewTask = (draft, laneId) => {
    const taskId = onCreateBoardTask(draft)
    if (taskId) {
      setTaskIdsByLane((lanes) => ({
        ...lanes,
        [laneId]: [taskId, ...lanes[laneId]],
      }))
    }
    return taskId
  }

  return (
    <section className="planning-surface yesterday-review">
      <TopControls {...areaFilterProps} />
      <div className="yesterday-review-body" data-board-scroll-container="true">
        <div className="review-summary-column">
          <TimeSummary onOpenTotal={onOpenTotal} tasks={tasks} areas={areaFilterProps.areas} />
          <button className="review-next-button next-button" onClick={onNext}>
            Next
          </button>
        </div>
        <ReviewTaskColumn
          collectionSnapshot={taskIdsByLane}
          laneId="worked"
          title="Worked on:"
          tasks={workedOn}
          onMoveTask={onMoveTask}
          onRestoreTasks={setTaskIdsByLane}
          onToggle={onToggle}
          onToggleSubtask={onToggleSubtask}
          onCreateBoardTask={createReviewTask}
          onAssignObjective={onAssignObjective}
          onOpenTask={onOpenTask}
          projects={projects}
        />
        <ReviewTaskColumn
          collectionSnapshot={taskIdsByLane}
          laneId="missed"
          title="Didn't get to:"
          tasks={didNotGetTo}
          onMoveTask={onMoveTask}
          onRestoreTasks={setTaskIdsByLane}
          onToggle={onToggle}
          onToggleSubtask={onToggleSubtask}
          onCreateBoardTask={createReviewTask}
          onAssignObjective={onAssignObjective}
          onOpenTask={onOpenTask}
          projects={projects}
        />
      </div>
    </section>
  )
}

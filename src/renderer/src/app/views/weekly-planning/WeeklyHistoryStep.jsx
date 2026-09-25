import { ArrowLeft, Square } from '@phosphor-icons/react'
import { PieChart } from 'react-minimal-pie-chart'
import { InlineTaskStack } from '../../components/InlineTaskStack'
import { SortableTaskLane } from '../../components/SortableTaskLane'
import { TaskCard } from '../../components/TaskCard'
import { TopControls } from '../../components/TopControls'
import { DEFAULT_AREAS } from '../../../../../domain/workspace-defaults'
import { taskTimeTotals } from '../../../../../domain/task-time'
import { minutesLabel } from '../../utils/time'

function WeeklyProductivityChart({ areas, days, events, includeEmptySessions }) {
  const limitHours = Math.max(
    6,
    ...days.map((day) =>
      Math.ceil(
        taskTimeTotals(day.tasks, events, { dateKeys: [day.dateKey], includeEmptySessions }).actual / 60,
      ),
    ),
  )
  const folderColors = {
    Sessions: '#a4a4a4',
    ...Object.fromEntries(areas.map((folder) => [folder.label, folder.color])),
  }
  return (
    <div
      className="weekly-productivity-chart"
      role="img"
      aria-label={`Daily productivity totaling ${minutesLabel(
        taskTimeTotals(
          days.flatMap((day) => day.tasks),
          events,
          { dateKeys: days.map((day) => day.dateKey), includeEmptySessions },
        ).actual,
      )} from Monday through Sunday`}
    >
      <span className="weekly-chart-limit">{limitHours} hr</span>
      <div className="weekly-chart-plot">
        {days.map((day) => {
          const segments = Object.fromEntries(
            areas.map((area) => [
              area.label,
              taskTimeTotals(
                day.tasks.filter((task) => task.channel === area.label),
                events,
                { dateKeys: [day.dateKey], includeEmptySessions: false },
              ).actual,
            ]),
          )
          const unassignedSessionMinutes = taskTimeTotals([], events, {
            dateKeys: [day.dateKey],
            includeEmptySessions,
          }).actual
          if (unassignedSessionMinutes > 0)
            segments.Sessions = (segments.Sessions || 0) + unassignedSessionMinutes

          return (
            <div className="weekly-chart-day" key={day.id}>
              <div className="weekly-bar-stack" aria-hidden="true">
                {Object.entries(segments).map(([channel, minutes]) => (
                  <span
                    key={channel}
                    style={{
                      height: `${Math.max(0, (minutes / (limitHours * 60)) * 110)}px`,
                      backgroundColor: folderColors[channel] || '#9a76f0',
                    }}
                  />
                ))}
              </div>
              <span>{day.day.slice(0, 3)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeeklyTimeBreakdown({ areas, tasks, events, dateKeys, includeEmptySessions }) {
  const distribution = areas
    .map((folder) => ({
      title: folder.label,
      color: folder.color,
      value: taskTimeTotals(
        tasks.filter((task) => task.channel === folder.label),
        events,
        { dateKeys, includeEmptySessions: false },
      ).actual,
    }))
    .filter((item) => item.value > 0)
  const unassignedSessionMinutes = taskTimeTotals([], events, { dateKeys, includeEmptySessions }).actual
  if (unassignedSessionMinutes > 0)
    distribution.push({ title: 'Sessions', color: '#a4a4a4', value: unassignedSessionMinutes })

  return (
    <div className="weekly-time-breakdown">
      <h2>How you spent your time</h2>
      <div className="weekly-folder-chart" role="img" aria-label="Time spent last week by area">
        <PieChart data={distribution} lineWidth={42} startAngle={270} paddingAngle={1} animate={false} />
      </div>
      <div className="weekly-folder-legend" aria-hidden="true">
        {distribution.map((item) => (
          <span key={item.title}>
            <Square size={10} weight="fill" style={{ color: item.color }} /> {item.title}
          </span>
        ))}
      </div>
    </div>
  )
}

export function WeeklyHistoryStep({
  events = [],
  includeEmptySessions = true,
  days,
  areaFilterProps,
  onToggleTask,
  onToggleSubtask,
  onBack,
  onNext,
  onCreateBoardTask,
  onOpenTotal,
  onOpenTask,
}) {
  const tasks = days.flatMap((day) => day.tasks)
  const areas = areaFilterProps?.areas || DEFAULT_AREAS
  const dateKeys = days.map((day) => day.dateKey)
  const totalMinutes = taskTimeTotals(tasks, events, { dateKeys, includeEmptySessions }).actual

  return (
    <section className="planning-surface weekly-planning-view weekly-history-view">
      <TopControls {...areaFilterProps} />
      <div className="weekly-history-body" data-board-scroll-container="true">
        <aside className="weekly-history-summary">
          <h1>What got done</h1>
          <p>
            You worked {Math.round(totalMinutes / 6) / 10} hours last week in{' '}
            <button className="review-total-link" onClick={onOpenTotal}>
              total
            </button>
          </p>
          <section className="weekly-productivity">
            <h2>Daily productivity</h2>
            <WeeklyProductivityChart
              areas={areas}
              days={days}
              events={events}
              includeEmptySessions={includeEmptySessions}
            />
          </section>
          <WeeklyTimeBreakdown
            areas={areas}
            tasks={tasks}
            events={events}
            dateKeys={dateKeys}
            includeEmptySessions={includeEmptySessions}
          />
          <div className="weekly-summary-actions wizard-actions">
            <button className="back-button" aria-label="Back" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
            <button className="next-button" onClick={onNext}>
              Next
            </button>
          </div>
        </aside>
        <div className="weekly-day-strip">
          {days.map((day) => {
            return (
              <SortableTaskLane
                boardSurfaceId="weekly-history-board"
                className="weekly-day-column"
                dateKey={day.dateKey}
                key={day.id}
                tasks={day.tasks}
                allTasks={day.allTasks}
              >
                {({ taskBoardProps }) => (
                  <>
                    <header>
                      <h2>{day.day}</h2>
                      <p>{day.date}</p>
                    </header>
                    <InlineTaskStack
                      dateKey={day.dateKey}
                      firstTaskId={day.tasks[0]?.id}
                      onCreateTask={onCreateBoardTask}
                    >
                      {day.tasks.map((task, visibleIndex) => (
                        <TaskCard
                          key={task.id}
                          task={{
                            ...task,
                            time: null,
                          }}
                          {...taskBoardProps(task, visibleIndex)}
                          onToggle={onToggleTask}
                          onToggleSubtask={onToggleSubtask}
                          onOpen={onOpenTask}
                        />
                      ))}
                    </InlineTaskStack>
                  </>
                )}
              </SortableTaskLane>
            )
          })}
        </div>
      </div>
    </section>
  )
}

import { ArrowLeft, Square } from "@phosphor-icons/react";
import { PieChart } from "react-minimal-pie-chart";
import { InlineTaskStack } from "../../components/InlineTaskStack";
import { SortableTaskLane } from "../../components/SortableTaskLane";
import { TaskCard } from "../../components/TaskCard";
import { TopControls } from "../../components/TopControls";
import { DEFAULT_AREAS } from "../../../../../domain/workspace-defaults";
import { minutesLabel } from "../../utils/time";

function WeeklyProductivityChart({ areas, days }) {
  const limitHours = Math.max(6, ...days.map((day) => Math.ceil(day.tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0) / 60)));
  const folderColors = Object.fromEntries(areas.map((folder) => [folder.label, folder.color]));
  return (
    <div className="weekly-productivity-chart" role="img" aria-label={`Daily productivity totaling ${minutesLabel(days.flatMap((day) => day.tasks).reduce((sum, task) => sum + (task.actualMinutes || 0), 0))} from Monday through Sunday`}>
      <span className="weekly-chart-limit">{limitHours} hr</span>
      <div className="weekly-chart-plot">
        {days.map((day) => {
          const segments = day.tasks.reduce((items, task) => ({
            ...items,
            [task.channel]: (items[task.channel] || 0) + (task.actualMinutes || 0),
          }), {});

          return (
            <div className="weekly-chart-day" key={day.id}>
              <div className="weekly-bar-stack" aria-hidden="true">
                {Object.entries(segments).map(([channel, minutes]) => (
                  <span
                    key={channel}
                    style={{
                      height: `${Math.max(0, (minutes / (limitHours * 60)) * 110)}px`,
                      backgroundColor: folderColors[channel] || "#9a76f0",
                    }}
                  />
                ))}
              </div>
              <span>{day.day.slice(0, 3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeeklyTimeBreakdown({ areas, tasks }) {
  const distribution = areas.map((folder) => ({
    title: folder.label,
    color: folder.color,
    value: tasks.filter((task) => task.channel === folder.label).reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
  })).filter((item) => item.value > 0);

  return (
    <div className="weekly-time-breakdown">
      <h2>How you spent your time</h2>
      <div className="weekly-folder-chart" role="img" aria-label="Time spent last week by area">
        <PieChart data={distribution} lineWidth={42} startAngle={270} paddingAngle={1} animate={false} />
      </div>
      <div className="weekly-folder-legend" aria-hidden="true">
        {distribution.map((item) => (
          <span key={item.title}><Square size={10} weight="fill" style={{ color: item.color }} /> {item.title}</span>
        ))}
      </div>
    </div>
  );
}

export function WeeklyHistoryStep({ days, areaFilterProps, onToggleTask, onToggleSubtask, onBack, onNext, onCreateBoardTask, onOpenTotal, onOpenTask }) {
  const tasks = days.flatMap((day) => day.tasks);
  const areas = areaFilterProps?.areas || DEFAULT_AREAS;
  const totalMinutes = tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0);

  return (
    <section className="planning-surface weekly-planning-view weekly-history-view">
      <TopControls {...areaFilterProps} />
      <div className="weekly-history-body" data-board-scroll-container="true">
        <aside className="weekly-history-summary">
          <h1>What got done</h1>
          <p>You logged {Math.round(totalMinutes / 6) / 10} hours last week in <button className="review-total-link" onClick={onOpenTotal}>total</button></p>
          <section className="weekly-productivity">
            <h2>Daily productivity</h2>
            <WeeklyProductivityChart areas={areas} days={days} />
          </section>
          <WeeklyTimeBreakdown areas={areas} tasks={tasks} />
          <div className="weekly-summary-actions wizard-actions">
            <button className="back-button" aria-label="Back" onClick={onBack}><ArrowLeft size={18} /></button>
            <button className="next-button" onClick={onNext}>Next</button>
          </div>
        </aside>
        <div className="weekly-day-strip">
          {days.map((day) => {
            const minutes = day.tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0);
            const total = minutes ? minutesLabel(minutes) : "0:00";

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
                      total={`${total} / ${minutesLabel(day.tasks.reduce((sum, task) => sum + (task.minutes || 0), 0))}`}
                    >
                      {day.tasks.map((task, visibleIndex) => (
                        <TaskCard
                          key={task.id}
                          task={{ ...task, time: null }}
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
            );
          })}
        </div>
      </div>
    </section>
  );
}

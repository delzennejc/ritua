import { useWorkspaceState } from "../../../desktop/workspace-store";
import { useEffect, useState } from "react";
import { InlineTaskStack } from "../../components/InlineTaskStack";
import { RightPanel } from "../../components/RightPanel";
import { SortableTaskLane } from "../../components/SortableTaskLane";
import { TaskCard } from "../../components/TaskCard";
import { TopControls } from "../../components/TopControls";
import { DEFAULT_AREAS } from "../../../../../domain/workspace-defaults";
import { filterItemsByArea } from "../../utils/areas";
import { CURRENT_DATE_KEY, addDays, mondayOf } from "../../utils/dates";
import { moveItemBetweenLanes } from "../../utils/collections";
import { minutesLabel, timeLabel } from "../../utils/time";
import {
  setTaskCompletionInObjectiveMirrors,
  toggleSubtaskInTasks,
  toggleTaskInTasks,
} from "../../../../../domain/tasks";
import { DailyPlanReview } from "./DailyPlanReview";
import { PlanningIntro } from "./PlanningIntro";
import { YesterdayReview } from "./YesterdayReview";

const laneMinutesLabel = (minutes) => minutes ? minutesLabel(minutes) : "0:00";

const buildDailyPlanText = (tasks) => {
  const planTasks = tasks.filter((task) => task.id !== "planning");
  return `Planned for today\n${planTasks.map((task) => `• ${task.title} · ${task.minutes >= 60 ? `${Math.round(task.minutes / 60)} hr` : `${task.minutes} min`}`).join("\n")}\n\nObstacles in my way\n• `;
};

export function DailyPlanningView({
  areas = DEFAULT_AREAS,
  tasks,
  setTasks,
  datedTasksByDate,
  setDatedTasksByDate,
  events,
  setEvents,
  objectives,
  setObjectives,
  weeklyFocusedObjectives,
  setWeeklyFocusedObjectives,
  rightPanelUnavailableTaskIds,
  backlogGroups,
  setBacklogGroups,
  activeRightPane,
  onRightPaneChange,
  onRevealCalendar,
  step,
  setStep,
  onDone,
  onCreateBoardTask,
  onCreateCalendarTask,
  onCompleteUndatedTask,
  setToast,
  onAssignObjective,
  onQuickSchedule,
  onUnscheduleTask,
  onOpenObjective,
  onOpenTask,
}) {
  const TOMORROW_DATE_KEY = addDays(CURRENT_DATE_KEY, 1);
  const NEXT_WEEK_DATE_KEY = addDays(mondayOf(CURRENT_DATE_KEY), 7);
  const SHUTDOWN_EVENT_ID = `shutdown:${CURRENT_DATE_KEY}`;
  const yesterdayTasks = datedTasksByDate[addDays(CURRENT_DATE_KEY, -1)] || [];
  const [planText, setPlanText] = useWorkspaceState("daily.planText", () => buildDailyPlanText(tasks));
  const shutdownEvent = events.find((event) => event.id === SHUTDOWN_EVENT_ID);
  const savedShutdownStart = shutdownEvent?.start;
  const [shutdownTime, setShutdownTime] = useWorkspaceState("daily.shutdownTime", () => (
    Number.isFinite(savedShutdownStart) ? timeLabel(savedShutdownStart) : "19:00"
  ));
  useEffect(() => {
    setShutdownTime(Number.isFinite(savedShutdownStart) ? timeLabel(savedShutdownStart) : "19:00");
  }, [savedShutdownStart]);
  const [calendarFocusRequest, setCalendarFocusRequest] = useState(null);
  const scheduleShutdown = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(shutdownTime)) return;
    const [hours, minutes] = shutdownTime.split(":").map(Number);
    const start = hours * 60 + minutes;
    setEvents((items) => [
      ...items.filter((event) => event.id !== SHUTDOWN_EVENT_ID),
      {
        id: SHUTDOWN_EVENT_ID,
        kind: "shutdown",
        dateKey: CURRENT_DATE_KEY,
        title: "Shutdown time",
        start,
        end: start,
      },
    ]);
    onRevealCalendar();
    setCalendarFocusRequest({ dateKey: CURRENT_DATE_KEY, start });
    setToast(`Shutdown time ${shutdownEvent ? "updated to" : "set for"} ${shutdownTime}.`);
  };
  const [selectedAreaIds, setSelectedAreaIds] = useState([]);
  const [yesterdayTaskIdsByLane, setYesterdayTaskIdsByLane] = useWorkspaceState("daily.yesterdayTaskIdsByLane", {
    worked: yesterdayTasks.filter((task) => task.complete || task.actualMinutes > 0).map((task) => task.id),
    missed: yesterdayTasks.filter((task) => !task.complete && !(task.actualMinutes > 0)).map((task) => task.id),
  });
  const updateAllTaskPools = (updater) => {
    setTasks(updater);
    setDatedTasksByDate((current) => Object.fromEntries(
      Object.entries(current).map(([dateKey, dateTasks]) => [dateKey, updater(dateTasks)]),
    ));
  };
  const toggle = (id) => {
    const sourceTask = tasks.find((task) => task.id === id)
      || Object.values(datedTasksByDate)
        .flat()
        .find((task) => task.id === id);
    if (!sourceTask) return;

    const complete = !sourceTask.complete;
    updateAllTaskPools((items) => toggleTaskInTasks(items, id));
    setObjectives((items) => (
      setTaskCompletionInObjectiveMirrors(items, id, complete)
    ));
    setEvents((items) => items.map((event) => (
      event.id === id ? { ...event, complete } : event
    )));
  };
  const toggleSubtask = (taskId, subtaskId) => updateAllTaskPools((items) => toggleSubtaskInTasks(items, taskId, subtaskId));
  const goToStep = (nextStep) => {
    if (nextStep === 1) onRightPaneChange("backlog");
    if (nextStep === 3) onRightPaneChange("calendar");
    setStep(nextStep);
  };

  const areaFilterProps = {
    showDate: false,
    areas,
    selectedAreaIds,
    onAreaFilterChange: setSelectedAreaIds,
  };
  const visibleTasks = filterItemsByArea(tasks, selectedAreaIds, areas);

  const plannedMinutes = visibleTasks.filter((task) => !task.complete).reduce((sum, task) => sum + task.minutes, 0);
  const moveYesterdayTask = (move) => {
    setYesterdayTaskIdsByLane((lanes) => moveItemBetweenLanes({
      lanes,
      ...move,
      getItemId: (itemId) => itemId,
    }));
  };

  if (step === 0) {
    return (
      <YesterdayReview
        tasks={filterItemsByArea(yesterdayTasks, selectedAreaIds, areas)}
        areaFilterProps={areaFilterProps}
        taskIdsByLane={yesterdayTaskIdsByLane}
        setTaskIdsByLane={setYesterdayTaskIdsByLane}
        onMoveTask={moveYesterdayTask}
        onToggle={toggle}
        onToggleSubtask={toggleSubtask}
        onCreateBoardTask={onCreateBoardTask}
        onNext={() => goToStep(1)}
        onOpenTotal={() => setToast(`Yesterday: ${minutesLabel(yesterdayTasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0))} logged.`)}
        onAssignObjective={onAssignObjective}
        projects={objectives}
        onOpenTask={onOpenTask}
      />
    );
  }

  if (step === 4) {
    return (
      <DailyPlanReview
        tasks={visibleTasks}
        allTasks={tasks}
        areaFilterProps={areaFilterProps}
        planText={planText}
        setPlanText={setPlanText}
        onToggle={toggle}
        onToggleSubtask={toggleSubtask}
        onAssignObjective={onAssignObjective}
        projects={objectives}
        onOpenTask={onOpenTask}
        onBack={() => goToStep(3)}
        onDone={onDone}
      />
    );
  }

  const planningStage = step - 1;
  const prioritizeLanes = [
    {
      dateKey: CURRENT_DATE_KEY,
      title: "Today",
      helper: "Keep only what's essential",
      total: minutesLabel(plannedMinutes),
      tasks: visibleTasks,
      allTasks: tasks,
    },
    {
      dateKey: TOMORROW_DATE_KEY,
      title: "Tomorrow",
      helper: "Drag over tasks that can wait",
      total: laneMinutesLabel(filterItemsByArea(datedTasksByDate[TOMORROW_DATE_KEY] || [], selectedAreaIds, areas).reduce((sum, task) => sum + task.minutes, 0)),
      tasks: filterItemsByArea(datedTasksByDate[TOMORROW_DATE_KEY] || [], selectedAreaIds, areas),
      allTasks: datedTasksByDate[TOMORROW_DATE_KEY] || [],
    },
    {
      dateKey: NEXT_WEEK_DATE_KEY,
      title: "Next week",
      helper: "Drag over tasks that can wait",
      total: laneMinutesLabel(filterItemsByArea(datedTasksByDate[NEXT_WEEK_DATE_KEY] || [], selectedAreaIds, areas).reduce((sum, task) => sum + task.minutes, 0)),
      tasks: filterItemsByArea(datedTasksByDate[NEXT_WEEK_DATE_KEY] || [], selectedAreaIds, areas),
      allTasks: datedTasksByDate[NEXT_WEEK_DATE_KEY] || [],
    },
  ];

  return (
    <div className="surface-row planning-row">
      <section className="planning-surface">
        <TopControls {...areaFilterProps} />
        <div className="planning-body" data-board-scroll-container="true">
          <PlanningIntro
            step={planningStage}
            shutdownTime={shutdownTime}
            onShutdownTimeChange={setShutdownTime}
            onScheduleShutdown={scheduleShutdown}
            onRemoveShutdown={() => {
              setEvents((items) => items.filter((event) => event.id !== SHUTDOWN_EVENT_ID));
              setCalendarFocusRequest(null);
              setToast("Shutdown time removed.");
            }}
            shutdownScheduled={Boolean(shutdownEvent)}
            onBack={() => goToStep(planningStage === 2 ? 1 : step - 1)}
            onNext={() => goToStep(planningStage === 0 ? 3 : step + 1)}
            onFinish={() => {
              setPlanText(buildDailyPlanText(tasks));
              goToStep(4);
            }}
          />
          {planningStage === 1 ? (
            <div className="prioritize-columns">
              {prioritizeLanes.map((lane) => (
                <SortableTaskLane
                  as="div"
                  boardSurfaceId="daily-planning-prioritize-board"
                  className="prioritize-board-lane"
                  dateKey={lane.dateKey}
                  key={lane.dateKey}
                  tasks={lane.tasks}
                  allTasks={lane.allTasks}
                >
                  {({ taskBoardProps }) => (
                    <>
                      <h2>{lane.title}</h2><p>{lane.helper}</p>
                      <InlineTaskStack
                        dateKey={lane.dateKey}
                        firstTaskId={lane.tasks[0]?.id}
                        onCreateTask={onCreateBoardTask}
                        total={`Work: ${lane.total}`}
                      >
                        {lane.tasks.map((task, visibleIndex) => (
                          <TaskCard
                            task={task}
                            key={task.id}
                            {...taskBoardProps(task, visibleIndex)}
                            onToggle={toggle}
                            onToggleSubtask={toggleSubtask}
                            onAssignObjective={onAssignObjective}
                            projects={objectives}
                            onOpen={onOpenTask}
                            compact
                          />
                        ))}
                      </InlineTaskStack>
                    </>
                  )}
                </SortableTaskLane>
              ))}
            </div>
          ) : (
            <SortableTaskLane
              as="div"
              boardSurfaceId={`daily-planning-${planningStage === 0 ? "fill" : "order"}-board`}
              className="planning-task-list"
              dateKey={CURRENT_DATE_KEY}
              tasks={visibleTasks}
              allTasks={tasks}
            >
              {({ taskBoardProps }) => (
                <>
                  <h2>Today</h2>
                  <p>{planningStage === 0 ? "Fill in your work for today" : "Drag your first tasks to the top"}</p>
                  <InlineTaskStack
                    dateKey={CURRENT_DATE_KEY}
                    firstTaskId={visibleTasks[0]?.id}
                    onCreateTask={onCreateBoardTask}
                    total={`Work: ${laneMinutesLabel(plannedMinutes)}`}
                  >
                    {visibleTasks.map((task, index) => (
                      <TaskCard
                        task={task}
                        key={task.id}
                        {...taskBoardProps(task, index)}
                        onToggle={toggle}
                        onToggleSubtask={toggleSubtask}
                        onAssignObjective={onAssignObjective}
                        onOpen={onOpenTask}
                        onUnschedule={onUnscheduleTask}
                        onSchedule={onQuickSchedule
                          ? (source) => onQuickSchedule(task, CURRENT_DATE_KEY, source)
                          : undefined}
                        projects={objectives}
                      />
                    ))}
                  </InlineTaskStack>
                </>
              )}
            </SortableTaskLane>
          )}
        </div>
      </section>
      <RightPanel
        areas={areas}
        activePane={activeRightPane}
        onPaneChange={onRightPaneChange}
        tasks={tasks}
        setTasks={setTasks}
        datedTasksByDate={datedTasksByDate}
        setDatedTasksByDate={setDatedTasksByDate}
        events={events}
        calendarFocusRequest={calendarFocusRequest}
        setEvents={setEvents}
        visibleTaskIds={selectedAreaIds.length ? visibleTasks.map((task) => task.id) : null}
        objectives={objectives}
        setObjectives={setObjectives}
        weeklyFocusedObjectives={weeklyFocusedObjectives}
        setWeeklyFocusedObjectives={setWeeklyFocusedObjectives}
        unavailableTaskIds={rightPanelUnavailableTaskIds}
        backlogGroups={backlogGroups}
        setBacklogGroups={setBacklogGroups}
        onCreateBoardTask={onCreateBoardTask}
        onCreateCalendarTask={onCreateCalendarTask}
        onCompleteUndatedTask={onCompleteUndatedTask}
        onAssignObjective={onAssignObjective}
        onQuickSchedule={onQuickSchedule}
        onUnscheduleTask={onUnscheduleTask}
        onOpenObjective={onOpenObjective}
        onOpenTask={onOpenTask}
      />
    </div>
  );
}

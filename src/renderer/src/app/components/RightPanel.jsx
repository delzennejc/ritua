import { ChoiceDropdown } from "./Dropdown";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CalendarBlank,
  CheckCircle,
  ClipboardText,
  Lightning,
  Plus,
  SidebarSimple,
  Stack,
  PushPin,
  X,
} from "@phosphor-icons/react";
import { DEFAULT_AREAS } from "../../../../domain/workspace-defaults";
import { useAutoSchedule } from "./AutoScheduleAnimation";
import {
  moveItemBetweenLanes,
  RIGHT_PANEL_BACKLOG_COLLECTION_ID,
} from "../utils/collections";
import { CURRENT_DATE_KEY, calendarDaysAround, dateFromKey } from "../utils/dates";
import { minutesLabel } from "../utils/time";
import {
  setTaskCompletionInObjectiveMirrors,
  toggleSubtaskInTasks,
  toggleTaskInTasks,
} from "../../../../domain/tasks";
import { useInlineProjectComposer } from "../hooks/useInlineProjectComposer";
import { AutoGrowingTextarea } from "./DetailsTitleInput";
import { InlineTaskStack } from "./InlineTaskStack";
import { CalendarPane } from "./CalendarPanel";
import { FolderLabel } from "./FolderLabel";
import { BacklogTaskRow } from "./BacklogTaskRow";
import {
  SortableCollectionDropProxy,
  SortableCollectionLane,
} from "./SortableCollection";
import { SortableTaskLane } from "./SortableTaskLane";
import { TaskCard } from "./TaskCard";
import { DateControl } from "./TopControls";
import { WeeklyObjectiveCard } from "./WeeklyObjectiveCard";

const RIGHT_PANEL_PANES = [
  { id: "calendar", label: "Calendar", icon: CalendarBlank },
  { id: "board", label: "Board", icon: SidebarSimple },
  { id: "objectives", label: "Projects", icon: PushPin },
  { id: "backlog", label: "Tasks", icon: Stack },
  { id: "latest-updates", label: "Latest Updates", icon: Lightning },
];

const UPDATE_ICONS = {
  feature: Lightning,
  improvement: CheckCircle,
  announcement: ClipboardText,
};

const isFocusedThisWeek = (objective) => objective.focusedThisWeek !== false;
const THIS_WEEK_OBJECTIVE_LANE = "this-week-projects";
const OTHER_OBJECTIVE_LANE = "other-projects";
const TASK_TEMPORAL_DIVIDER_ANIMATION_MS = 180;
const TASK_TEMPORAL_DIVIDER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const PRODUCT_UPDATES = [];
const rightPanelTaskLaneId = (horizon, groupLabel, objectiveId = null) => (
  `${horizon}::${groupLabel}::${objectiveId || "standalone"}`
);

function TaskTemporalDivider({ groupLabel, laneId, layoutRevision }) {
  const dividerRef = useRef(null);
  const previousTopRef = useRef(null);
  const animationRef = useRef(null);

  useLayoutEffect(() => {
    const divider = dividerRef.current;
    if (!divider) return;

    const scrollContainer = divider.closest(".backlog-pane-content");
    const measureTop = () => {
      const dividerTop = divider.getBoundingClientRect().top;
      if (!scrollContainer) return dividerTop;
      return dividerTop
        - scrollContainer.getBoundingClientRect().top
        + scrollContainer.scrollTop;
    };

    const activeAnimation = animationRef.current;
    const previousTop = activeAnimation
      ? measureTop()
      : previousTopRef.current;
    if (activeAnimation) {
      activeAnimation.cancel();
      animationRef.current = null;
    }

    const nextTop = measureTop();
    previousTopRef.current = nextTop;
    const deltaY = previousTop === null ? 0 : previousTop - nextTop;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || Math.abs(deltaY) < 0.5) return;

    const animation = divider.animate(
      [
        { transform: `translate3d(0, ${deltaY}px, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ],
      {
        duration: TASK_TEMPORAL_DIVIDER_ANIMATION_MS,
        easing: TASK_TEMPORAL_DIVIDER_EASING,
        fill: "both",
      },
    );
    animationRef.current = animation;
    animation.onfinish = () => {
      if (animationRef.current !== animation) return;
      animation.cancel();
      animationRef.current = null;
    };
  }, [layoutRevision]);

  useEffect(() => () => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);

  return (
    <div
      ref={dividerRef}
      aria-label={`${groupLabel} tasks`}
      className="right-panel-task-temporal-divider"
      data-task-temporal-divider-id={laneId}
      role="separator"
    >
      <span>{groupLabel}</span>
    </div>
  );
}

function orderObjectivesForPanel(objectives, weeklyFocusedObjectives = []) {
  const focusedOrderIndex = new Map(
    weeklyFocusedObjectives.map((objective, index) => [objective.id, index]),
  );
  return [
    ...objectives
      .filter(isFocusedThisWeek)
      .sort((first, second) => (
        (focusedOrderIndex.get(first.id) ?? Number.MAX_SAFE_INTEGER)
        - (focusedOrderIndex.get(second.id) ?? Number.MAX_SAFE_INTEGER)
      )),
    ...objectives.filter((objective) => !isFocusedThisWeek(objective)),
  ];
}

function applyObjectiveGroupOrder(objectives, orderedGroup, matchesGroup) {
  const objectivesById = new Map(objectives.map((objective) => [
    objective.id,
    objective,
  ]));
  let groupIndex = 0;

  return objectives.map((objective) => (
    matchesGroup(objective)
      ? objectivesById.get(orderedGroup[groupIndex++]?.id) || objective
      : objective
  ));
}

function applyPanelObjectiveLanes(objectives, lanes, preserveFocusedOrder) {
  const focusedIds = new Set(
    lanes[THIS_WEEK_OBJECTIVE_LANE].map((objective) => objective.id),
  );
  let nextObjectives = objectives.map((objective) => ({
    ...objective,
    focusedThisWeek: focusedIds.has(objective.id),
  }));
  nextObjectives = applyObjectiveGroupOrder(
    nextObjectives,
    lanes[OTHER_OBJECTIVE_LANE],
    (objective) => !isFocusedThisWeek(objective),
  );

  return preserveFocusedOrder
    ? nextObjectives
    : applyObjectiveGroupOrder(
        nextObjectives,
        lanes[THIS_WEEK_OBJECTIVE_LANE],
        isFocusedThisWeek,
      );
}

function UtilityPaneToolbar({ children }) {
  return (
    <div
      className="utility-pane-toolbar day-summary-header"
      aria-hidden={children ? undefined : true}
    >
      {children}
    </div>
  );
}

function UtilityPaneHeading({ icon: Icon, title, children }) {
  return (
    <header className="utility-pane-heading">
      <span className="utility-pane-heading-title">
        {Icon ? <Icon size={20} /> : null}
        <h2>{title}</h2>
      </span>
      {children}
    </header>
  );
}

function reorderProjectBacklogMirrors(objectives, groups) {
  const orderedTaskIdsByProject = new Map();

  groups.forEach((group) => {
    group.items.forEach((task) => {
      if (!task.objectiveId) return;
      const orderedIds = orderedTaskIdsByProject.get(task.objectiveId) || [];
      orderedIds.push(task.id);
      orderedTaskIdsByProject.set(task.objectiveId, orderedIds);
    });
  });

  return objectives.map((objective) => {
    const orderedIds = orderedTaskIdsByProject.get(objective.id);
    if (!orderedIds?.length || !objective.tasks?.length) return objective;

    const orderedIdSet = new Set(orderedIds);
    const mirrorsByTaskId = new Map(objective.tasks.map((task) => [
      task.taskId || task.id,
      task,
    ]));
    const reorderedMirrors = orderedIds
      .map((taskId) => mirrorsByTaskId.get(taskId))
      .filter(Boolean);
    if (reorderedMirrors.length < 2) return objective;

    let mirrorIndex = 0;
    return {
      ...objective,
      tasks: objective.tasks.map((task) => (
        orderedIdSet.has(task.taskId || task.id)
          ? reorderedMirrors[mirrorIndex++]
          : task
      )),
    };
  });
}

function BoardPane({
  tasks,
  setTasks,
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
  toolbarContent,
}) {
  const boardSurfaceId = "right-panel-board";
  const visibleTaskIdSet = visibleTaskIds ? new Set(visibleTaskIds) : null;
  const visibleTasks = tasks.filter((task) => (
    !visibleTaskIdSet || visibleTaskIdSet.has(task.id)
  ));
  const selectedDate = dateFromKey(dateKey);
  const dayName = selectedDate.toLocaleDateString("en-US", { weekday: "long" });
  const dateLabel = selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const openMinutes = visibleTasks
    .filter((task) => !task.complete)
    .reduce((sum, task) => sum + task.minutes, 0);
  const openMinutesLabel = openMinutes ? minutesLabel(openMinutes) : "0:00";
  const toggleTask = (id) => {
    const sourceTask = tasks.find((task) => task.id === id);
    if (!sourceTask) return;
    const complete = !sourceTask.complete;

    setTasks?.((items) => toggleTaskInTasks(items, id));
    setObjectives?.((items) => (
      setTaskCompletionInObjectiveMirrors(items, id, complete)
    ));
    setEvents?.((items) => items.map((event) => (
      event.id === id ? { ...event, complete } : event
    )));
  };
  const toggleSubtask = (taskId, subtaskId) => setTasks?.((items) => toggleSubtaskInTasks(items, taskId, subtaskId));

  return (
    <div className="utility-pane right-panel-board">
      <div className="utility-pane-header day-summary-header">
        {toolbarContent}
      </div>
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
              <h2>{dayName}</h2>
              <p>{dateLabel}</p>
              {dateKey === CURRENT_DATE_KEY ? <span className="day-progress" role="progressbar" aria-label="Today task completion" aria-valuemin={0} aria-valuemax={visibleTasks.length || 1} aria-valuenow={visibleTasks.filter((task) => task.complete).length}><span style={{ width: `${visibleTasks.length ? visibleTasks.filter((task) => task.complete).length / visibleTasks.length * 100 : 0}%` }} /></span> : null}
            </header>
            <InlineTaskStack
              dateKey={dateKey}
              firstTaskId={visibleTasks[0]?.id}
              onCreateTask={onCreateBoardTask}
              total={openMinutesLabel}
              addRowClassName="right-panel-add-task"
              stackClassName="right-panel-task-stack"
            >
              {visibleTasks.map((task, visibleIndex) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  projects={objectives}
                  {...taskBoardProps(task, visibleIndex)}
                  onToggle={toggleTask}
                  onToggleSubtask={toggleSubtask}
                  onAssignObjective={onAssignObjective}
                  onOpen={onOpenTask}
                  onUnschedule={onUnscheduleTask}
                  onSchedule={onQuickSchedule
                    ? (source) => onQuickSchedule(task, dateKey, source)
                    : undefined}
                />
              ))}
              {!visibleTasks.length ? <p className="utility-empty">No tasks for this day.</p> : null}
            </InlineTaskStack>
          </>
        )}
      </SortableTaskLane>
    </div>
  );
}

function ObjectivesPane({
  objectives,
  setObjectives,
  onFocusObjectiveInWeek,
  onOpenObjective,
  weeklyFocusedObjectives,
  setWeeklyFocusedObjectives,
  toolbarContent,
}) {
  const completeCount = objectives.filter((objective) => objective.complete).length;
  const completionProgress = objectives.length ? Math.round((completeCount / objectives.length) * 100) : 0;
  const sharesWeeklyOrder = Boolean(
    weeklyFocusedObjectives && setWeeklyFocusedObjectives,
  );
  const panelObjectives = orderObjectivesForPanel(
    objectives,
    weeklyFocusedObjectives,
  );
  const panelFocusedObjectives = panelObjectives.filter(isFocusedThisWeek);
  const panelOtherObjectives = panelObjectives.filter(
    (objective) => !isFocusedThisWeek(objective),
  );
  const panelLanesRef = useRef({
    [THIS_WEEK_OBJECTIVE_LANE]: panelFocusedObjectives,
    [OTHER_OBJECTIVE_LANE]: panelOtherObjectives,
  });
  panelLanesRef.current = {
    [THIS_WEEK_OBJECTIVE_LANE]: panelFocusedObjectives,
    [OTHER_OBJECTIVE_LANE]: panelOtherObjectives,
  };
  const addObjective = (title) => {
    const id = `objective-${Date.now()}`;
    const objective = {
      id,
      title,
      channel: "Ritua",
      complete: false,
      focusedThisWeek: true,
      tasks: [],
    };
    setObjectives?.((items) => [objective, ...items]);
    if (sharesWeeklyOrder) {
      setWeeklyFocusedObjectives((items) => [objective, ...items]);
    }
    return id;
  };
  const {
    addingObjective,
    cancelAdding,
    draftInputRef,
    draftTitle,
    finishAdding,
    setDraftTitle,
    settlingObjectiveId,
    startAdding,
    submitObjective,
  } = useInlineProjectComposer(addObjective);
  const toggleObjective = (id) => setObjectives?.((items) => items.map((objective) => (
    objective.id === id ? { ...objective, complete: !objective.complete } : objective
  )));
  const moveWeeklyObjective = (move) => {
    const currentLanes = panelLanesRef.current;
    const sourceLaneId = currentLanes[THIS_WEEK_OBJECTIVE_LANE]
      .some((objective) => objective.id === move.itemId)
      ? THIS_WEEK_OBJECTIVE_LANE
      : OTHER_OBJECTIVE_LANE;
    const nextLanes = moveItemBetweenLanes({
      lanes: currentLanes,
      ...move,
      sourceLaneId,
    });
    panelLanesRef.current = nextLanes;

    if (sharesWeeklyOrder) {
      setWeeklyFocusedObjectives(nextLanes[THIS_WEEK_OBJECTIVE_LANE]);
    }
    setObjectives?.((items) => applyPanelObjectiveLanes(
      items,
      nextLanes,
      sharesWeeklyOrder,
    ));
  };
  const panelCollectionSnapshot = sharesWeeklyOrder
    ? { objectives, weeklyFocusedObjectives }
    : objectives;
  const restorePanelObjectives = (snapshot) => {
    if (!sharesWeeklyOrder) {
      setObjectives?.(snapshot);
      return;
    }
    setObjectives?.(snapshot.objectives);
    setWeeklyFocusedObjectives(snapshot.weeklyFocusedObjectives);
  };

  return (
    <div className="utility-pane objectives-pane">
      <UtilityPaneToolbar>{toolbarContent}</UtilityPaneToolbar>
      <div className="utility-pane-content objectives-pane-content">
        <header className="right-panel-objectives-heading">
          <h2>Projects</h2>
          <p>Track your active work</p>
          <span
            className="day-progress right-panel-objectives-progress"
            role="progressbar"
            aria-label="Projects completed"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={completionProgress}
          >
            <span style={{ width: `${completionProgress}%` }} />
          </span>
        </header>
        {addingObjective ? (
          <form
            className="add-row right-panel-add-objective weekly-objective-create-form"
            onSubmit={submitObjective}
          >
            <Plus size={15} />
            <AutoGrowingTextarea
              ref={draftInputRef}
              aria-label="New project"
              autoComplete="off"
              placeholder="New project"
              value={draftTitle}
              onBlur={finishAdding}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  finishAdding();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelAdding();
                }
              }}
            />
          </form>
        ) : (
          <button
            className={`add-row right-panel-add-objective ${settlingObjectiveId ? "is-reappearing" : ""}`.trim()}
            type="button"
            onClick={startAdding}
          >
            <Plus size={15} /> New project
          </button>
        )}
        <div className="weekly-objective-stack right-panel-objective-stack">
          <div
            aria-label="This week projects"
            className="right-panel-objective-divider"
            role="separator"
          >
            <span>This week</span>
          </div>
          <SortableCollectionLane
            className={`right-panel-objective-group weekly-focus-objective-stack ${settlingObjectiveId ? "is-settling-project" : ""}`.trim()}
            collectionId="weekly-objectives"
            collectionSnapshot={panelCollectionSnapshot}
            externalDropData={onFocusObjectiveInWeek ? { onFocusObjectiveInWeek } : undefined}
            items={panelFocusedObjectives}
            laneId={THIS_WEEK_OBJECTIVE_LANE}
            onMove={moveWeeklyObjective}
            onRestore={restorePanelObjectives}
            surfaceId="right-panel-objectives"
          >
            {({ collectionItemProps }) => panelFocusedObjectives.map((objective, index) => (
              <WeeklyObjectiveCard
                className={objective.id === settlingObjectiveId ? "newly-created" : ""}
                collectionItem={collectionItemProps(objective, index)}
                key={objective.id}
                objective={objective}
                onOpen={onOpenObjective}
                onToggle={toggleObjective}
                showThisWeekLabel
              />
            ))}
          </SortableCollectionLane>
          <div
            aria-label="Later project boundary"
            className="right-panel-objective-divider right-panel-objective-boundary"
            role="separator"
          >
            <span>Later</span>
          </div>
          <SortableCollectionLane
            className="right-panel-objective-group"
            collectionId="weekly-objectives"
            collectionSnapshot={panelCollectionSnapshot}
            externalDropData={onFocusObjectiveInWeek ? { onFocusObjectiveInWeek } : undefined}
            items={panelOtherObjectives}
            laneId={OTHER_OBJECTIVE_LANE}
            onMove={moveWeeklyObjective}
            onRestore={restorePanelObjectives}
            surfaceId="right-panel-objectives"
          >
            {({ collectionItemProps }) => (
              <>
                {panelOtherObjectives.map((objective, index) => (
                  <WeeklyObjectiveCard
                    collectionItem={collectionItemProps(objective, index)}
                    key={objective.id}
                    objective={objective}
                    onOpen={onOpenObjective}
                    onToggle={toggleObjective}
                  />
                ))}
                {!objectives.length ? <p className="utility-empty">No projects yet.</p> : null}
              </>
            )}
          </SortableCollectionLane>
        </div>
      </div>
    </div>
  );
}

function BacklogPane({
  areas = DEFAULT_AREAS,
  groups,
  objectives = [],
  onCompleteUndatedTask,
  onOpenObjective,
  onOpenTask,
  setGroups,
  setObjectives,
  unavailableTaskIds = [],
  weeklyFocusedObjectives,
  toolbarContent,
}) {
  const defaultArea = areas[0]?.label || "Ritua";
  const [taskHorizon, setTaskHorizon] = useState("this-week");
  const [editingGroup, setEditingGroup] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftArea, setDraftArea] = useState(defaultArea);
  const draftInputRef = useRef(null);
  const returnFocusRef = useRef(null);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const anytimeGroup = groups.find((group) => group.label === "Anytime")
    || { id: "anytime", label: "Anytime", items: [] };
  const somedayGroup = groups.find((group) => group.label === "Someday")
    || { id: "someday", label: "Someday", items: [] };
  const unavailableTaskIdSet = new Set(unavailableTaskIds);
  const visibleAnytimeTasks = anytimeGroup.items.filter((task) => (
    !unavailableTaskIdSet.has(task.id)
  ));
  const visibleSomedayTasks = somedayGroup.items.filter((task) => (
    !unavailableTaskIdSet.has(task.id)
  ));
  const focusedProjects = (
    Array.isArray(weeklyFocusedObjectives)
      ? weeklyFocusedObjectives
      : objectives.filter(isFocusedThisWeek)
  ).filter(isFocusedThisWeek);
  const thisWeekProjectSections = focusedProjects.map((objective) => ({
    objective,
    anytimeTasks: visibleAnytimeTasks.filter((task) => task.objectiveId === objective.id),
    somedayTasks: [],
  })).filter(({ objective, anytimeTasks }) => (
    anytimeTasks.length || !objective.complete
  ));
  const standaloneAnytimeTasks = visibleAnytimeTasks.filter((task) => !task.objectiveId);
  const standaloneSomedayTasks = visibleSomedayTasks.filter((task) => !task.objectiveId);
  const laterProjectSections = orderObjectivesForPanel(
    objectives,
    weeklyFocusedObjectives,
  ).map((objective) => ({
    objective,
    anytimeTasks: visibleAnytimeTasks.filter((task) => task.objectiveId === objective.id),
    somedayTasks: visibleSomedayTasks.filter((task) => task.objectiveId === objective.id),
  })).filter(({ objective, anytimeTasks, somedayTasks }) => (
    anytimeTasks.length || somedayTasks.length || !objective.complete
  ));
  const temporalDividerRevision = JSON.stringify([
    [
      "standalone",
      standaloneAnytimeTasks.map((task) => task.id),
      standaloneSomedayTasks.map((task) => task.id),
    ],
    ...laterProjectSections.map(({ objective, anytimeTasks, somedayTasks }) => ([
      objective.id,
      anytimeTasks.map((task) => task.id),
      somedayTasks.map((task) => task.id),
    ])),
  ]);
  const thisWeekTaskCount = thisWeekProjectSections.reduce((sum, section) => (
    sum + section.anytimeTasks.length
  ), standaloneAnytimeTasks.length);
  const laterTaskCount = laterProjectSections.reduce((sum, section) => (
    sum + section.anytimeTasks.length + section.somedayTasks.length
  ), standaloneAnytimeTasks.length + standaloneSomedayTasks.length);
  const visibleTaskCount = taskHorizon === "this-week"
    ? thisWeekTaskCount
    : laterTaskCount;
  const moveBacklogTask = ({
    itemId,
    targetData,
    targetIndex,
  }) => {
    const currentGroups = groupsRef.current;
    const targetGroupLabel = targetData?.backlogGroupLabel;
    const targetObjectiveId = targetData?.backlogObjectiveId || null;
    const targetProject = targetObjectiveId
      ? objectives.find((objective) => objective.id === targetObjectiveId)
      : null;
    const sourceTask = currentGroups
      .flatMap((group) => group.items)
      .find((task) => task.id === itemId);
    const dragOriginTask = groups
      .flatMap((group) => group.items)
      .find((task) => task.id === itemId);
    if (
      !sourceTask
      || !targetGroupLabel
      || !currentGroups.some((group) => group.label === targetGroupLabel)
      || (targetObjectiveId && !targetProject)
    ) return;

    const previousObjectiveId = sourceTask.objectiveId || null;
    const movedTask = {
      ...sourceTask,
      ...(targetProject ? {
        channel: targetProject.channel,
        objectiveId: targetProject.id,
      } : {
        channel: dragOriginTask?.channel || sourceTask.channel,
      }),
    };
    if (!targetProject) delete movedTask.objectiveId;

    const groupsWithoutTask = currentGroups.map((group) => ({
      ...group,
      items: group.items.filter((task) => task.id !== itemId),
    }));
    const nextGroups = groupsWithoutTask.map((group) => {
      if (group.label !== targetGroupLabel) return group;
      const belongsToTargetLane = (task) => (
        targetObjectiveId
          ? task.objectiveId === targetObjectiveId
          : !task.objectiveId
      );
      const visibleTargetItems = group.items.filter((task) => (
        !unavailableTaskIdSet.has(task.id) && belongsToTargetLane(task)
      ));
      const insertionLaneIndex = Math.max(
        0,
        Math.min(
          Number.isFinite(targetIndex) ? targetIndex : visibleTargetItems.length,
          visibleTargetItems.length,
        ),
      );
      const referenceTask = visibleTargetItems[insertionLaneIndex];
      const lastLaneTask = visibleTargetItems[visibleTargetItems.length - 1];
      const insertionIndex = referenceTask
        ? group.items.findIndex((task) => task.id === referenceTask.id)
        : lastLaneTask
          ? group.items.findIndex((task) => task.id === lastLaneTask.id) + 1
          : group.items.length;
      return {
        ...group,
        items: [
          ...group.items.slice(0, insertionIndex),
          movedTask,
          ...group.items.slice(insertionIndex),
        ],
      };
    });
    groupsRef.current = nextGroups;
    setGroups?.(nextGroups);
    setObjectives?.((items) => {
      let nextObjectives = items;
      if (previousObjectiveId !== targetObjectiveId) {
        const existingMirror = items
          .flatMap((objective) => objective.tasks || [])
          .find((task) => (task.taskId || task.id) === itemId);
        nextObjectives = items.map((objective) => ({
          ...objective,
          tasks: (objective.tasks || []).filter((task) => (
            (task.taskId || task.id) !== itemId
          )),
        }));
        if (targetObjectiveId) {
          nextObjectives = nextObjectives.map((objective) => (
            objective.id === targetObjectiveId
              ? {
                  ...objective,
                  tasks: [
                    ...(objective.tasks || []),
                    {
                      ...(existingMirror || {}),
                      id: existingMirror?.id || `objective-${itemId}`,
                      taskId: itemId,
                      title: movedTask.title,
                      minutes: existingMirror?.minutes || movedTask.minutes || 0,
                      complete: Boolean(movedTask.complete),
                    },
                  ],
                }
              : objective
          ));
        }
      }
      return reorderProjectBacklogMirrors(nextObjectives, nextGroups);
    });
  };
  const restoreBacklogCollection = (snapshot) => {
    groupsRef.current = snapshot.groups;
    setGroups?.(snapshot.groups);
    setObjectives?.(snapshot.objectives);
  };
  const toggleBacklogTask = (taskId) => {
    const task = groups.flatMap((group) => group.items).find((item) => item.id === taskId);
    if (!task) return;
    onCompleteUndatedTask?.(taskId);
  };
  useEffect(() => {
    if (editingGroup) draftInputRef.current?.focus();
  }, [editingGroup]);

  const startAddingTask = (sectionKey, returnFocusElement, projectId = "") => {
    returnFocusRef.current = returnFocusElement;
    setEditingGroup(sectionKey);
    setDraftTitle("");
    setDraftProjectId(projectId);
    setDraftArea(defaultArea);
    requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const cancelTaskDraft = () => {
    setEditingGroup(null);
    setDraftTitle("");
    setDraftProjectId("");
    setDraftArea(defaultArea);
    requestAnimationFrame(() => returnFocusRef.current?.focus?.());
  };

  const selectTaskHorizon = (horizon) => {
    setTaskHorizon(horizon);
    setEditingGroup(null);
    setDraftTitle("");
    setDraftProjectId("");
    setDraftArea(defaultArea);
  };

  const handleTaskHorizonKeyDown = (event) => {
    let nextHorizon;
    if (event.key === "ArrowLeft" || event.key === "Home") {
      nextHorizon = "this-week";
    } else if (event.key === "ArrowRight" || event.key === "End") {
      nextHorizon = "later";
    } else {
      return;
    }
    event.preventDefault();
    selectTaskHorizon(nextHorizon);
    requestAnimationFrame(() => (
      document.getElementById(`right-panel-task-horizon-tab-${nextHorizon}`)?.focus()
    ));
  };

  const createTask = (event, groupLabel, { preserveProject = false } = {}) => {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;
    const selectedProject = objectives.find((objective) => (
      objective.id === draftProjectId && !objective.complete
    ));
    if (draftProjectId && !selectedProject) return;
    const taskId = `backlog-${Date.now()}`;

    setGroups?.((items) => items.map((group) => (
      group.label === groupLabel
        ? {
            ...group,
            items: [
              ...group.items,
              {
                id: taskId,
                title,
                channel: selectedProject?.channel || draftArea,
                complete: false,
                ...(selectedProject ? { objectiveId: selectedProject.id } : {}),
              },
            ],
          }
        : group
    )));
    if (selectedProject) {
      setObjectives?.((items) => items.map((objective) => (
        objective.id === selectedProject.id
          ? {
              ...objective,
              tasks: [
                ...(objective.tasks || []),
                {
                  id: `objective-${taskId}`,
                  taskId,
                  title,
                  minutes: 0,
                  complete: false,
                },
              ],
            }
          : objective
      )));
    }
    setDraftTitle("");
    setDraftProjectId(preserveProject ? selectedProject?.id || "" : "");
    requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const renderBacklogTasks = (
    sectionTasks,
    sectionKey,
    groupLabel,
    objective = null,
  ) => (
    <SortableCollectionLane
      acceptExternalTaskDrop
      as="ul"
      className="right-panel-task-temporal-lane"
      collectionId={RIGHT_PANEL_BACKLOG_COLLECTION_ID}
      collectionSnapshot={{ groups, objectives }}
      externalDropData={{
        backlogDropTarget: true,
        backlogGroupLabel: groupLabel,
        backlogChannel: objective?.channel,
        backlogContextual: true,
        backlogObjectiveId: objective?.id || null,
      }}
      items={sectionTasks}
      laneId={sectionKey}
      onMove={moveBacklogTask}
      onRestore={restoreBacklogCollection}
      surfaceId="right-panel-backlog"
    >
      {({ collectionItemProps }) => (
        sectionTasks.map((item, index) => (
          <BacklogTaskRow
            collectionItem={collectionItemProps(item, index, { type: "backlog", variant: "panel" })}
            item={item}
            key={item.id}
            onOpen={onOpenTask}
            onToggle={toggleBacklogTask}
            variant="panel"
          />
        ))
      )}
    </SortableCollectionLane>
  );

  const renderTaskLaneDropProxy = (
    children,
    {
      groupLabel,
      horizon,
      insertionIndex,
      objective = null,
    },
  ) => (
    <SortableCollectionDropProxy
      acceptExternalTaskDrop
      collectionId={RIGHT_PANEL_BACKLOG_COLLECTION_ID}
      externalDropData={{
        backlogDropTarget: true,
        backlogGroupLabel: groupLabel,
        backlogChannel: objective?.channel,
        backlogContextual: true,
        backlogObjectiveId: objective?.id || null,
      }}
      insertionIndex={insertionIndex}
      laneId={rightPanelTaskLaneId(horizon, groupLabel, objective?.id)}
      proxyId="add-task"
      surfaceId="right-panel-backlog"
    >
      {children}
    </SortableCollectionDropProxy>
  );

  const renderTemporalLane = (
    sectionTasks,
    horizon,
    groupLabel,
    objective = null,
  ) => {
    const laneId = rightPanelTaskLaneId(horizon, groupLabel, objective?.id);
    return (
      <>
        <TaskTemporalDivider
          groupLabel={groupLabel}
          laneId={laneId}
          layoutRevision={temporalDividerRevision}
        />
        {renderBacklogTasks(
          sectionTasks,
          laneId,
          groupLabel,
          objective,
        )}
      </>
    );
  };

  const renderTaskDraft = (sectionKey, groupLabel, objective = null) => (
    editingGroup === sectionKey ? (
      <ul>
        <li className="right-panel-backlog-draft-shell">
          <form
            className={`right-panel-backlog-row right-panel-backlog-new-task-row ${
              objective ? "right-panel-project-task-draft" : ""
            }`}
            onBlur={(event) => {
              if (
                !draftTitle.trim()
                && !event.currentTarget.contains(event.relatedTarget)
                && !event.relatedTarget?.closest?.("[data-dropdown-root]")
              ) {
                cancelTaskDraft();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelTaskDraft();
              }
            }}
            onSubmit={(event) => createTask(event, groupLabel, {
              preserveProject: Boolean(objective),
            })}
          >
            <CheckCircle size={17} />
            <AutoGrowingTextarea
              ref={draftInputRef}
              aria-label={`New task in ${objective?.title || "Standalone"}`}
              autoComplete="off"
              placeholder="Type a task title"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  createTask(event, groupLabel, {
                    preserveProject: Boolean(objective),
                  });
                }
              }}
            />
            {!objective ? (
              <ChoiceDropdown label="Area for new standalone task" className="right-panel-task-area-select" value={draftArea} onChange={setDraftArea} options={areas.map((area) => ({ value: area.label, label: area.label }))} />
            ) : null}
          </form>
        </li>
      </ul>
    ) : null
  );

  const renderProjectSection = (
    { objective, anytimeTasks, somedayTasks },
    horizon,
  ) => {
    const sectionKey = `${horizon}-project-${objective.id}`;
    const taskCount = anytimeTasks.length + somedayTasks.length;
    const captureGroupLabel = horizon === "this-week" ? "Anytime" : "Someday";
    const addTaskButton = !objective.complete ? (
      <button
        className="backlog-add-task-button"
        type="button"
        aria-label={`Add task to ${objective.title}`}
        onClick={(event) => startAddingTask(
          sectionKey,
          event.currentTarget,
          objective.id,
        )}
      >
        <Plus size={15} /> Add new task
      </button>
    ) : null;
    return (
      <section
        className="right-panel-backlog-group right-panel-project-task-group"
        data-project-id={objective.id}
        key={objective.id}
      >
        <header>
          <button
            aria-label={`Open project ${objective.title}`}
            className="right-panel-project-heading-button"
            title={objective.title}
            type="button"
            onClick={(event) => onOpenObjective?.(objective, event.currentTarget)}
          >
            <FolderLabel channel={objective.channel} />
            <h3>{objective.title}</h3>
            <span className="right-panel-backlog-count">{taskCount}</span>
          </button>
        </header>
        {horizon === "later" ? (
          <>
            {renderTemporalLane(anytimeTasks, horizon, "Anytime", objective)}
            {renderTemporalLane(somedayTasks, horizon, "Someday", objective)}
          </>
        ) : renderBacklogTasks(
          anytimeTasks,
          rightPanelTaskLaneId(horizon, "Anytime", objective.id),
          "Anytime",
          objective,
        )}
        {renderTaskDraft(sectionKey, captureGroupLabel, objective)}
        {horizon === "this-week" && addTaskButton
          ? renderTaskLaneDropProxy(addTaskButton, {
              groupLabel: "Anytime",
              horizon,
              insertionIndex: anytimeTasks.length,
              objective,
            })
          : addTaskButton}
      </section>
    );
  };

  const renderStandaloneSection = ({ anytimeTasks, somedayTasks }, horizon) => {
    const sectionKey = `${horizon}-standalone`;
    const taskCount = horizon === "this-week"
      ? anytimeTasks.length
      : anytimeTasks.length + somedayTasks.length;
    const addTaskButton = (
      <button
        className="backlog-add-task-button"
        type="button"
        aria-label={`Add standalone task to ${horizon === "this-week" ? "This week" : "Later"}`}
        onClick={(event) => startAddingTask(sectionKey, event.currentTarget)}
      >
        <Plus size={15} /> Add new task
      </button>
    );
    return (
      <section className="right-panel-backlog-group right-panel-standalone-task-group">
        <header className="right-panel-standalone-heading">
          <span className="right-panel-standalone-icon" aria-hidden="true">
            <Stack size={14} />
          </span>
          <h3>Standalone</h3>
          <span className="right-panel-backlog-count">{taskCount}</span>
        </header>
        {horizon === "later" ? (
          <>
            {renderTemporalLane(anytimeTasks, horizon, "Anytime")}
            {renderTemporalLane(somedayTasks, horizon, "Someday")}
          </>
        ) : renderBacklogTasks(
          anytimeTasks,
          rightPanelTaskLaneId(horizon, "Anytime"),
          "Anytime",
        )}
        {renderTaskDraft(sectionKey, horizon === "this-week" ? "Anytime" : "Someday")}
        {horizon === "this-week"
          ? renderTaskLaneDropProxy(addTaskButton, {
              groupLabel: "Anytime",
              horizon,
              insertionIndex: anytimeTasks.length,
            })
          : addTaskButton}
      </section>
    );
  };

  return (
    <div className="utility-pane backlog-pane">
      <UtilityPaneToolbar>{toolbarContent}</UtilityPaneToolbar>
      <div className="utility-pane-content backlog-pane-content">
        <UtilityPaneHeading icon={Stack} title="Tasks">
          <span className="utility-pane-count">{visibleTaskCount}</span>
        </UtilityPaneHeading>
        <div
          className="right-panel-task-horizon-tabs"
          role="tablist"
          aria-label="Task horizon"
          onKeyDown={handleTaskHorizonKeyDown}
        >
          <button
            aria-controls="right-panel-task-horizon-this-week"
            aria-selected={taskHorizon === "this-week"}
            className={taskHorizon === "this-week" ? "active" : ""}
            id="right-panel-task-horizon-tab-this-week"
            role="tab"
            tabIndex={taskHorizon === "this-week" ? 0 : -1}
            type="button"
            onClick={() => selectTaskHorizon("this-week")}
          >
            This week
          </button>
          <button
            aria-controls="right-panel-task-horizon-later"
            aria-selected={taskHorizon === "later"}
            className={taskHorizon === "later" ? "active" : ""}
            id="right-panel-task-horizon-tab-later"
            role="tab"
            tabIndex={taskHorizon === "later" ? 0 : -1}
            type="button"
            onClick={() => selectTaskHorizon("later")}
          >
            Later
          </button>
        </div>
        <div
          aria-labelledby={`right-panel-task-horizon-tab-${taskHorizon}`}
          className={`right-panel-backlog-list right-panel-task-horizon-${taskHorizon}`}
          id={`right-panel-task-horizon-${taskHorizon}`}
          role="tabpanel"
        >
          {taskHorizon === "this-week" ? (
            <>
              {thisWeekProjectSections.map((section) => (
                renderProjectSection(section, "this-week")
              ))}
              {renderStandaloneSection({
                anytimeTasks: standaloneAnytimeTasks,
                somedayTasks: [],
              }, "this-week")}
            </>
          ) : (
            <>
              {renderStandaloneSection({
                anytimeTasks: standaloneAnytimeTasks,
                somedayTasks: standaloneSomedayTasks,
              }, "later")}
              {laterProjectSections.map((section) => (
                renderProjectSection(section, "later")
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LatestUpdatesPane({ toolbarContent }) {
  return (
    <div className="utility-pane updates-pane">
      <UtilityPaneToolbar>{toolbarContent}</UtilityPaneToolbar>
      <div className="utility-pane-content">
        <UtilityPaneHeading icon={Lightning} title="Latest Updates" />
        <p className="utility-pane-intro">What's new in Ritua</p>
        <ol className="latest-updates-list">
          {PRODUCT_UPDATES.map((update) => {
            const Icon = UPDATE_ICONS[update.type] || Lightning;
            return (
              <li key={update.id}>
                <span className={`latest-update-icon ${update.type}`}><Icon size={15} /></span>
                <div>
                  <div className="latest-update-meta">
                    <span className={`latest-update-category ${update.type}`}>{update.category}</span>
                    <time dateTime={update.publishedAt}>{update.publishedLabel}</time>
                  </div>
                  <strong className="latest-update-title">{update.title}</strong>
                  <p>{update.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function RightPanel({
  activePane,
  areas = DEFAULT_AREAS,
  onPaneChange,
  tasks = [],
  setTasks,
  datedTasksByDate = {},
  setDatedTasksByDate,
  events = [],
  setEvents,
  dateKey = CURRENT_DATE_KEY,
  objectives = [],
  setObjectives,
  backlogGroups = [],
  setBacklogGroups,
  onCreateBoardTask,
  onCreateCalendarTask,
  onCompleteUndatedTask,
  onAssignObjective,
  onQuickSchedule,
  onUnscheduleTask,
  onFocusObjectiveInWeek,
  onOpenObjective,
  onOpenTask,
  weeklyFocusedObjectives,
  setWeeklyFocusedObjectives,
  unavailableTaskIds = [],
  visibleTaskIds,
  availableDateKeys,
  onDateChange,
  calendarFocusRequest,
}) {
  const tabRefs = useRef([]);
  const autoSchedule = useAutoSchedule();
  const handledAutoScheduleRef = useRef(null);
  const handledCalendarFocusRef = useRef(null);
  const [autoScheduleRevealed, setAutoScheduleRevealed] = useState(false);
  const [fallbackDateKey, setFallbackDateKey] = useState(dateKey);
  const activeDefinition = RIGHT_PANEL_PANES.find((pane) => pane.id === activePane) || RIGHT_PANEL_PANES[0];
  const resolvedActivePane = activeDefinition.id;
  const resolvedDateKey = onDateChange ? dateKey : fallbackDateKey;
  const resolvedAvailableDateKeys = availableDateKeys?.length
    ? availableDateKeys
    : calendarDaysAround(dateKey || CURRENT_DATE_KEY).map((day) => day.dateKey);
  const changeDate = onDateChange || setFallbackDateKey;
  useLayoutEffect(() => {
    if (!autoSchedule || handledAutoScheduleRef.current === autoSchedule) return;
    handledAutoScheduleRef.current = autoSchedule;
    setAutoScheduleRevealed(true);
    changeDate(autoSchedule.dateKey);
  }, [autoSchedule, changeDate]);
  useLayoutEffect(() => {
    if (!calendarFocusRequest || handledCalendarFocusRef.current === calendarFocusRequest) return;
    handledCalendarFocusRef.current = calendarFocusRequest;
    setAutoScheduleRevealed(true);
    changeDate(calendarFocusRequest.dateKey);
  }, [calendarFocusRequest, changeDate]);
  const resolvedTasks = resolvedDateKey === CURRENT_DATE_KEY
    ? tasks
    : datedTasksByDate[resolvedDateKey] || [];
  const setResolvedTasks = resolvedDateKey === CURRENT_DATE_KEY
    ? setTasks
    : setDatedTasksByDate
      ? (updater) => setDatedTasksByDate((current) => {
          const currentDateTasks = current[resolvedDateKey] || [];
          const nextDateTasks = typeof updater === "function"
            ? updater(currentDateTasks)
            : updater;
          return { ...current, [resolvedDateKey]: nextDateTasks };
        })
      : undefined;
  const resolvedVisibleTaskIds = resolvedDateKey === dateKey ? visibleTaskIds : null;
  const selectedDateLabel = dateFromKey(resolvedDateKey).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  const dateToolbarContent = (
    <DateControl
      className="day-summary-current"
      dateKey={resolvedDateKey}
      dateLabel={resolvedDateKey === CURRENT_DATE_KEY ? "Today" : selectedDateLabel}
      availableDateKeys={resolvedAvailableDateKeys}
      onDateChange={changeDate}
      showAdjacentControls
    />
  );

  const selectPane = (paneId, focusIndex) => {
    onPaneChange?.(paneId);
    if (focusIndex !== undefined) tabRefs.current[focusIndex]?.focus();
  };

  const handleRailKeyDown = (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    if (!tab) return;
    const currentIndex = Number(tab.dataset.index);
    let nextIndex;

    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + RIGHT_PANEL_PANES.length) % RIGHT_PANEL_PANES.length;
    else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % RIGHT_PANEL_PANES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = RIGHT_PANEL_PANES.length - 1;
    else return;

    event.preventDefault();
    selectPane(RIGHT_PANEL_PANES[nextIndex].id, nextIndex);
  };

  const renderPane = (paneId) => {
    switch (paneId) {
      case "calendar":
        return (
          <CalendarPane
            areas={areas}
            events={events}
            removingEvent={autoSchedule?.kind === "unschedule" ? autoSchedule.calendarEvent : null}
            setEvents={setEvents}
            tasks={resolvedTasks}
            setTasks={setResolvedTasks}
            dateKey={resolvedDateKey}
            focusRequest={calendarFocusRequest}
            toolbarContent={dateToolbarContent}
            visibleTaskIds={resolvedVisibleTaskIds}
            onCreateTask={onCreateCalendarTask}
            onOpenTask={onOpenTask}
          />
        );
      case "board":
        return (
          <BoardPane
            tasks={resolvedTasks}
            setTasks={setResolvedTasks}
            setEvents={setEvents}
            setObjectives={setObjectives}
            objectives={objectives}
            dateKey={resolvedDateKey}
            onCreateBoardTask={onCreateBoardTask}
            onAssignObjective={onAssignObjective}
            onQuickSchedule={onQuickSchedule}
            onUnscheduleTask={onUnscheduleTask}
            onOpenTask={onOpenTask}
            visibleTaskIds={resolvedVisibleTaskIds}
            toolbarContent={dateToolbarContent}
          />
        );
      case "objectives":
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
        );
      case "backlog":
        return (
          <BacklogPane
            areas={areas}
            groups={backlogGroups}
            objectives={objectives}
            onCompleteUndatedTask={onCompleteUndatedTask}
            onOpenObjective={onOpenObjective}
            onOpenTask={onOpenTask}
            setGroups={setBacklogGroups}
            setObjectives={setObjectives}
            unavailableTaskIds={unavailableTaskIds}
            weeklyFocusedObjectives={weeklyFocusedObjectives}
            toolbarContent={dateToolbarContent}
          />
        );
      case "latest-updates":
        return <LatestUpdatesPane toolbarContent={dateToolbarContent} />;
      default:
        return null;
    }
  };

  return (
    <aside id="right-panel" className={`calendar-panel right-panel right-panel-${resolvedActivePane}${autoScheduleRevealed ? " auto-schedule-revealed" : ""}`} aria-label={`${activeDefinition.label} panel`}>
      {autoScheduleRevealed ? (
        <button
          className="icon-button auto-schedule-panel-close"
          aria-label="Close scheduled calendar"
          type="button"
          onClick={() => setAutoScheduleRevealed(false)}
        >
          <X size={16} />
        </button>
      ) : null}
      <div
        className="calendar-rail"
        role="tablist"
        aria-label="Right panel"
        aria-orientation="vertical"
        onKeyDown={handleRailKeyDown}
      >
        {RIGHT_PANEL_PANES.map(({ id, label, icon: Icon }, index) => {
          const active = id === resolvedActivePane;
          return (
            <button
              ref={(element) => { tabRefs.current[index] = element; }}
              className={`rail-button ${active ? "active" : ""}`}
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
          );
        })}
      </div>
      {RIGHT_PANEL_PANES.map((pane) => {
        const active = pane.id === resolvedActivePane;
        return (
          <section
            className={`right-panel-pane right-panel-pane-${pane.id}`}
            id={`right-panel-pane-${pane.id}`}
            key={pane.id}
            role="tabpanel"
            aria-labelledby={`right-panel-tab-${pane.id}`}
            hidden={!active}
            tabIndex={0}
          >
            {active ? renderPane(pane.id) : null}
          </section>
        );
      })}
    </aside>
  );
}

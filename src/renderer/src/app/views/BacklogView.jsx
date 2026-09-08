import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CollisionPriority } from "@dnd-kit/abstract";
import { useDroppable } from "@dnd-kit/react";
import {
  Archive,
  CalendarBlank,
  CaretDown,
  CaretRight,
  CheckCircle,
  Folder,
  Plus,
  Stack,
  Target,
} from "@phosphor-icons/react";
import { BacklogTaskRow } from "../components/BacklogTaskRow";
import { AutoGrowingTextarea } from "../components/DetailsTitleInput";
import { ProjectProgressCircle } from "../components/ProjectProgressCircle";
import { RightPanel } from "../components/RightPanel";
import { HorizonFilterControl } from "../components/TopControls";
import {
  acceptsExternalTaskDrop,
  SortableCollectionDropProxy,
  SortableCollectionItem,
  SortableCollectionLane,
} from "../components/SortableCollection";
import { DEFAULT_AREAS } from "../../../../domain/workspace-defaults";

const MAIN_BACKLOG_COLLECTION_ID = "backlog-main-tasks";
const MAIN_BACKLOG_SURFACE_ID = "backlog-main";
const BACKLOG_LAYOUT_ANIMATION_MS = 180;
const BACKLOG_LAYOUT_ANIMATION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const HORIZON_LABELS = ["Anytime", "Scheduled", "Someday"];
const normalizedChannel = (channel) => channel || "Ritua";

const objectiveTaskId = (task) => task.taskId || task.id;

function taskMatchesDestination(item, destination, knownProjectIds) {
  if (destination.objectiveId) return item.objectiveId === destination.objectiveId;
  return (
    normalizedChannel(item.channel) === normalizedChannel(destination.channel)
    && (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
  );
}

function moveTaskBetweenBacklogContexts(groups, move, knownProjectIds) {
  const targetData = move.targetData;
  const targetGroupLabel = targetData?.backlogGroupLabel;
  const targetChannel = targetData?.backlogChannel;
  if (!move.itemId || !targetGroupLabel || !targetChannel) return null;

  const sourceTask = groups
    .flatMap((group) => group.items)
    .find((item) => item.id === move.itemId);
  if (!sourceTask) return null;

  const destination = {
    channel: normalizedChannel(targetChannel),
    objectiveId: targetData.backlogObjectiveId || null,
  };
  const movedTask = {
    ...sourceTask,
    channel: destination.channel,
  };
  if (destination.objectiveId) movedTask.objectiveId = destination.objectiveId;
  else delete movedTask.objectiveId;

  let targetTaskIds = [];
  const nextGroups = groups.map((group) => {
    const withoutTask = group.items.filter((item) => item.id !== move.itemId);
    if (group.label !== targetGroupLabel) return { ...group, items: withoutTask };

    const contextItems = withoutTask.filter((item) => (
      taskMatchesDestination(item, destination, knownProjectIds)
    ));
    const targetIndex = Math.max(
      0,
      Math.min(
        Number.isFinite(move.targetIndex) ? move.targetIndex : contextItems.length,
        contextItems.length,
      ),
    );
    let insertionIndex = withoutTask.length;
    if (contextItems.length && targetIndex === 0) {
      insertionIndex = withoutTask.findIndex((item) => item.id === contextItems[0].id);
    } else if (contextItems.length && targetIndex < contextItems.length) {
      insertionIndex = withoutTask.findIndex((item) => (
        item.id === contextItems[targetIndex].id
      ));
    } else if (contextItems.length) {
      insertionIndex = withoutTask.findIndex((item) => (
        item.id === contextItems[contextItems.length - 1].id
      )) + 1;
    }

    const items = [
      ...withoutTask.slice(0, insertionIndex),
      movedTask,
      ...withoutTask.slice(insertionIndex),
    ];
    targetTaskIds = items
      .filter((item) => taskMatchesDestination(item, destination, knownProjectIds))
      .map((item) => item.id);
    return { ...group, items };
  });

  return {
    groups: nextGroups,
    movedTask,
    targetObjectiveId: destination.objectiveId,
    targetTaskIds,
  };
}

function syncObjectiveTaskOwnership(objectives, {
  movedTask,
  targetObjectiveId,
  targetTaskIds,
}) {
  const existingMirror = objectives
    .flatMap((objective) => objective.tasks || [])
    .find((task) => objectiveTaskId(task) === movedTask.id);
  const mirror = existingMirror || {
    id: `objective-${movedTask.id}`,
    taskId: movedTask.id,
    title: movedTask.title,
    minutes: movedTask.minutes || 0,
    complete: Boolean(movedTask.complete),
  };
  const withoutMovedTask = objectives.map((objective) => ({
    ...objective,
    tasks: (objective.tasks || []).filter((task) => (
      objectiveTaskId(task) !== movedTask.id
    )),
  }));
  if (!targetObjectiveId) return withoutMovedTask;

  return withoutMovedTask.map((objective) => {
    if (objective.id !== targetObjectiveId) return objective;

    const tasks = [...(objective.tasks || [])];
    const movedIndex = targetTaskIds.indexOf(movedTask.id);
    const nextTaskId = targetTaskIds
      .slice(movedIndex + 1)
      .find((taskId) => tasks.some((task) => objectiveTaskId(task) === taskId));
    const previousTaskId = [...targetTaskIds]
      .slice(0, Math.max(0, movedIndex))
      .reverse()
      .find((taskId) => tasks.some((task) => objectiveTaskId(task) === taskId));
    let insertionIndex = tasks.length;
    if (nextTaskId) {
      insertionIndex = tasks.findIndex((task) => objectiveTaskId(task) === nextTaskId);
    } else if (previousTaskId) {
      insertionIndex = tasks.findIndex((task) => objectiveTaskId(task) === previousTaskId) + 1;
    }
    tasks.splice(insertionIndex, 0, mirror);
    return { ...objective, tasks };
  });
}

function reorderedItems(items, move) {
  const sourceIndex = items.findIndex((item) => item.id === move.itemId);
  if (sourceIndex === -1) return items;

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(sourceIndex, 1);
  const targetIndex = Math.max(0, Math.min(move.targetIndex, nextItems.length));
  nextItems.splice(targetIndex, 0, movedItem);
  return nextItems;
}

function reorderProjectSubset(objectives, projectIds, move) {
  const projectIdSet = new Set(projectIds);
  const projects = objectives.filter((objective) => projectIdSet.has(objective.id));
  const nextProjects = reorderedItems(projects, move);
  let replacementIndex = 0;

  return objectives.map((objective) => (
    projectIdSet.has(objective.id)
      ? nextProjects[replacementIndex++]
      : objective
  ));
}

export function BacklogView({
  activeRightPane,
  areas = DEFAULT_AREAS,
  datedTasksByDate,
  events,
  groups,
  objectives,
  onAssignObjective,
  onQuickSchedule,
  onUnscheduleTask,
  onCreateBoardTask,
  onCreateCalendarTask,
  onCompleteUndatedTask,
  onOpenArea,
  onOpenObjective,
  onOpenTask,
  onRightPaneChange,
  onScopeChange,
  onToggleObjective,
  onToggleScheduledTask,
  scheduledItems = [],
  scope = "anytime",
  setEvents,
  setDatedTasksByDate,
  setGroups,
  setObjectives,
  setTasks,
  tasks,
  weeklyFocusedObjectives,
  setWeeklyFocusedObjectives,
  rightPanelUnavailableTaskIds,
}) {
  const [editingContext, setEditingContext] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [projectDraft, setProjectDraft] = useState(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectChannel, setProjectChannel] = useState(() => areas[0]?.label || "Ritua");
  const [visibleHorizonLabels, setVisibleHorizonLabels] = useState(HORIZON_LABELS);
  const [collapsedProjectSections, setCollapsedProjectSections] = useState(() => new Set());
  const draftInputRef = useRef(null);
  const draftReturnFocusRef = useRef(null);
  const projectInputRef = useRef(null);
  const projectReturnFocusRef = useRef(null);
  const backlogLayoutRef = useRef(null);
  const pendingLayoutPositionsRef = useRef(null);
  const layoutAnimationsRef = useRef(new Map());
  const groupsRef = useRef(groups);
  const objectivesRef = useRef(objectives);
  groupsRef.current = groups;
  objectivesRef.current = objectives;

  const projectId = scope.startsWith("project:") ? scope.slice("project:".length) : null;
  const areaId = scope.startsWith("area:") ? scope.slice("area:".length) : null;
  const activeProject = objectives.find((objective) => objective.id === projectId) || null;
  const activeArea = areas.find((area) => (
    area.id === areaId || area.label === activeProject?.channel
  )) || null;
  const activeListLabel = scope === "scheduled"
    ? "Scheduled"
    : scope === "someday"
      ? "Someday"
      : "Anytime";
  const taskGroups = useMemo(() => {
    const scheduledGroup = {
      id: "scheduled",
      label: "Scheduled",
      marker: "D",
      tone: "violet",
      items: scheduledItems,
    };
    const anytimeGroup = groups.find((group) => group.label === "Anytime");
    const somedayGroup = groups.find((group) => group.label === "Someday");
    return [anytimeGroup, scheduledGroup, somedayGroup].filter(Boolean);
  }, [groups, scheduledItems]);
  const activeList = taskGroups.find((group) => group.label === activeListLabel)
    || { id: activeListLabel.toLowerCase(), label: activeListLabel, items: [] };
  const knownProjectIds = useMemo(
    () => new Set(objectives.map((objective) => objective.id)),
    [objectives],
  );

  const scopeLabel = activeProject?.title
    || activeArea?.label
    || activeListLabel;
  const scopeDescription = activeProject
    ? `${activeProject.complete ? "Completed project" : "Project"} in ${activeProject.channel}`
    : activeArea
      ? (() => {
          const projectCount = objectives.filter((objective) => (
            !objective.complete && objective.channel === activeArea.label
          )).length;
          return `${projectCount} active ${projectCount === 1 ? "project" : "projects"}`;
        })()
      : activeListLabel === "Scheduled"
        ? "Tasks planned for today and later"
        : activeListLabel === "Someday"
        ? "Ideas and work without a current commitment"
        : "Available tasks, grouped by area and project";
  const isScheduledList = activeListLabel === "Scheduled";
  const canCreateProjectInCurrentScope = !isScheduledList && areas.length > 0;
  const pageDropData = {
    backlogDropTarget: !isScheduledList,
    backlogGroupLabel: activeListLabel,
    backlogChannel: activeProject?.channel || activeArea?.label,
    backlogContextual: Boolean(activeProject || activeArea),
    backlogObjectiveId: activeProject?.id || null,
  };
  const pageDrop = useDroppable({
    id: `backlog-page:${scope}`,
    type: "backlog-page",
    accept: isScheduledList ? () => false : acceptsExternalTaskDrop,
    collisionPriority: CollisionPriority.Lowest,
    data: {
      kind: "backlog-page",
      scope,
      ...pageDropData,
    },
  });
  const ScopeIcon = activeProject
    ? Target
    : activeArea
      ? Folder
      : activeListLabel === "Scheduled"
        ? CalendarBlank
      : activeListLabel === "Someday"
        ? Archive
        : Stack;
  const scopeBreadcrumb = activeProject
    ? [
        {
          label: activeProject.channel,
          scope: activeArea ? `area:${activeArea.id}` : "anytime",
        },
        { label: activeProject.title, scope: `project:${activeProject.id}` },
      ]
    : activeArea
      ? [
          { label: activeArea.label, scope: `area:${activeArea.id}` },
        ]
      : [
          { label: activeListLabel, scope },
        ];

  useEffect(() => {
    if (editingContext) draftInputRef.current?.focus();
  }, [editingContext]);

  useEffect(() => {
    if (projectDraft) projectInputRef.current?.focus();
  }, [projectDraft]);

  const captureBacklogLayoutPositions = () => {
    const positions = new Map();
    backlogLayoutRef.current
      ?.querySelectorAll("[data-backlog-layout-key]")
      .forEach((element) => {
        const key = element.dataset.backlogLayoutKey;
        const rect = element.getBoundingClientRect();
        positions.set(key, { left: rect.left, top: rect.top });
      });
    pendingLayoutPositionsRef.current = positions;
  };

  useLayoutEffect(() => {
    const previousPositions = pendingLayoutPositionsRef.current;
    if (!previousPositions) return;
    pendingLayoutPositionsRef.current = null;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    backlogLayoutRef.current
      ?.querySelectorAll("[data-backlog-layout-key]")
      .forEach((element) => {
        const key = element.dataset.backlogLayoutKey;
        const previousPosition = previousPositions.get(key);
        const previousAnimation = layoutAnimationsRef.current.get(key);
        previousAnimation?.cancel();
        layoutAnimationsRef.current.delete(key);
        if (!previousPosition || reduceMotion) return;

        const nextPosition = element.getBoundingClientRect();
        const deltaX = previousPosition.left - nextPosition.left;
        const deltaY = previousPosition.top - nextPosition.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

        const animation = element.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: BACKLOG_LAYOUT_ANIMATION_MS,
            easing: BACKLOG_LAYOUT_ANIMATION_EASING,
            fill: "both",
          },
        );
        layoutAnimationsRef.current.set(key, animation);
        animation.onfinish = () => {
          if (layoutAnimationsRef.current.get(key) !== animation) return;
          animation.cancel();
          layoutAnimationsRef.current.delete(key);
        };
      });
  }, [groups, objectives]);

  useEffect(() => () => {
    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
    layoutAnimationsRef.current.clear();
  }, []);

  const contextForArea = (area, items = [], listLabel = activeListLabel) => ({
    channel: area.label,
    items,
    key: `area-${area.id}-${listLabel.toLowerCase()}`,
    label: area.label,
    listLabel,
    matchesItem: (item) => (
      normalizedChannel(item.channel) === area.label
      && (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
    ),
  });

  const contextForProject = (project, items = [], listLabel = activeListLabel) => ({
    channel: project.channel,
    items,
    key: `project-${project.id}-${listLabel.toLowerCase()}`,
    label: project.title,
    listLabel,
    objectiveId: project.id,
    matchesItem: (item) => item.objectiveId === project.id,
  });

  const projectTemporalSections = activeProject
    ? taskGroups
      .filter((group) => visibleHorizonLabels.includes(group.label))
      .map((group) => ({
        group,
        context: contextForProject(
          activeProject,
          group.items.filter((item) => item.objectiveId === activeProject.id),
          group.label,
        ),
      }))
    : [];

  const areaTemporalSections = activeArea && !activeProject
    ? taskGroups
      .filter((group) => visibleHorizonLabels.includes(group.label))
      .map((group) => {
        const looseItems = group.items.filter((item) => (
          normalizedChannel(item.channel) === activeArea.label
          && (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
        ));
        const projectSections = objectives
          .filter((project) => project.channel === activeArea.label)
          .map((project) => ({
            project,
            items: group.items.filter((item) => item.objectiveId === project.id),
          }))
          .filter(({ project, items }) => !project.complete || items.length > 0);

        return {
          group,
          looseContext: contextForArea(activeArea, looseItems, group.label),
          projectSections,
          taskCount: looseItems.length
            + projectSections.reduce((sum, section) => sum + section.items.length, 0),
        };
      })
    : [];

  const areaSections = areas.map((area) => {
    const projects = objectives.filter((objective) => (
      (
        !objective.complete
        || objective.id === projectId
        || activeList.items.some((item) => item.objectiveId === objective.id)
      )
      && objective.channel === area.label
    ));
    const looseItems = projectId
      ? []
      : activeList.items.filter((item) => (
          normalizedChannel(item.channel) === area.label
          && (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
        ));
    const projectSections = projects.map((project) => ({
      project,
      items: activeList.items.filter((item) => item.objectiveId === project.id),
    })).filter(({ project, items }) => (
      activeListLabel === "Scheduled"
        ? items.length > 0
        : (
            project.id === projectId
            || area.id === areaId
            || (!areaId && !projectId && (!project.complete || items.length))
          )
    ));
    const visible = area.id === areaId
      || activeProject?.channel === area.label
      || editingContext?.key === `area-${area.id}`
      || projectDraft?.areaId === area.id
      || (!areaId && !projectId && (looseItems.length || projectSections.length));

    return {
      area,
      looseItems,
      projectSections,
      taskCount: looseItems.length + projectSections.reduce((sum, section) => sum + section.items.length, 0),
      visible,
    };
  }).filter((section) => section.visible);

  const toggleProjectSection = (project, listLabel) => {
    const sectionKey = `${listLabel}:${project.id}`;
    captureBacklogLayoutPositions();
    setCollapsedProjectSections((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  const startAddingTask = (context, returnFocusElement) => {
    draftReturnFocusRef.current = returnFocusElement || document.activeElement;
    setEditingContext(context);
    setDraftTitle("");
    setDraftProjectId(context.objectiveId || "");
    requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const cancelTaskDraft = () => {
    setEditingContext(null);
    setDraftTitle("");
    setDraftProjectId("");
    requestAnimationFrame(() => draftReturnFocusRef.current?.focus?.());
  };

  useEffect(() => {
    if (
      editingContext?.objectiveId
      && objectives.some((objective) => (
        objective.id === editingContext.objectiveId && objective.complete
      ))
    ) {
      cancelTaskDraft();
    }
  }, [editingContext, objectives]);

  const defaultAggregateListLabel = visibleHorizonLabels.includes("Anytime")
    ? "Anytime"
    : visibleHorizonLabels.includes("Someday")
      ? "Someday"
      : null;

  const defaultTaskContext = () => {
    if (activeProject) {
      const listLabel = defaultAggregateListLabel || "Anytime";
      const list = taskGroups.find((group) => group.label === listLabel) || activeList;
      const projectItems = list.items.filter((item) => item.objectiveId === activeProject.id);
      return contextForProject(activeProject, projectItems, listLabel);
    }
    if (activeArea) {
      const listLabel = defaultAggregateListLabel || "Anytime";
      const list = taskGroups.find((group) => group.label === listLabel) || activeList;
      const looseItems = list.items.filter((item) => (
        normalizedChannel(item.channel) === activeArea.label
        && (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
      ));
      return contextForArea(activeArea, looseItems, listLabel);
    }
    const fallbackArea = areas[0];
    const looseItems = activeList.items.filter((item) => (
      normalizedChannel(item.channel) === fallbackArea.label
      && (!item.objectiveId || !knownProjectIds.has(item.objectiveId))
    ));
    return {
      ...contextForArea(fallbackArea, looseItems),
      allowProjectChoice: true,
    };
  };

  const createTask = (event, context) => {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;
    const selectedProject = context.allowProjectChoice
      ? objectives.find((objective) => objective.id === draftProjectId)
      : null;
    const resolvedContext = selectedProject
      ? {
          channel: selectedProject.channel,
          objectiveId: selectedProject.id,
        }
      : context;
    const destinationProject = resolvedContext.objectiveId
      ? objectives.find((objective) => objective.id === resolvedContext.objectiveId)
      : null;
    if (destinationProject?.complete) {
      cancelTaskDraft();
      return;
    }

    const taskId = `backlog-${Date.now()}`;
    const task = {
      id: taskId,
      title,
      channel: resolvedContext.channel,
      complete: false,
      ...(resolvedContext.objectiveId ? { objectiveId: resolvedContext.objectiveId } : {}),
    };

    const targetListLabel = resolvedContext.listLabel || activeListLabel;
    setGroups((items) => items.map((group) => (
      group.label === targetListLabel
        ? { ...group, items: [...group.items, task] }
        : group
    )));
    if (resolvedContext.objectiveId) {
      setObjectives((items) => items.map((objective) => (
        objective.id === resolvedContext.objectiveId
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
    requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const toggleTask = (taskId) => {
    const task = groups.flatMap((group) => group.items).find((item) => item.id === taskId);
    if (!task) {
      if (scheduledItems.some((item) => item.id === taskId)) {
        onToggleScheduledTask?.(taskId);
      }
      return;
    }
    onCompleteUndatedTask?.(taskId);
  };

  const moveTaskInContext = (context, move) => {
    const targetData = move.targetData || {
      backlogGroupLabel: context.listLabel || activeListLabel,
      backlogChannel: context.channel,
      backlogObjectiveId: context.objectiveId || null,
    };
    if (targetData.backlogScheduleTarget) return;
    const targetProject = targetData.backlogObjectiveId
      ? objectivesRef.current.find((objective) => (
          objective.id === targetData.backlogObjectiveId
        ))
      : null;
    if (targetProject?.complete) return;

    const result = moveTaskBetweenBacklogContexts(
      groupsRef.current,
      { ...move, targetData },
      new Set(objectivesRef.current.map((objective) => objective.id)),
    );
    if (!result) return;

    const nextObjectives = syncObjectiveTaskOwnership(
      objectivesRef.current,
      result,
    );
    captureBacklogLayoutPositions();
    groupsRef.current = result.groups;
    objectivesRef.current = nextObjectives;
    setGroups(result.groups);
    setObjectives(nextObjectives);
  };

  const moveProjectsInArea = (projectIds, move) => {
    setObjectives((items) => reorderProjectSubset(items, projectIds, move));
  };

  const startAddingProject = (area, returnFocusElement) => {
    if (!canCreateProjectInCurrentScope) return;
    projectReturnFocusRef.current = returnFocusElement || document.activeElement;
    setProjectTitle("");
    setProjectChannel(area?.label || activeArea?.label || "Ritua");
    setProjectDraft({ areaId: area?.id || null });
    requestAnimationFrame(() => projectInputRef.current?.focus());
  };

  const cancelProjectDraft = () => {
    setProjectDraft(null);
    setProjectTitle("");
    requestAnimationFrame(() => projectReturnFocusRef.current?.focus?.());
  };

  const createProject = (event) => {
    event.preventDefault();
    if (!canCreateProjectInCurrentScope) return;
    const title = projectTitle.trim();
    if (!title) return;

    const draftArea = areas.find((area) => area.id === projectDraft?.areaId);
    const id = `objective-${Date.now()}`;
    setObjectives((items) => [
      ...items,
      {
        id,
        title,
        channel: draftArea?.label || projectChannel,
        complete: false,
        focusedThisWeek: false,
        tasks: [],
      },
    ]);
    setProjectTitle("");
    setProjectDraft(null);
    if (!draftArea) onScopeChange?.(`project:${id}`);
  };

  const renderAreaProjectDraft = (area) => {
    if (!canCreateProjectInCurrentScope || projectDraft?.areaId !== area.id) return null;

    return (
      <form
        className="work-area-project-create"
        onBlur={(event) => {
          if (
            !projectTitle.trim()
            && !event.currentTarget.contains(event.relatedTarget)
          ) {
            cancelProjectDraft();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelProjectDraft();
          }
        }}
        onSubmit={createProject}
      >
        <Target size={17} style={{ color: area.color }} />
        <AutoGrowingTextarea
          ref={projectInputRef}
          aria-label={`New project in ${area.label}`}
          autoComplete="off"
          placeholder="Name the result you want to achieve"
          value={projectTitle}
          onChange={(event) => setProjectTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              createProject(event);
            }
          }}
        />
      </form>
    );
  };

  const renderDraft = (context) => {
    if (editingContext?.key !== context.key) return null;
    const draftContext = editingContext;

    return (
      <form
        className="backlog-row backlog-new-task-row"
        onBlur={(event) => {
          if (
            !draftTitle.trim()
            && !event.currentTarget.contains(event.relatedTarget)
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
        onSubmit={(event) => createTask(event, draftContext)}
      >
        <span className="backlog-completion-toggle" aria-hidden="true">
          <CheckCircle size={19} />
        </span>
        <AutoGrowingTextarea
          ref={draftInputRef}
          aria-label={`New task in ${draftContext.label}`}
          autoComplete="off"
          placeholder="Type a task title"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              createTask(event, draftContext);
            }
          }}
        />
        {draftContext.allowProjectChoice ? (
          <select
            aria-label="Optional project"
            value={draftProjectId}
            onChange={(event) => setDraftProjectId(event.target.value)}
          >
            <option value="">Standalone in {draftContext.channel}</option>
            {objectives.filter((objective) => !objective.complete).map((objective) => (
              <option key={objective.id} value={objective.id}>
                {objective.channel} · {objective.title}
              </option>
            ))}
          </select>
        ) : null}
      </form>
    );
  };

  const taskContextDropData = (context) => {
    const scheduledContext = context.listLabel === "Scheduled";
    return {
      backlogDropTarget: !scheduledContext,
      backlogScheduleTarget: scheduledContext,
      backlogGroupLabel: context.listLabel || activeList.label,
      backlogChannel: context.channel,
      backlogContextual: true,
      backlogObjectiveId: context.objectiveId || null,
    };
  };

  const taskContextDropProxyProps = (context) => ({
    acceptExternalTaskDrop: context.listLabel !== "Scheduled",
    collectionId: MAIN_BACKLOG_COLLECTION_ID,
    externalDropData: taskContextDropData(context),
    laneId: context.key,
    proxyId: `${context.key}-header`,
    surfaceId: MAIN_BACKLOG_SURFACE_ID,
  });

  const restoreTaskCollection = (snapshot) => {
    captureBacklogLayoutPositions();
    groupsRef.current = snapshot.groups;
    objectivesRef.current = snapshot.objectives;
    setGroups(snapshot.groups);
    setObjectives(snapshot.objectives);
  };

  const renderTaskContext = (context, {
    addLabel = "Add task",
    emptyLabel = null,
    showAddRow = true,
  } = {}) => {
    const scheduledContext = context.listLabel === "Scheduled";
    const renderRows = (collectionItemProps = null) => context.items.map((item, index) => {
      const visibleDateItems = scheduledContext
        ? context.items.filter((candidate) => (
            candidate.scheduledDateKey === item.scheduledDateKey
          ))
        : [];
      return (
        <BacklogTaskRow
          boardDateKey={scheduledContext ? item.scheduledDateKey : undefined}
          boardIndex={scheduledContext ? item.scheduledDateIndex : undefined}
          boardSurfaceId={scheduledContext ? `${MAIN_BACKLOG_SURFACE_ID}-scheduled` : undefined}
          boardVisibleIndex={scheduledContext
            ? visibleDateItems.findIndex((candidate) => candidate.id === item.id)
            : undefined}
          boardVisibleTaskIds={scheduledContext
            ? visibleDateItems.map((candidate) => candidate.id)
            : undefined}
          collectionItem={collectionItemProps
            ? collectionItemProps(item, index, { type: "backlog", variant: "main" })
            : null}
          item={item}
          key={item.id}
          onOpen={onOpenTask}
          onToggle={toggleTask}
          showArea={false}
        />
      );
    });
    const content = (collectionItemProps = null) => (
      <>
        {renderRows(collectionItemProps)}
        {!context.items.length && emptyLabel && editingContext?.key !== context.key
          ? <p className="empty-row">{emptyLabel}</p>
          : null}
        {!scheduledContext ? renderDraft(context) : null}
        {showAddRow && !scheduledContext ? (
          <button
            className="backlog-add-task-button"
            data-backlog-layout-key={`add-task:${context.key}`}
            type="button"
            onClick={(event) => startAddingTask(context, event.currentTarget)}
          >
            <Plus size={15} /> {addLabel}
          </button>
        ) : null}
      </>
    );

    return (
      <div className="work-task-context" key={context.key}>
        {scheduledContext ? (
          <SortableCollectionLane
            className="backlog-group-items backlog-scheduled-drop-lane"
            collectionId={MAIN_BACKLOG_COLLECTION_ID}
            collectionSnapshot={{ groups, objectives }}
            externalDropData={taskContextDropData(context)}
            items={[]}
            laneId={context.key}
            onMove={(move) => moveTaskInContext(context, move)}
            onRestore={restoreTaskCollection}
            surfaceId={MAIN_BACKLOG_SURFACE_ID}
          >
            {content()}
          </SortableCollectionLane>
        ) : (
          <SortableCollectionLane
            acceptExternalTaskDrop
            className="backlog-group-items"
            collectionId={MAIN_BACKLOG_COLLECTION_ID}
            collectionSnapshot={{ groups, objectives }}
            externalDropData={taskContextDropData(context)}
            items={context.items}
            laneId={context.key}
            onMove={(move) => moveTaskInContext(context, move)}
            onRestore={restoreTaskCollection}
            surfaceId={MAIN_BACKLOG_SURFACE_ID}
          >
            {({ collectionItemProps }) => content(collectionItemProps)}
          </SortableCollectionLane>
        )}
      </div>
    );
  };

  const renderProjectSection = (
    area,
    project,
    items,
    collectionItem = null,
    listLabel = activeListLabel,
  ) => {
    const context = contextForProject(project, items, listLabel);
    const sectionKey = `${listLabel}:${project.id}`;
    const collapsed = collapsedProjectSections.has(sectionKey);
    const sectionContent = (
      <>
        {project.id !== projectId ? (
          <SortableCollectionDropProxy
            as="header"
            className="work-project-header"
            data-backlog-project-openable="true"
            data-backlog-layout-key={`header:${context.key}`}
            {...taskContextDropProxyProps(context)}
            onClick={(event) => {
              if (event.defaultPrevented) return;
              const actionTarget = event.target?.closest?.("button");
              if (
                actionTarget
                && actionTarget !== event.currentTarget
                && event.currentTarget.contains(actionTarget)
              ) return;
              const returnFocusElement = event.currentTarget.querySelector(
                "[data-objective-title-id]",
              );
              onOpenObjective?.(project, returnFocusElement || event.currentTarget);
            }}
          >
            <button
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${project.title} in ${listLabel}`}
              className="work-project-collapse-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleProjectSection(project, listLabel);
              }}
            >
              {collapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}
            </button>
            <ProjectProgressCircle
              complete={project.complete}
              size={17}
              tasks={project.tasks || []}
            />
            <button
              type="button"
              className="work-project-title"
              data-objective-title-id={project.id}
              onClick={(event) => {
                event.stopPropagation();
                onOpenObjective?.(project, event.currentTarget);
              }}
            >
              {project.title}
            </button>
            <span>{items.length} {items.length === 1 ? "task" : "tasks"}</span>
          </SortableCollectionDropProxy>
        ) : null}
        {!collapsed ? renderTaskContext(context, {
          addLabel: "Add task",
          emptyLabel: "No tasks in this project yet.",
          showAddRow: !project.complete,
        }) : null}
      </>
    );
    const sectionClassName = `work-project-section ${project.id === projectId ? "focused" : ""} ${project.complete ? "complete" : ""} ${collapsed ? "collapsed" : ""}`.trim();

    if (!collectionItem) {
      return (
        <section className={sectionClassName} key={project.id}>
          {sectionContent}
        </section>
      );
    }

    return (
      <SortableCollectionItem
        as="section"
        aria-label={`Drag ${project.title} to reorder projects in ${area.label}`}
        className={sectionClassName}
        key={project.id}
        pointerActivationDistance={5}
        pointerActivatorSelector=".work-project-header"
        {...collectionItem}
      >
        {sectionContent}
      </SortableCollectionItem>
    );
  };

  return (
    <div className="surface-row backlog-layout">
      <section
        ref={pageDrop.ref}
        className="backlog-view"
        data-backlog-drop-zone={pageDropData.backlogDropTarget ? "true" : undefined}
        data-backlog-page-drop-zone={pageDropData.backlogDropTarget ? "true" : undefined}
        data-backlog-page-scope={scope}
        data-backlog-group-label={pageDropData.backlogGroupLabel}
        data-backlog-channel={pageDropData.backlogChannel}
        data-backlog-contextual={pageDropData.backlogContextual ? "true" : undefined}
        data-backlog-objective-id={pageDropData.backlogObjectiveId || undefined}
      >
        <div className="backlog-toolbar">
          <nav className="backlog-toolbar-scope" aria-label="Breadcrumb">
            <ScopeIcon size={15} weight={activeArea && !activeProject ? "fill" : "regular"} />
            <ol>
              {scopeBreadcrumb.map((item, index) => (
                <li key={`${item.scope}-${item.label}`}>
                  <button
                    aria-current={index === scopeBreadcrumb.length - 1 ? "page" : undefined}
                    className="backlog-breadcrumb-button"
                    type="button"
                    onClick={() => onScopeChange?.(item.scope)}
                  >
                    {item.label}
                  </button>
                  {index < scopeBreadcrumb.length - 1 ? (
                    <span aria-hidden="true">/</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </nav>
          <span className="backlog-toolbar-spacer" />
          {activeArea || activeProject ? (
            <HorizonFilterControl
              horizons={HORIZON_LABELS}
              selectedHorizons={visibleHorizonLabels}
              onHorizonFilterChange={setVisibleHorizonLabels}
            />
          ) : null}
          {!(activeArea || activeProject) && activeListLabel !== "Scheduled" && areas.length ? (
            <button
              type="button"
              onClick={(event) => startAddingTask(defaultTaskContext(), event.currentTarget)}
            >
              <Plus size={15} /> Add task
            </button>
          ) : null}
        </div>

        <div className="work-index-content">
          <header className="work-index-heading">
            {activeProject ? (
              <button
                className="work-index-heading-icon work-index-heading-completion"
                type="button"
                aria-label={activeProject.complete ? "Mark project incomplete" : "Mark project complete"}
                style={{
                  "--work-scope-color": activeProject.complete ? "var(--green)" : "#b7b8bc",
                }}
                onClick={() => onToggleObjective?.(activeProject.id)}
              >
                <CheckCircle
                  size={24}
                  weight={activeProject.complete ? "fill" : "regular"}
                />
              </button>
            ) : (
              <span
                className="work-index-heading-icon"
                style={{ "--work-scope-color": activeArea?.color || "#7b5bd2" }}
              >
                <ScopeIcon size={24} weight={activeArea ? "fill" : "regular"} />
              </span>
            )}
            <span>
              <h1>
                {activeProject ? (
                  <button
                    className="work-index-project-title"
                    data-objective-title-id={activeProject.id}
                    type="button"
                    onClick={(event) => onOpenObjective?.(activeProject, event.currentTarget)}
                  >
                    {scopeLabel}
                  </button>
                ) : activeArea ? (
                  <button
                    className="work-index-project-title work-index-area-title"
                    data-area-title-id={activeArea.id}
                    type="button"
                    onClick={(event) => onOpenArea?.(activeArea, event.currentTarget)}
                  >
                    {scopeLabel}
                  </button>
                ) : scopeLabel}
              </h1>
              <p>{scopeDescription}</p>
            </span>
          </header>

          {canCreateProjectInCurrentScope && projectDraft?.areaId === null ? (
            <form className="work-project-create" onSubmit={createProject}>
              <Target size={18} />
              <AutoGrowingTextarea
                ref={projectInputRef}
                aria-label="New project title"
                autoComplete="off"
                placeholder="Name the result you want to achieve"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    createProject(event);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelProjectDraft();
                  }
                }}
              />
              <select
                aria-label="Project area"
                value={projectChannel}
                onChange={(event) => setProjectChannel(event.target.value)}
              >
                {areas.map((area) => (
                  <option key={area.id} value={area.label}>{area.label}</option>
                ))}
              </select>
              <button type="submit">Create</button>
            </form>
          ) : null}

          <div className="work-area-list" ref={backlogLayoutRef}>
            {activeProject ? projectTemporalSections.map(({ group, context }) => (
              <section className="work-temporal-section" key={group.id}>
                <SortableCollectionDropProxy
                  as="header"
                  className="work-temporal-header"
                  data-backlog-layout-key={`header:${context.key}`}
                  {...taskContextDropProxyProps(context)}
                >
                  <strong>{group.label}</strong>
                  <span>{context.items.length} {context.items.length === 1 ? "task" : "tasks"}</span>
                </SortableCollectionDropProxy>
                {renderTaskContext(context, {
                  addLabel: `Add task to ${group.label}`,
                  emptyLabel: activeProject.complete
                    ? "No tasks in this list."
                    : "No tasks here yet.",
                  showAddRow: !activeProject.complete && group.label !== "Scheduled",
                })}
              </section>
            )) : activeArea ? (
              <section className="work-area-section focused">
                {areaTemporalSections.map(({
                  group,
                  looseContext,
                  projectSections,
                  taskCount,
                }) => (
                  <section className="work-temporal-section" key={group.id}>
                    <SortableCollectionDropProxy
                      as="header"
                      className="work-temporal-header"
                      data-backlog-layout-key={`header:${looseContext.key}`}
                      {...taskContextDropProxyProps(looseContext)}
                    >
                      <strong>{group.label}</strong>
                      <span>{taskCount} {taskCount === 1 ? "task" : "tasks"}</span>
                    </SortableCollectionDropProxy>

                    {renderTaskContext(looseContext, {
                      addLabel: `Add task to ${activeArea.label}`,
                      emptyLabel: projectSections.length ? null : "No standalone tasks yet.",
                      showAddRow: group.label !== "Scheduled",
                    })}

                    {projectSections.length ? (
                      <SortableCollectionLane
                        className="work-area-project-list"
                        collectionId={`area-projects-${activeArea.id}-${group.id}`}
                        collectionSnapshot={objectives}
                        items={projectSections.map(({ project }) => project)}
                        laneId={`${activeArea.id}-${group.id}`}
                        onMove={(move) => moveProjectsInArea(
                          projectSections.map(({ project }) => project.id),
                          move,
                        )}
                        onRestore={setObjectives}
                        surfaceId={`backlog-area-projects-${activeArea.id}-${group.id}`}
                      >
                        {({ collectionItemProps }) => projectSections.map(({
                          project,
                          items,
                        }, index) => renderProjectSection(
                          activeArea,
                          project,
                          items,
                          collectionItemProps(project, index, { type: "objective" }),
                          group.label,
                        ))}
                      </SortableCollectionLane>
                    ) : null}
                  </section>
                ))}

                {renderAreaProjectDraft(activeArea)}
                {canCreateProjectInCurrentScope && projectDraft?.areaId !== activeArea.id ? (
                  <button
                    aria-label={`New project in ${activeArea.label}`}
                    className="work-area-add-project-button"
                    type="button"
                    onClick={(event) => startAddingProject(activeArea, event.currentTarget)}
                  >
                    <Plus size={15} /> New project
                  </button>
                ) : null}
              </section>
            ) : areaSections.map(({
              area,
              looseItems,
              projectSections,
              taskCount,
            }) => {
              const looseContext = contextForArea(area, looseItems);
              return (
                <section
                  className={`work-area-section ${activeArea ? "focused" : ""}`}
                  key={area.id}
                >
                  {!activeArea ? (
                    <SortableCollectionDropProxy
                      as="header"
                      className="work-area-header"
                      data-backlog-layout-key={`header:${looseContext.key}`}
                      {...taskContextDropProxyProps(looseContext)}
                    >
                      <Folder size={17} weight="fill" style={{ color: area.color }} />
                      <button
                        className="work-area-title"
                        data-area-title-id={area.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenArea?.(area, event.currentTarget);
                        }}
                      >
                        {area.label}
                      </button>
                      <span>{taskCount} {taskCount === 1 ? "task" : "tasks"}</span>
                    </SortableCollectionDropProxy>
                  ) : null}

                  {renderTaskContext(looseContext, {
                    addLabel: `Add task to ${area.label}`,
                    emptyLabel: projectSections.length ? null : "No standalone tasks yet.",
                    showAddRow: true,
                  })}

                  {area.id === areaId && projectSections.length ? (
                    <SortableCollectionLane
                      className="work-area-project-list"
                      collectionId={`area-projects-${area.id}`}
                      collectionSnapshot={objectives}
                      items={projectSections.map(({ project }) => project)}
                      laneId={area.id}
                      onMove={(move) => moveProjectsInArea(
                        projectSections.map(({ project }) => project.id),
                        move,
                      )}
                      onRestore={setObjectives}
                      surfaceId={`backlog-area-projects-${area.id}`}
                    >
                      {({ collectionItemProps }) => projectSections.map(({
                        project,
                        items,
                      }, index) => renderProjectSection(
                        area,
                        project,
                        items,
                        collectionItemProps(project, index, { type: "objective" }),
                      ))}
                    </SortableCollectionLane>
                  ) : projectSections.map(({ project, items }) => (
                    renderProjectSection(area, project, items)
                  ))}

                  {renderAreaProjectDraft(area)}
                  {canCreateProjectInCurrentScope && projectDraft?.areaId !== area.id ? (
                    <button
                      aria-label={`New project in ${area.label}`}
                      className="work-area-add-project-button"
                      type="button"
                      onClick={(event) => startAddingProject(area, event.currentTarget)}
                    >
                      <Plus size={15} /> New project
                    </button>
                  ) : null}
                </section>
              );
            })}

            {!activeProject && !areaSections.length ? (
              <section className="work-index-empty">
                <ScopeIcon size={24} />
                <h2>Nothing here yet</h2>
                <p>
                  {isScheduledList
                    ? "Tasks scheduled for today or later will appear here."
                    : "Add a task or create a project when this work becomes relevant."}
                </p>
                {!isScheduledList && areas.length ? (
                  <button
                    type="button"
                    onClick={(event) => startAddingTask(defaultTaskContext(), event.currentTarget)}
                  >
                    <Plus size={15} /> Add task
                  </button>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </section>
      <RightPanel
        activePane={activeRightPane}
        areas={areas}
        onPaneChange={onRightPaneChange}
        tasks={tasks}
        setTasks={setTasks}
        datedTasksByDate={datedTasksByDate}
        setDatedTasksByDate={setDatedTasksByDate}
        events={events}
        setEvents={setEvents}
        objectives={objectives}
        setObjectives={setObjectives}
        weeklyFocusedObjectives={weeklyFocusedObjectives}
        setWeeklyFocusedObjectives={setWeeklyFocusedObjectives}
        unavailableTaskIds={rightPanelUnavailableTaskIds}
        backlogGroups={groups}
        setBacklogGroups={setGroups}
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

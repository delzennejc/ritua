import { sessionAtPointer, sessionDragTaskId } from "./utils/session-drag";
import { createCalendarSession, linkSessionTask, moveSessionTask } from "../../../domain/calendar-sessions";
import { CalendarSessionsProvider } from "./components/CalendarSessions";
import { workspaceStore, replaceWorkspaceFields } from "../desktop/workspace-store";
import { completeWeeklyPlanning } from "../../../domain/planning-entry";
import { profileActor } from "../../../domain/local-profile";
import { detachInactiveTaskReferences, undoInactiveTaskReferences, toggleTaskCompletion } from "../desktop/workspace-actions";
import { reportActionError } from "../desktop/ActionErrors";
import { freshOccurrence } from "../../../domain/recurring-workspace";
import { useWorkspaceState, beginWorkspaceGesture, endWorkspaceGesture } from "../desktop/workspace-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoScroller,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { Folder, PushPin } from "@phosphor-icons/react";
import { AddTaskForm } from "./components/AddTaskForm";
import { AreaDetails } from "./components/AreaDetails";
import { AutoScheduleAnimation, captureScheduleOrigin } from "./components/AutoScheduleAnimation";
import { BacklogTaskRow } from "./components/BacklogTaskRow";
import { AreaFoldersProvider } from "./components/FolderLabel";
import { ObjectiveDetails } from "./components/ObjectiveDetails";
import { RituaMenu } from "./components/RituaMenu";
import { ScheduleTaskDialog } from "./components/ScheduleTaskDialog";
import { TaskCard } from "./components/TaskCard";
import { TaskAreaActionsProvider } from "./components/TaskAreaAction";
import { TaskDetails } from "./components/TaskDetails";
import { TaskReorderAnimator } from "./components/TaskReorderAnimator";
import { NavigationToggle, RightPanelToggle } from "./components/TopControls";
import { UndoSnackbar } from "./components/UndoSnackbar";
import { WeeklyObjectiveCard } from "./components/WeeklyObjectiveCard";
import {
  DEFAULT_BACKLOG_GROUPS,
  DEFAULT_DATED_TASKS,
  DEFAULT_EVENTS,
  DEFAULT_TASKS,
  DEFAULT_PROJECTS,
  DEFAULT_AREAS,
} from "../../../domain/workspace-defaults";
import { AREA_COLOR_OPTIONS } from "./data/areaColors";
import { BacklogView } from "./views/BacklogView";
import { BoardView } from "./views/BoardView";
import { DailyPlanningView } from "./views/daily-planning/DailyPlanningView";
import { WeeklyPlanningView } from "./views/weekly-planning/WeeklyPlanningView";
import { moveTaskBetweenDates } from "./utils/board";
import { CalendarAwareAutoScroller } from "./utils/CalendarAwareAutoScroller";
import { moveItemBetweenLanes, RIGHT_PANEL_BACKLOG_COLLECTION_ID } from "./utils/collections";
import {
  CALENDAR_DRAG_TYPE,
  calendarEndAfterResize,
  nextAvailableCalendarStart,
  calendarStartAfterMove,
  calendarStartAtPointer,
} from "./utils/calendar";
import { CURRENT_DATE_KEY, dateFromKey, addDays, mondayOf, previousWeekDays } from "./utils/dates";
import {
  recurrenceDateKeys,
  recurrenceLabel,
} from "../../../domain/recurrence";
import {
  completeUndatedTaskInTasks,
  completedTasksLast,
  insertBeforeCompletedTasks,
  nextScheduledOccurrences,
  orderTasksByTime,
  setTaskCompletionInObjectiveMirrors,
  toggleSubtaskInTasks,
  upcomingScheduledTasks,
} from "../../../domain/tasks";
import { minutesLabel, timeLabel } from "./utils/time";
import {
  appendTaskActivity,
  isNoteEditedActivity,
  noteEditedActivity,
  taskActivityWithCreation,
} from "./utils/taskActivity";

const initialDatedTasks = () => Object.fromEntries(
  Object.entries(DEFAULT_DATED_TASKS).map(([dateKey, dateTasks]) => [
    dateKey,
    completedTasksLast(dateTasks.map((task) => ({
      ...task,
      subtasks: task.subtasks?.map((subtask) => ({ ...subtask })),
    }))),
  ]),
);

const objectiveChannel = (channel) => channel;

const areaAccentForLabel = (label, areas = DEFAULT_AREAS) => {
  const resolvedLabel = objectiveChannel(label);
  const area = areas.find((candidate) => candidate.label === resolvedLabel);
  return area?.accent
    || AREA_COLOR_OPTIONS.find(option => option.color === area?.color)?.accent
    || "violet";
};

const areaIdFromLabel = (label, areas) => {
  const baseId = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "area";
  const existingIds = new Set(areas.map((area) => area.id));
  if (!existingIds.has(baseId)) return baseId;

  let suffix = 2;
  while (existingIds.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
};

const reorderAreas = (areas, { itemId, targetIndex }) => {
  const sourceIndex = areas.findIndex((area) => area.id === itemId);
  if (sourceIndex === -1) return areas;

  const nextAreas = [...areas];
  const [movedArea] = nextAreas.splice(sourceIndex, 1);
  const insertionIndex = Math.max(
    0,
    Math.min(Number.isFinite(targetIndex) ? targetIndex : nextAreas.length, nextAreas.length),
  );
  if (sourceIndex === insertionIndex) return areas;

  nextAreas.splice(insertionIndex, 0, movedArea);
  return nextAreas;
};

const WEEKLY_OBJECTIVE_COLLECTION_ID = "weekly-objectives";
const RIGHT_PANEL_OBJECTIVE_SURFACE_ID = "right-panel-objectives";
const THIS_WEEK_OBJECTIVE_LANE_ID = "this-week-projects";
const OTHER_OBJECTIVE_LANE_ID = "other-projects";
const NAVIGATION_AREA_COLLECTION_ID = "navigation-areas";
const NAVIGATION_AREA_SURFACE_ID = "primary-navigation";
const CARD_CROSSING_THRESHOLD_RATIO = 0.1;

const backlogTaskDetailsAdapter = (task, areas = DEFAULT_AREAS) => ({
  ...task,
  accent: task.accent || areaAccentForLabel(task.channel, areas),
  minutes: Number.isFinite(task.minutes) && task.minutes > 0 ? task.minutes : 30,
  time: task.time || null,
});

const withoutTaskRecurrence = (task) => {
  const {
    recurrence,
    recurrenceIndex,
    recurrenceSeriesId,
    recurrenceStartDateKey,
    ...singleTask
  } = task;
  return singleTask;
};

const linkTaskInList = (items, taskId, objectiveId) => items.map((task) => {
  if (task.id !== taskId) return task;

  const nextTask = { ...task };
  if (objectiveId) nextTask.objectiveId = objectiveId;
  else delete nextTask.objectiveId;
  return nextTask;
});

const syncedDurationLabel = (task, minutes) => {
  if (!task.durationLabel) return task.durationLabel;
  const nextLabel = minutesLabel(minutes);
  if (!task.durationLabel.includes("/")) return nextLabel;

  const [previousActual] = task.durationLabel.split("/");
  const actualLabel = task.actualMinutes !== undefined
    ? minutesLabel(task.actualMinutes)
    : previousActual.trim();
  return `${actualLabel} / ${nextLabel}`;
};

const applyTaskDetailsPatch = (task, patch) => {
  const nextTask = { ...task, ...patch };
  if (!task.durationLabel) return nextTask;

  if (!task.durationLabel.includes("/")) {
    return patch.minutes === undefined
      ? nextTask
      : { ...nextTask, durationLabel: minutesLabel(nextTask.minutes) };
  }

  const [previousActual, previousPlanned] = task.durationLabel
    .split("/")
    .map((part) => part.trim());
  const actualLabel = patch.actualMinutes === undefined
    ? previousActual
    : minutesLabel(nextTask.actualMinutes);
  const plannedLabel = patch.minutes === undefined
    ? previousPlanned
    : minutesLabel(nextTask.minutes);

  return {
    ...nextTask,
    durationLabel: `${actualLabel} / ${plannedLabel}`,
  };
};

const updateTaskTiming = (items, taskId, start, duration) => {
  if (!items.some((task) => task.id === taskId)) return items;

  return orderTasksByTime(items.map((task) => (
    task.id === taskId
      ? {
          ...task,
          time: start === null ? null : timeLabel(start),
          ...(duration === undefined ? {} : {
            minutes: duration,
            durationLabel: syncedDurationLabel(task, duration),
          }),
        }
      : task
  )));
};

const findTaskDateKey = ({ tasks, datedTasksByDate }, taskId) => {
  if (tasks.some((task) => task.id === taskId)) return CURRENT_DATE_KEY;

  return Object.entries(datedTasksByDate).find(([, dateTasks]) => (
    dateTasks.some((task) => task.id === taskId)
  ))?.[0] || null;
};

const tasksForDateKey = ({ tasks, datedTasksByDate }, dateKey) => (
  dateKey === CURRENT_DATE_KEY ? tasks : datedTasksByDate[dateKey] || []
);

const BOARD_TRANSFER_OVERLAP_RATIO = 0.35;
const BACKLOG_CARD_PREVIEW_ENTER_DISTANCE = 84;
const BACKLOG_CARD_PREVIEW_EXIT_DISTANCE = 48;
const BOARD_INSERTION_PREVIEW_DURATION_MS = 160;
const BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT = 68;
const POST_DRAG_CLICK_GUARD_DURATION_MS = 80;
const TASK_CARD_POINTER_TOP_OFFSET = 10;

const captureIndexedEntries = (items, predicate) => items.reduce((entries, item, index) => (
  predicate(item) ? [...entries, { index, item }] : entries
), []);

const restoreIndexedEntries = (items, entries, identity) => {
  if (!entries?.length) return items;

  const nextItems = [...items];
  [...entries]
    .sort((first, second) => first.index - second.index)
    .forEach(({ index, item }) => {
      const itemIdentity = identity(item);
      if (nextItems.some((candidate) => identity(candidate) === itemIdentity)) return;
      nextItems.splice(Math.min(Math.max(index, 0), nextItems.length), 0, item);
    });
  return nextItems;
};

const taskIdentity = (task) => task.taskId || task.id;
const objectiveIdentity = (objective) => objective.id;
const eventIdentity = (calendarEvent) => (
  `${calendarEvent.id}:${calendarEvent.dateKey || CURRENT_DATE_KEY}`
);

const isMainBacklogSurfaceId = (surfaceId) => (
  surfaceId === "backlog-main" || surfaceId?.startsWith("backlog-main-")
);

const pointerFromNativeEvent = (nativeEvent) => (
  Number.isFinite(nativeEvent?.clientX) && Number.isFinite(nativeEvent?.clientY)
    ? { x: nativeEvent.clientX, y: nativeEvent.clientY }
    : null
);

const calendarResizeDeltaY = (operation, pointer) => (
  Number.isFinite(pointer?.y)
    ? pointer.y - operation.position.initial.y
    : operation.position.current.y - operation.position.initial.y
);

const resizedCalendarEnd = (sourceData, operation) => {
  const scrollDelta = (
    sourceData.timelineScrollRef?.current?.scrollTop
    - (sourceData.dragStartScrollTopRef?.current || 0)
  ) || 0;

  return calendarEndAfterResize({
    start: sourceData.start,
    end: sourceData.end,
    deltaY: calendarResizeDeltaY(operation),
    scrollDelta,
  });
};

const draggedCardRectAtPointer = (pointer, session) => {
  if (!pointer || !session?.sourceRect || !session.grabOffset) return null;
  const height = session.sourceRect.bottom - session.sourceRect.top;
  if (height <= 0) return null;
  const top = pointer.y - session.grabOffset.y;
  return {
    top,
    bottom: top + height,
    height,
  };
};

const crossedCardReorderThreshold = (pointer, session, targetRect, direction) => {
  const dragRect = draggedCardRectAtPointer(pointer, session);
  if (!dragRect || !targetRect || !direction) return false;
  const threshold = dragRect.height * CARD_CROSSING_THRESHOLD_RATIO;
  return direction > 0
    ? dragRect.bottom >= targetRect.top + threshold
    : dragRect.top <= targetRect.bottom - threshold;
};

const horizontalOverlap = (dragRect, columnRect) => (
  Math.max(
    0,
    Math.min(dragRect.right, columnRect.right)
      - Math.max(dragRect.left, columnRect.left),
  )
);

const boardTargetFromColumn = (column, boardState, pointer) => {
  const dateKey = column.dataset.dateKey;
  const boardSurfaceId = column.dataset.boardSurfaceId;
  if (!dateKey || !boardSurfaceId) return null;

  const dateTasks = tasksForDateKey(boardState, dateKey);
  const taskStack = column.matches(".task-stack")
    ? column
    : column.querySelector(".task-stack");
  const cardEntries = Array.from(taskStack?.children || []).filter((element) => (
    element.matches(".task-card[data-board-task-id]")
  )).map((element) => ({
    element,
    rect: element.getBoundingClientRect(),
    taskId: element.dataset.boardTaskId,
  }));
  const visibleTaskIds = cardEntries.map(({ taskId }) => taskId);
  const isFilteredBoard = visibleTaskIds.length !== dateTasks.length;
  const targetCard = cardEntries.find(({ rect }) => pointer.y <= rect.bottom);

  if (targetCard) {
    const index = dateTasks.findIndex((task) => task.id === targetCard.taskId);
    if (index === -1) return null;

    return {
      id: `board-task:${boardSurfaceId}:${targetCard.taskId}`,
      element: targetCard.element,
      data: {
        kind: "board-task",
        taskId: targetCard.taskId,
        dateKey,
        index,
        visibleIndex: isFilteredBoard
          ? visibleTaskIds.indexOf(targetCard.taskId)
          : undefined,
        visibleTaskIds: isFilteredBoard ? visibleTaskIds : undefined,
        boardSurfaceId,
      },
    };
  }

  const insertAtStart = Boolean(
    cardEntries.length && pointer.y < cardEntries[0].rect.top,
  );

  return {
    id: `board-column:${boardSurfaceId}:${dateKey}`,
    element: column,
    data: {
      kind: "board-column",
      dateKey,
      insertionIndex: insertAtStart ? 0 : dateTasks.length,
      insertionVisibleIndex: isFilteredBoard
        ? (insertAtStart ? 0 : visibleTaskIds.length)
        : undefined,
      visibleTaskIds: isFilteredBoard ? visibleTaskIds : undefined,
      boardSurfaceId,
    },
  };
};

const boardTargetFromItemElement = (column, element, boardState) => {
  const dateKey = column?.dataset.dateKey;
  const boardSurfaceId = column?.dataset.boardSurfaceId;
  const taskId = element?.dataset.boardTaskId;
  if (!dateKey || !boardSurfaceId || !taskId) return null;

  const dateTasks = tasksForDateKey(boardState, dateKey);
  const taskStack = column.matches(".task-stack")
    ? column
    : column.querySelector(".task-stack");
  const visibleTaskIds = Array.from(taskStack?.children || [])
    .filter((card) => card.matches(".task-card[data-board-task-id]"))
    .map((card) => card.dataset.boardTaskId);
  const index = dateTasks.findIndex((task) => task.id === taskId);
  if (index === -1) return null;
  const isFilteredBoard = visibleTaskIds.length !== dateTasks.length;

  return {
    id: `board-task:${boardSurfaceId}:${taskId}`,
    element,
    data: {
      kind: "board-task",
      taskId,
      dateKey,
      index,
      visibleIndex: isFilteredBoard ? visibleTaskIds.indexOf(taskId) : undefined,
      visibleTaskIds: isFilteredBoard ? visibleTaskIds : undefined,
      boardSurfaceId,
    },
  };
};

const verticalBoardTargetAtThreshold = (
  pointer,
  sourceData,
  session,
  boardState,
) => {
  if (
    typeof document === "undefined"
    || !pointer
    || sourceData?.kind !== "board-task"
    || !session?.sourceRect
    || !session.grabOffset
    || !session?.verticalDirection
  ) return null;

  const boardSurfaceId = session.projectedBoardSurfaceId
    || sourceData.boardSurfaceId;
  const dateKey = session.projectedDateKey || sourceData.sourceDateKey;
  const column = Array.from(document.querySelectorAll(
    '[data-board-drop-zone="true"][data-board-surface-id][data-date-key]',
  )).find((element) => (
    element.dataset.boardSurfaceId === boardSurfaceId
    && element.dataset.dateKey === dateKey
  ));
  if (!column) return null;

  const columnRect = column.getBoundingClientRect();
  if (pointer.x < columnRect.left || pointer.x > columnRect.right) return null;

  const taskStack = column.matches(".task-stack")
    ? column
    : column.querySelector(".task-stack");
  const cards = Array.from(taskStack?.children || [])
    .filter((element) => element.matches(".task-card[data-board-task-id]"));
  const sourcePosition = cards.findIndex((element) => (
    element.dataset.boardTaskId === sourceData.taskId
  ));
  if (sourcePosition === -1) return null;

  const targetElement = cards[sourcePosition + session.verticalDirection];
  if (!targetElement) return { blocked: true };
  const targetRect = targetElement.getBoundingClientRect();
  if (!crossedCardReorderThreshold(
    pointer,
    session,
    targetRect,
    session.verticalDirection,
  )) {
    return { blocked: true };
  }

  const target = boardTargetFromItemElement(column, targetElement, boardState);
  return target
    ? { target, fromCardReorderThreshold: true }
    : { blocked: true };
};

const overlapBoardTarget = (operation, pointer, session, boardState) => {
  if (
    typeof document === "undefined"
    || !pointer
    || !session?.sourceRect
    || !session.horizontalDirection
  ) {
    return null;
  }

  const deltaX = operation.position.current.x - operation.position.initial.x;
  const deltaY = operation.position.current.y - operation.position.initial.y;
  const scrollDeltaX = session.boardScrollElement
    ? session.boardScrollElement.scrollLeft - session.boardStartScrollLeft
    : 0;
  const scrollDeltaY = session.boardScrollElement
    ? session.boardScrollElement.scrollTop - session.boardStartScrollTop
    : 0;
  const dragRect = {
    left: session.sourceRect.left + deltaX - scrollDeltaX,
    right: session.sourceRect.right + deltaX - scrollDeltaX,
    top: session.sourceRect.top + deltaY - scrollDeltaY,
    bottom: session.sourceRect.bottom + deltaY - scrollDeltaY,
    width: session.sourceRect.width,
  };
  const boardSurfaceId = session.projectedBoardSurfaceId
    || session.sourceData.boardSurfaceId;
  const projectedDateKey = session.projectedDateKey
    || session.sourceData.sourceDateKey;
  const columns = Array.from(
    document.querySelectorAll(
      '[data-board-drop-zone="true"][data-board-surface-id][data-date-key]',
    ),
  ).filter((column) => column.dataset.boardSurfaceId === boardSurfaceId);
  const currentColumn = columns.find((column) => (
    column.dataset.dateKey === projectedDateKey
  ));
  if (!currentColumn) return null;

  const currentRect = currentColumn.getBoundingClientRect();
  const inVerticalRange = (rect) => (
    dragRect.bottom > rect.top && dragRect.top < rect.bottom
  );
  const overlapRatio = (rect) => (
    horizontalOverlap(dragRect, rect) / dragRect.width
  );
  const currentOverlapRatio = overlapRatio(currentRect);
  const reversingDirection = (
    session.overlapProjectionActive
    && session.transferDirection
    && session.horizontalDirection !== session.transferDirection
  );
  if (
    reversingDirection
    && inVerticalRange(currentRect)
    && currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = boardTargetFromColumn(currentColumn, boardState, pointer);
    return target ? { target, fromCardOverlap: true } : null;
  }

  const currentColumnIndex = columns.indexOf(currentColumn);
  const nextColumn = columns[
    currentColumnIndex + session.horizontalDirection
  ];
  const nextRect = nextColumn?.getBoundingClientRect();
  const crossesNextColumn = Boolean(
    nextRect
    && inVerticalRange(nextRect)
    && overlapRatio(nextRect) >= BOARD_TRANSFER_OVERLAP_RATIO,
  );

  if (nextColumn && crossesNextColumn) {
    const target = boardTargetFromColumn(nextColumn, boardState, pointer);
    if (!target) return null;
    session.overlapProjectionActive = true;
    session.transferDirection = session.horizontalDirection;
    return {
      target,
      fromCardOverlap: true,
    };
  }

  if (
    session.overlapProjectionActive
    && inVerticalRange(currentRect)
    && currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = boardTargetFromColumn(currentColumn, boardState, pointer);
    if (!target) return null;
    return {
      target,
      fromCardOverlap: true,
    };
  }

  return null;
};

const boardDragTarget = (operation, pointer, sourceData, session, boardState) => {
  const overlapTarget = overlapBoardTarget(
    operation,
    pointer,
    session,
    boardState,
  );
  if (overlapTarget) return { targetOverride: overlapTarget };

  const reorderTarget = verticalBoardTargetAtThreshold(
    pointer,
    sourceData,
    session,
    boardState,
  );
  if (reorderTarget?.blocked) return { blocked: true };
  return {
    targetOverride: reorderTarget?.target ? reorderTarget : null,
  };
};

const isPointerOverBoard = (pointer) => {
  if (typeof document === "undefined") return false;
  if (!pointer) return false;
  return Boolean(
    document.elementFromPoint(pointer.x, pointer.y)?.closest?.('[data-board-drop-zone="true"]'),
  );
};

const boardTargetAtPointer = (pointer, boardState) => {
  if (typeof document === "undefined" || !pointer) return null;
  const column = document.elementFromPoint(pointer.x, pointer.y)?.closest?.(
    '[data-board-drop-zone="true"][data-board-surface-id][data-date-key]',
  );
  return column ? boardTargetFromColumn(column, boardState, pointer) : null;
};

const calendarTargetAtPointer = (pointer) => {
  if (typeof document === "undefined" || !pointer) return null;
  const element = document.elementFromPoint(pointer.x, pointer.y)?.closest?.(
    '[data-calendar-drop-zone="true"][data-date-key]',
  );
  if (!element) return null;

  return {
    id: `calendar-timeline:${element.dataset.dateKey}`,
    element,
    data: {
      kind: "calendar-timeline",
      dateKey: element.dataset.dateKey,
    },
  };
};

const backlogDropDataFromElement = (element) => {
  const backlogDropTarget = element.dataset.backlogDropZone === "true";
  const backlogScheduleTarget = element.dataset.backlogScheduleTarget === "true";
  if (!backlogDropTarget && !backlogScheduleTarget) return {};

  return {
    backlogDropTarget,
    backlogScheduleTarget,
    backlogGroupLabel: element.dataset.backlogGroupLabel,
    backlogChannel: element.dataset.backlogChannel,
    backlogContextual: element.dataset.backlogContextual === "true",
    backlogObjectiveId: element.dataset.backlogObjectiveId || null,
  };
};

const collectionTargetFromLane = (lane, pointer) => {
  const collectionId = lane.dataset.collectionId;
  const laneId = lane.dataset.collectionLaneId;
  const surfaceId = lane.dataset.collectionSurfaceId;
  if (!collectionId || !laneId || !surfaceId) return null;
  const externalDropData = backlogDropDataFromElement(lane);

  const itemEntries = Array.from(
    lane.querySelectorAll("[data-collection-item-id]"),
  ).filter((element) => (
    element.closest('[data-collection-drop-zone="true"]') === lane
  )).map((element) => ({
    element,
    index: Number(element.dataset.collectionIndex),
    itemId: element.dataset.collectionItemId,
    rect: element.getBoundingClientRect(),
  }));
  const targetItem = itemEntries.find(({ rect }) => pointer.y <= rect.bottom);

  if (targetItem) {
    return {
      id: `collection-item:${surfaceId}:${collectionId}:${targetItem.itemId}`,
      element: targetItem.element,
      data: {
        kind: "collection-item",
        collectionId,
        index: targetItem.index,
        itemId: targetItem.itemId,
        laneId,
        surfaceId,
        ...externalDropData,
      },
    };
  }

  const insertAtStart = Boolean(
    itemEntries.length && pointer.y < itemEntries[0].rect.top,
  );

  return {
    id: `collection-lane:${surfaceId}:${collectionId}:${laneId}`,
    element: lane,
    data: {
      kind: "collection-lane",
      collectionId,
      insertionIndex: insertAtStart ? 0 : itemEntries.length,
      referenceItemId: insertAtStart
        ? itemEntries[0]?.itemId
        : itemEntries[itemEntries.length - 1]?.itemId,
      insertAfterReference: !insertAtStart,
      laneId,
      surfaceId,
      ...externalDropData,
    },
  };
};

const collectionTargetFromItemElement = (element) => {
  const lane = element?.closest?.('[data-collection-drop-zone="true"]');
  const collectionId = lane?.dataset.collectionId;
  const laneId = lane?.dataset.collectionLaneId;
  const surfaceId = lane?.dataset.collectionSurfaceId;
  const itemId = element?.dataset.collectionItemId;
  const index = Number(element?.dataset.collectionIndex);
  if (!lane || !collectionId || !laneId || !surfaceId || !itemId) return null;

  return {
    id: `collection-item:${surfaceId}:${collectionId}:${itemId}`,
    element,
    data: {
      kind: "collection-item",
      collectionId,
      index: Number.isFinite(index) ? index : 0,
      itemId,
      laneId,
      surfaceId,
      ...backlogDropDataFromElement(lane),
    },
  };
};

const collectionLaneFromProxy = (proxy) => {
  if (!proxy || typeof document === "undefined") return null;
  const collectionId = proxy.dataset.collectionId;
  const laneId = proxy.dataset.collectionLaneId;
  const surfaceId = proxy.dataset.collectionSurfaceId;
  if (!collectionId || !laneId || !surfaceId) return null;

  return Array.from(document.querySelectorAll(
    '[data-collection-drop-zone="true"]',
  )).find((lane) => (
    lane.dataset.collectionId === collectionId
    && lane.dataset.collectionLaneId === laneId
    && lane.dataset.collectionSurfaceId === surfaceId
  )) || null;
};

const collectionTargetFromProxy = (proxy) => {
  const lane = collectionLaneFromProxy(proxy);
  if (!lane) return null;

  const collectionId = proxy.dataset.collectionId;
  const laneId = proxy.dataset.collectionLaneId;
  const surfaceId = proxy.dataset.collectionSurfaceId;
  const insertionIndex = Number(proxy.dataset.collectionInsertionIndex);
  return {
    id: `collection-proxy:${surfaceId}:${collectionId}:${laneId}`,
    element: proxy,
    data: {
      kind: "collection-lane",
      collectionId,
      laneId,
      insertionIndex: Number.isFinite(insertionIndex) ? insertionIndex : 0,
      surfaceId,
      ...backlogDropDataFromElement(proxy),
    },
  };
};

const backlogTargetAtPointer = (pointer) => {
  if (typeof document === "undefined" || !pointer) return null;
  const element = document.elementFromPoint(pointer.x, pointer.y);
  const lane = element?.closest?.(
    '[data-backlog-drop-zone="true"][data-collection-drop-zone="true"]',
  );
  if (lane) return collectionTargetFromLane(lane, pointer);

  const proxy = element?.closest?.('[data-collection-drop-proxy="true"]');
  const proxyTarget = collectionTargetFromProxy(proxy);
  if (proxyTarget) return proxyTarget;

  const page = element?.closest?.('[data-backlog-page-drop-zone="true"]');
  if (!page) return null;
  return {
    id: `backlog-page:${page.dataset.backlogPageScope}`,
    element: page,
    data: {
      kind: "backlog-page",
      scope: page.dataset.backlogPageScope,
      ...backlogDropDataFromElement(page),
    },
  };
};

const previewWidthForElement = (element) => {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 ? Math.round(rect.width) : null;
};

const boardPreviewTargetFromPane = (pane) => {
  if (!pane) return null;

  const taskCard = pane.querySelector?.('.task-card:not(.dragging)');
  const boardStack = pane.querySelector?.('.task-stack');
  const calendarTimeline = pane.matches?.('[data-calendar-drop-zone="true"]')
    ? pane
    : pane.querySelector?.('[data-calendar-drop-zone="true"]');
  return {
    element: pane,
    width: previewWidthForElement(taskCard)
      || previewWidthForElement(boardStack)
      || previewWidthForElement(calendarTimeline)
      || previewWidthForElement(pane),
  };
};

const boardPreviewTargetAtPointer = (pointer) => {
  if (typeof document === "undefined" || !pointer) return null;
  const element = document.elementFromPoint(pointer.x, pointer.y);
  const pane = element?.closest?.(
    '.right-panel-board, .right-panel-calendar, [data-board-drop-zone="true"], [data-calendar-drop-zone="true"]',
  );
  return boardPreviewTargetFromPane(pane);
};

const visibleRightPanelTaskTarget = () => {
  if (typeof document === "undefined") return null;
  return boardPreviewTargetFromPane(document.querySelector(
    '.right-panel.right-panel-board, .right-panel.right-panel-calendar',
  ));
};

const overlapCollectionTarget = (operation, pointer, session) => {
  if (
    typeof document === "undefined"
    || !pointer
    || !session?.sourceRect
    || !session.horizontalDirection
  ) {
    return null;
  }

  const surfaceId = session.sourceData.surfaceId;
  const collectionId = session.sourceData.collectionId;
  const lanes = Array.from(document.querySelectorAll(
    '[data-collection-drop-zone="true"][data-collection-axis="horizontal"]',
  )).filter((lane) => (
    lane.dataset.collectionSurfaceId === surfaceId
    && lane.dataset.collectionId === collectionId
  ));
  if (lanes.length < 2) return null;

  const deltaX = operation.position.current.x - operation.position.initial.x;
  const deltaY = operation.position.current.y - operation.position.initial.y;
  const scrollDeltaX = session.boardScrollElement
    ? session.boardScrollElement.scrollLeft - session.boardStartScrollLeft
    : 0;
  const scrollDeltaY = session.boardScrollElement
    ? session.boardScrollElement.scrollTop - session.boardStartScrollTop
    : 0;
  const dragRect = {
    left: session.sourceRect.left + deltaX - scrollDeltaX,
    right: session.sourceRect.right + deltaX - scrollDeltaX,
    top: session.sourceRect.top + deltaY - scrollDeltaY,
    bottom: session.sourceRect.bottom + deltaY - scrollDeltaY,
    width: session.sourceRect.width,
  };
  const projectedLaneId = session.projectedCollectionLaneId
    || session.sourceData.sourceLaneId;
  const currentLane = lanes.find((lane) => (
    lane.dataset.collectionLaneId === projectedLaneId
  ));
  if (!currentLane) return null;

  const inVerticalRange = (rect) => (
    dragRect.bottom > rect.top && dragRect.top < rect.bottom
  );
  const overlapRatio = (rect) => (
    horizontalOverlap(dragRect, rect) / dragRect.width
  );
  const currentRect = currentLane.getBoundingClientRect();
  const currentOverlapRatio = overlapRatio(currentRect);
  const reversingDirection = (
    session.collectionOverlapProjectionActive
    && session.collectionTransferDirection
    && session.horizontalDirection !== session.collectionTransferDirection
  );

  if (
    reversingDirection
    && inVerticalRange(currentRect)
    && currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = collectionTargetFromLane(currentLane, pointer);
    return target ? { target, fromItemOverlap: true } : null;
  }

  const currentLaneIndex = lanes.indexOf(currentLane);
  const nextLane = lanes[currentLaneIndex + session.horizontalDirection];
  const nextRect = nextLane?.getBoundingClientRect();
  if (
    nextLane
    && inVerticalRange(nextRect)
    && overlapRatio(nextRect) >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = collectionTargetFromLane(nextLane, pointer);
    if (!target) return null;
    session.collectionOverlapProjectionActive = true;
    session.collectionTransferDirection = session.horizontalDirection;
    return { target, fromItemOverlap: true };
  }

  if (
    session.collectionOverlapProjectionActive
    && inVerticalRange(currentRect)
    && currentOverlapRatio >= BOARD_TRANSFER_OVERLAP_RATIO
  ) {
    const target = collectionTargetFromLane(currentLane, pointer);
    return target ? { target, fromItemOverlap: true } : null;
  }

  return null;
};

const collectionTargetAtPointer = (
  pointer,
  sourceData,
  surfaceId = sourceData?.surfaceId,
) => {
  if (typeof document === "undefined" || !pointer || !sourceData) return null;

  let element = document.elementFromPoint(pointer.x, pointer.y);
  while (element) {
    if (
      element.dataset?.collectionDropZone === "true"
      && element.dataset.collectionId === sourceData.collectionId
      && (!surfaceId || element.dataset.collectionSurfaceId === surfaceId)
    ) {
      return collectionTargetFromLane(element, pointer);
    }
    if (
      element.dataset?.collectionDropProxy === "true"
      && element.dataset.collectionId === sourceData.collectionId
      && (!surfaceId || element.dataset.collectionSurfaceId === surfaceId)
    ) {
      const proxyTarget = collectionTargetFromProxy(element);
      if (proxyTarget) return proxyTarget;
    }
    element = element.parentElement;
  }

  return null;
};

const navigationAreaEdgeTargetAtPointer = (pointer, sourceData) => {
  if (
    typeof document === "undefined"
    || !pointer
    || sourceData?.collectionId !== NAVIGATION_AREA_COLLECTION_ID
    || sourceData.surfaceId !== NAVIGATION_AREA_SURFACE_ID
  ) return null;

  const lane = Array.from(document.querySelectorAll(
    '[data-collection-drop-zone="true"]',
  )).find((element) => (
    element.dataset.collectionId === sourceData.collectionId
    && element.dataset.collectionSurfaceId === sourceData.surfaceId
    && element.dataset.collectionLaneId === sourceData.sourceLaneId
  ));
  const navigation = lane?.closest?.("nav");
  if (!lane || !navigation) return null;

  const laneRect = lane.getBoundingClientRect();
  const navigationRect = navigation.getBoundingClientRect();
  const withinNavigationColumn = (
    pointer.x >= laneRect.left
    && pointer.x <= laneRect.right
    && pointer.y >= navigationRect.top
    && pointer.y <= navigationRect.bottom
  );
  if (!withinNavigationColumn) return null;

  const edge = pointer.y < laneRect.top
    ? "start"
    : pointer.y > laneRect.bottom
      ? "end"
      : null;
  if (!edge) return null;

  const collectionLength = Number(lane.dataset.collectionLength);
  return {
    target: {
      id: `collection-edge:${sourceData.surfaceId}:${sourceData.collectionId}:${edge}`,
      element: lane,
      data: {
        kind: "collection-lane",
        collectionId: sourceData.collectionId,
        insertionIndex: edge === "start"
          ? 0
          : Number.isFinite(collectionLength) ? collectionLength : 0,
        laneId: sourceData.sourceLaneId,
        surfaceId: sourceData.surfaceId,
      },
    },
    fromCollectionEdgeIntent: true,
  };
};

const rightPanelObjectiveTargetAtThreshold = (pointer, sourceData, session) => {
  if (
    typeof document === "undefined"
    || !pointer
    || !session?.sourceRect
    || !session.grabOffset
    || sourceData?.collectionId !== WEEKLY_OBJECTIVE_COLLECTION_ID
    || sourceData.surfaceId !== RIGHT_PANEL_OBJECTIVE_SURFACE_ID
  ) return null;

  const boundary = document.querySelector(".right-panel-objective-boundary");
  const pane = boundary?.closest?.(".objectives-pane-content");
  const focusedLane = document.querySelector(
    `[data-collection-drop-zone="true"]`
    + `[data-collection-id="${WEEKLY_OBJECTIVE_COLLECTION_ID}"]`
    + `[data-collection-surface-id="${RIGHT_PANEL_OBJECTIVE_SURFACE_ID}"]`
    + `[data-collection-lane-id="${THIS_WEEK_OBJECTIVE_LANE_ID}"]`,
  );
  const otherLane = document.querySelector(
    `[data-collection-drop-zone="true"]`
    + `[data-collection-id="${WEEKLY_OBJECTIVE_COLLECTION_ID}"]`
    + `[data-collection-surface-id="${RIGHT_PANEL_OBJECTIVE_SURFACE_ID}"]`
    + `[data-collection-lane-id="${OTHER_OBJECTIVE_LANE_ID}"]`,
  );
  if (!boundary || !pane || !focusedLane || !otherLane) return null;

  const paneRect = pane.getBoundingClientRect();
  if (
    pointer.x < paneRect.left
    || pointer.x > paneRect.right
    || pointer.y < paneRect.top
    || pointer.y > paneRect.bottom
  ) return null;

  const sourceHeight = session.sourceRect.bottom - session.sourceRect.top;
  if (sourceHeight <= 0) return null;
  const boundaryRect = boundary.getBoundingClientRect();
  const boundaryY = boundaryRect.top + boundaryRect.height / 2;
  const draggedTop = pointer.y - session.grabOffset.y;
  const draggedBottom = draggedTop + sourceHeight;
  const overlapAboveBoundary = Math.max(
    0,
    Math.min(1, (boundaryY - draggedTop) / sourceHeight),
  );
  const overlapBelowBoundary = Math.max(
    0,
    Math.min(1, (draggedBottom - boundaryY) / sourceHeight),
  );
  const startedInThisWeek = sourceData.sourceLaneId === THIS_WEEK_OBJECTIVE_LANE_ID;
  const targetLane = startedInThisWeek
    ? (
      overlapBelowBoundary >= CARD_CROSSING_THRESHOLD_RATIO
        ? otherLane
        : focusedLane
    )
    : (
      overlapAboveBoundary >= CARD_CROSSING_THRESHOLD_RATIO
        ? focusedLane
        : otherLane
    );

  const target = collectionTargetFromLane(targetLane, pointer);
  return target ? { target, fromBoundaryThreshold: true } : null;
};

const rightPanelTaskTemporalTargetAtThreshold = (pointer, sourceData, session) => {
  if (
    typeof document === "undefined"
    || !pointer
    || !session?.sourceRect
    || !session.grabOffset
    || sourceData?.collectionId !== RIGHT_PANEL_BACKLOG_COLLECTION_ID
    || sourceData.surfaceId !== "right-panel-backlog"
  ) return null;

  const currentLaneId = session.projectedCollectionLaneId
    || sourceData.sourceLaneId;
  const currentLane = Array.from(document.querySelectorAll(
    '[data-collection-drop-zone="true"]',
  )).find((element) => (
    element.dataset.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID
    && element.dataset.collectionSurfaceId === "right-panel-backlog"
    && element.dataset.collectionLaneId === currentLaneId
  ));
  const group = currentLane?.closest?.(".right-panel-backlog-group");
  if (!group) return null;

  const temporalLanes = Array.from(group.querySelectorAll(
    '[data-collection-drop-zone="true"]',
  )).filter((element) => (
    element.closest(".right-panel-backlog-group") === group
    && element.dataset.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID
    && element.dataset.collectionSurfaceId === "right-panel-backlog"
    && element.dataset.collectionLaneId?.startsWith("later::")
  ));
  const anytimeLane = temporalLanes.find((element) => (
    element.dataset.backlogGroupLabel === "Anytime"
  ));
  const somedayLane = temporalLanes.find((element) => (
    element.dataset.backlogGroupLabel === "Someday"
  ));
  const boundary = Array.from(group.querySelectorAll(
    "[data-task-temporal-divider-id]",
  )).find((element) => (
    element.dataset.taskTemporalDividerId === somedayLane?.dataset.collectionLaneId
  ));
  if (!anytimeLane || !somedayLane || !boundary) return null;

  const groupRect = group.getBoundingClientRect();
  if (pointer.x < groupRect.left || pointer.x > groupRect.right) return null;

  const draggedRect = draggedCardRectAtPointer(pointer, session);
  if (!draggedRect) return null;
  const boundaryRect = boundary.getBoundingClientRect();
  const boundaryY = boundaryRect.top + boundaryRect.height / 2;
  const crossesBoundary = (
    draggedRect.top <= boundaryY && draggedRect.bottom >= boundaryY
  );
  if (!crossesBoundary) {
    session.taskTemporalBoundary = null;
    return null;
  }

  const anytimeLaneId = anytimeLane.dataset.collectionLaneId;
  const somedayLaneId = somedayLane.dataset.collectionLaneId;
  const boundaryKey = `${anytimeLaneId}|${somedayLaneId}`;
  if (session.taskTemporalBoundary?.key !== boundaryKey) {
    session.taskTemporalBoundary = {
      key: boundaryKey,
      originLaneId: currentLaneId,
    };
  }

  const overlapAboveBoundary = Math.max(
    0,
    Math.min(1, (boundaryY - draggedRect.top) / draggedRect.height),
  );
  const overlapBelowBoundary = Math.max(
    0,
    Math.min(1, (draggedRect.bottom - boundaryY) / draggedRect.height),
  );
  const startedInAnytime = (
    session.taskTemporalBoundary.originLaneId === anytimeLaneId
  );
  const targetLane = startedInAnytime
    ? (
      overlapBelowBoundary >= CARD_CROSSING_THRESHOLD_RATIO
        ? somedayLane
        : anytimeLane
    )
    : (
      overlapAboveBoundary >= CARD_CROSSING_THRESHOLD_RATIO
        ? anytimeLane
        : somedayLane
    );

  const target = collectionTargetFromLane(targetLane, pointer);
  return target ? { target, fromBoundaryThreshold: true } : null;
};

const verticalCollectionTargetAtThreshold = (pointer, sourceData, session) => {
  if (
    typeof document === "undefined"
    || !pointer
    || sourceData?.kind !== "collection-item"
    || sourceData.backlogTask
    || !session?.sourceRect
    || !session.grabOffset
    || !session?.verticalDirection
  ) return null;

  const currentLaneId = session.projectedCollectionLaneId
    || sourceData.sourceLaneId;
  const lane = Array.from(document.querySelectorAll(
    '[data-collection-drop-zone="true"]',
  )).find((element) => (
    element.dataset.collectionId === sourceData.collectionId
    && element.dataset.collectionSurfaceId === sourceData.surfaceId
    && element.dataset.collectionLaneId === currentLaneId
  ));
  if (!lane) return null;

  const laneRect = lane.getBoundingClientRect();
  if (pointer.x < laneRect.left || pointer.x > laneRect.right) return null;

  const items = Array.from(lane.querySelectorAll("[data-collection-item-id]"))
    .filter((element) => (
      element.closest('[data-collection-drop-zone="true"]') === lane
    ));
  const sourcePosition = items.findIndex((element) => (
    element.dataset.collectionItemId === sourceData.itemId
  ));
  if (sourcePosition === -1) return null;

  const targetElement = items[sourcePosition + session.verticalDirection];
  if (!targetElement) return { blocked: true };
  const targetRect = targetElement.getBoundingClientRect();
  if (!crossedCardReorderThreshold(
    pointer,
    session,
    targetRect,
    session.verticalDirection,
  )) {
    return { blocked: true };
  }

  const target = collectionTargetFromItemElement(targetElement);
  return target
    ? { target, fromCardReorderThreshold: true }
    : { blocked: true };
};

const collectionDragTarget = (operation, pointer, sourceData, session) => {
  const overlapTarget = overlapCollectionTarget(
    operation,
    pointer,
    session,
  );
  if (overlapTarget) return { targetOverride: overlapTarget };

  const boundaryTarget = rightPanelObjectiveTargetAtThreshold(
    pointer,
    sourceData,
    session,
  ) || rightPanelTaskTemporalTargetAtThreshold(
    pointer,
    sourceData,
    session,
  );
  const boundaryChangesLane = Boolean(
    boundaryTarget
    && boundaryTarget.target.data.laneId !== session.projectedCollectionLaneId,
  );
  if (boundaryChangesLane) return { targetOverride: boundaryTarget };

  const edgeTarget = navigationAreaEdgeTargetAtPointer(pointer, sourceData);
  if (edgeTarget) return { targetOverride: edgeTarget };

  const reorderTarget = verticalCollectionTargetAtThreshold(
    pointer,
    sourceData,
    session,
  );
  if (reorderTarget?.blocked) return { blocked: true };
  if (reorderTarget?.target) return { targetOverride: reorderTarget };

  const directTarget = boundaryTarget?.target
    || collectionTargetAtPointer(pointer, sourceData);
  return {
    targetOverride: directTarget ? { target: directTarget } : null,
  };
};

const isPointerOverCollection = (pointer, collectionId, surfaceId) => {
  if (typeof document === "undefined" || !pointer) return false;
  let element = document.elementFromPoint(pointer.x, pointer.y);
  while (element) {
    if (
      (
        element.dataset?.collectionDropZone === "true"
        || element.dataset?.collectionDropProxy === "true"
      )
      && element.dataset.collectionId === collectionId
      && element.dataset.collectionSurfaceId === surfaceId
    ) return true;
    element = element.parentElement;
  }
  return false;
};

const isPointerOverRightPanelBacklogGroup = (pointer, laneId) => {
  if (typeof document === "undefined" || !pointer || !laneId) return false;
  const lane = Array.from(document.querySelectorAll(
    '[data-collection-drop-zone="true"]',
  )).find((element) => (
    element.dataset.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID
    && element.dataset.collectionLaneId === laneId
    && element.dataset.collectionSurfaceId === "right-panel-backlog"
  ));
  const groupRect = lane?.closest?.(".right-panel-backlog-group")
    ?.getBoundingClientRect();
  return Boolean(
    groupRect
    && pointer.x >= groupRect.left
    && pointer.x <= groupRect.right
    && pointer.y >= groupRect.top
    && pointer.y <= groupRect.bottom
  );
};

const configureDndPlugins = (plugins) => plugins.map((plugin) => {
  if (plugin === AutoScroller) {
    return {
      plugin: CalendarAwareAutoScroller,
      options: {
        acceleration: 14,
        threshold: { x: 0.02, y: 0.08 },
      },
    };
  }

  return plugin;
});

const configureDndSensors = (sensors) => sensors.map((sensor) => {
  if (sensor === PointerSensor) {
    return PointerSensor.configure({
      activationConstraints: (event, source) => {
        const activationDistance = source.data?.pointerActivationDistance;
        if (event.pointerType === "mouse" && Number.isFinite(activationDistance)) {
          return [new PointerActivationConstraints.Distance({
            value: activationDistance,
          })];
        }

        const defaultConstraints = PointerSensor.defaults.activationConstraints;
        return typeof defaultConstraints === "function"
          ? defaultConstraints(event, source)
          : defaultConstraints;
      },
      activatorElements: (source) => {
        const selector = source.data?.pointerActivatorSelector;
        if (selector && source.element) {
          return [source.element.querySelector(selector)];
        }
        return [source.handle || source.element];
      },
    });
  }

  return sensor;
});

function DndPreview({ areas, presentation, source }) {
  const data = source?.data;
  if (data?.sessionTask) return <div className="session-task-drag-preview" style={{ width: presentation?.width }}>{data.title}</div>;

  if (!data || data.kind === "calendar-resize") return null;

  const transferableTask = (
    data.backlogTask
    || data.kind === "board-task"
    || data.kind === "calendar-event"
  );
  if (transferableTask) {
    const task = data.taskSnapshot
      || data.itemSnapshot
      || {
        id: data.eventId || data.taskId,
        title: data.title,
        minutes: Math.max((data.end || 0) - (data.start || 0), 30),
        channel: "Ritua",
        complete: false,
        accent: data.color || "violet",
      };
    const defaultKind = data.backlogTask
      ? "backlog"
      : data.kind === "calendar-event"
        ? "calendar"
        : "board";
    const previewKind = presentation?.kind || defaultKind;
    let content;

    if (previewKind === "backlog") {
      content = (
        <BacklogTaskRow
          item={task}
          variant={presentation?.variant || data.preview?.variant || "main"}
          dragPreview
        />
      );
    } else if (previewKind === "calendar") {
      content = (
        <div className={`dnd-calendar-preview ${data.color || "violet"}`}>
          <strong>{data.title}</strong>
          <span>{timeLabel(data.start)}–{timeLabel(data.end)}</span>
        </div>
      );
    } else {
      content = (
        <TaskCard
          task={backlogTaskDetailsAdapter(task, areas)}
          compact={data.previewOptions?.compact}
          dragPreview
          showAssignObjective={data.previewOptions?.showAssignObjective}
          showSchedule={data.previewOptions?.showSchedule}
          showOrderControls={data.previewOptions?.showOrderControls}
        />
      );
    }

    const previewStyle = {
      ...(presentation?.width ? { width: `${presentation.width}px` } : {}),
      ...(
        presentation?.offsetX || presentation?.offsetY
          ? {
              transform: `translate3d(${presentation.offsetX || 0}px, ${presentation.offsetY || 0}px, 0)`,
            }
          : {}
      ),
    };

    return (
      <div
        className={`dnd-transform-preview dnd-transform-preview-${previewKind}`}
        data-preview-presentation={previewKind}
        style={Object.keys(previewStyle).length ? previewStyle : undefined}
      >
        {content}
      </div>
    );
  }

  if (data.kind === "collection-item") {
    if (data.preview?.type === "subtask") {
      return <div className="subtask-drag-preview">{data.itemSnapshot.title}</div>;
    }
    if (data.preview?.type === "area") {
      return (
        <div className="area-navigation-group area-drag-preview">
          <div className="nav-item area-item">
            <Folder
              className="folder-menu-icon"
              size={15}
              weight="fill"
              style={{ color: data.itemSnapshot.color }}
            />
            <span>{data.itemSnapshot.label}</span>
          </div>
          {data.preview.projects?.length ? (
            <div className="area-project-list">
              {data.preview.projects.map((project) => (
                <div className="nav-item project-item" key={project.id}>
                  <PushPin mirrored
                    size={14}
                    weight="regular"
                    style={{ color: data.itemSnapshot.color }}
                  />
                  <span>{project.title}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    if (data.preview?.type === "objective") {
      return (
        <WeeklyObjectiveCard
          objective={data.itemSnapshot}
          dragPreview
          showThisWeekLabel={data.preview.showThisWeekLabel}
        />
      );
    }
    if (data.preview?.type === "backlog") {
      return (
        <BacklogTaskRow
          item={data.itemSnapshot}
          variant={data.preview.variant}
          dragPreview
        />
      );
    }
    if (data.preview?.type === "task") {
      return (
        <TaskCard
          task={data.itemSnapshot}
          compact={data.preview.options?.compact}
          dragPreview
          showAssignObjective={data.preview.options?.showAssignObjective}
          showSchedule={data.preview.options?.showSchedule}
          showOrderControls={data.preview.options?.showOrderControls}
        />
      );
    }
  }

  if (!data.taskSnapshot) return null;

  return (
    <TaskCard
      task={data.taskSnapshot}
      compact={data.previewOptions?.compact}
      dragPreview
      showAssignObjective={data.previewOptions?.showAssignObjective}
      showSchedule={data.previewOptions?.showSchedule}
      showOrderControls={data.previewOptions?.showOrderControls}
    />
  );
}

export function App() {
  const [accomplishedObjectives] = useWorkspaceState("weekly.accomplishedObjectives", []);
  const [areas, setAreas] = useWorkspaceState("areas", DEFAULT_AREAS);
  const [view, setView] = useWorkspaceState("view", "home");
  const [dailyCompletedDate, setDailyCompletedDate] = useWorkspaceState("daily.completedDate", null);
  const [weeklyCompletedWeek] = useWorkspaceState("weekly.completedWeek", null);
  const [planningStep, setPlanningStep] = useWorkspaceState("planningStep", 0);
  const [weeklyStep, setWeeklyStep] = useWorkspaceState("weeklyStep", 0);
  const [tasks, setTasks] = useWorkspaceState("tasks", () => completedTasksLast(DEFAULT_TASKS));
  const [datedTasksByDate, setDatedTasksByDate] = useWorkspaceState("datedTasksByDate", initialDatedTasks);
  const [backlogGroups, setBacklogGroups] = useWorkspaceState("backlogGroups", DEFAULT_BACKLOG_GROUPS);
  const [weeklyObjectives, setWeeklyObjectives] = useWorkspaceState("weeklyObjectives", DEFAULT_PROJECTS);
  const [archivedAreas, setArchivedAreas] = useWorkspaceState("archivedAreas", []);
  const [archivedObjectives, setArchivedObjectives] = useWorkspaceState("archivedObjectives", []);
  const [weeklyObjectiveOrder, setWeeklyObjectiveOrder] = useWorkspaceState("weeklyObjectiveOrder", () => (
    DEFAULT_PROJECTS
      .filter((objective) => objective.focusedThisWeek !== false)
      .map((objective) => objective.id)
  ));
  const [taskScope, setTaskScope] = useWorkspaceState("taskScope", "anytime");
  const [events, setEvents] = useWorkspaceState("events", DEFAULT_EVENTS);
  const [addingTask, setAddingTask] = useState(null);
  const [activeAreaId, setActiveAreaId] = useState(null);
  const [activeObjectiveId, setActiveObjectiveId] = useState(null);
  const [objectiveDetailsEntryMode, setObjectiveDetailsEntryMode] = useState("direct");
  const [objectiveDetailsParentTaskId, setObjectiveDetailsParentTaskId] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [taskDetailsEntryMode, setTaskDetailsEntryMode] = useState("direct");
  const [taskDetailsParentObjectiveId, setTaskDetailsParentObjectiveId] = useState(null);
  const [pendingScheduleDrop, setPendingScheduleDrop] = useState(null);
  // Keep the original callback contract without prototype-only action notices.
  const setToast = useCallback(() => {}, []);
  const [autoScheduleRequest, setAutoScheduleRequest] = useState(null);
  const finishAutoSchedule = useCallback((request) => {
    setAutoScheduleRequest((current) => current === request ? null : current);
  }, []);
  const [recurrenceDefinitions, setRecurrenceDefinitions] = useWorkspaceState("recurrenceDefinitions", {});
  const [, setRecurrenceProgress] = useWorkspaceState("recurrenceProgress", {});
  const [recurrenceStops, setRecurrenceStops] = useWorkspaceState("recurrenceStops", {});
  const [taskDeletionUndo, setTaskDeletionUndo] = useState(null);
  const [projectActionUndo, setProjectActionUndo] = useState(null);
  const [taskAreaUndo, setTaskAreaUndo] = useState(null);
  const taskAreaRevisionRef = useRef(0);
  const [dragPreviewPresentation, setDragPreviewPresentation] = useState(null);
  const [navigationOpen, setNavigationOpen] = useWorkspaceState("navigationOpen", true);
  const [homeWeekStartRequest, setHomeWeekStartRequest] = useState(0);
  const [homeTodayFocusRequest, setHomeTodayFocusRequest] = useState(0);
  const [rightPanelOpenByPage, setRightPanelOpenByPage] = useWorkspaceState("rightPanelOpenByPage", {
    home: true,
    today: true,
    planning: true,
    backlog: true,
    weekly: true,
  });
  const [rightPanes, setRightPanes] = useWorkspaceState("rightPanes", {
    home: "calendar",
    today: "calendar",
    planning: "calendar",
    backlog: "board",
    weekly: "objectives",
  });
  const boardStateRef = useRef({ tasks, datedTasksByDate });
  const dragSessionRef = useRef(null);
  const lastBoardProjectionRef = useRef("");
  const boardInsertionPreviewRef = useRef(null);
  const boardInsertionPreviewCleanupRef = useRef(null);
  const postDragClickGuardRef = useRef(null);
  const areaDetailsReturnFocusRef = useRef(null);
  const objectiveDetailsReturnFocusRef = useRef(null);
  const objectiveDetailsScrollTopRef = useRef(0);
  const objectiveDetailsTaskFocusIdRef = useRef(null);
  const objectiveDetailsParentTaskEntryModeRef = useRef("direct");
  const objectiveDetailsParentTaskObjectiveIdRef = useRef(null);
  const taskDetailsReturnFocusRef = useRef(null);
  const taskDeletionRevisionRef = useRef(0);
  const projectActionRevisionRef = useRef(0);
  boardStateRef.current = { tasks, datedTasksByDate };
  const weeklyFocusedObjectives = useMemo(() => {
    const orderIndex = new Map(
      weeklyObjectiveOrder.map((objectiveId, index) => [objectiveId, index]),
    );
    return weeklyObjectives
      .filter((objective) => objective.focusedThisWeek !== false)
      .sort((first, second) => (
        (orderIndex.get(first.id) ?? Number.MAX_SAFE_INTEGER)
        - (orderIndex.get(second.id) ?? Number.MAX_SAFE_INTEGER)
      ));
  }, [weeklyObjectiveOrder, weeklyObjectives]);
  const updateWeeklyFocusedObjectives = useCallback((updater) => {
    const nextFocusedObjectives = typeof updater === "function"
      ? updater(weeklyFocusedObjectives)
      : updater;
    setWeeklyObjectiveOrder(nextFocusedObjectives.map((objective) => objective.id));
  }, [weeklyFocusedObjectives]);
  const rightPanelUnavailableTaskIds = useMemo(() => Array.from(new Set([
    ...tasks,
    ...Object.values(datedTasksByDate).flat(),
    ...events,
  ].map((item) => item.id))), [datedTasksByDate, events, tasks]);
  const scheduledBacklogTasks = useMemo(() => nextScheduledOccurrences(
    upcomingScheduledTasks(
      tasks,
      datedTasksByDate,
      CURRENT_DATE_KEY,
    ),
  ), [datedTasksByDate, tasks]);
  const weeklyCompletedDays = previousWeekDays(CURRENT_DATE_KEY).map((day) => ({
    ...day,
    tasks: datedTasksByDate[day.dateKey] || [],
  }));
  const setWeeklyCompletedDays = (updater) => {
    setDatedTasksByDate((current) => {
      const currentDays = previousWeekDays(CURRENT_DATE_KEY).map((day) => ({
        ...day,
        tasks: current[day.dateKey] || [],
      }));
      const nextDays = typeof updater === "function"
        ? updater(currentDays)
        : updater;
      const nextDatedTasks = { ...current };
      nextDays.forEach((day) => {
        nextDatedTasks[day.dateKey] = day.tasks;
      });
      return nextDatedTasks;
    });
  };

  const activeTitle = useMemo(() => {
    if (view === "backlog") {
      if (taskScope.startsWith("project:")) {
        const id = taskScope.slice("project:".length);
        return weeklyObjectives.find((objective) => objective.id === id)?.title || "Project";
      }
      if (taskScope.startsWith("area:")) {
        const id = taskScope.slice("area:".length);
        return areas.find((area) => area.id === id)?.label || "Area";
      }
      return taskScope === "scheduled"
        ? "Scheduled"
        : taskScope === "someday"
          ? "Someday"
          : "Anytime";
    }

    return {
      home: "Home",
      today: "Today",
      planning: "Daily planning",
      "weekly-planning": "Weekly planning",
    }[view] || "Ritua";
  }, [areas, taskScope, view, weeklyObjectives]);
  const rightPaneKey = view === "today"
    ? "today"
    : view === "planning"
      ? "planning"
      : view === "weekly-planning"
        ? "weekly"
      : view === "backlog"
        ? "backlog"
        : "home";
  const rightPanelOpen = rightPanelOpenByPage[rightPaneKey] ?? true;
  const updateRightPanelOpen = useCallback((nextOpen) => {
    setRightPanelOpenByPage((current) => ({
      ...current,
      [rightPaneKey]: typeof nextOpen === "function"
        ? nextOpen(current[rightPaneKey] ?? true)
        : nextOpen,
    }));
  }, [rightPaneKey]);
  const updateNavigationOpen = useCallback((nextOpen) => {
    if (view === "home") {
      updateRightPanelOpen(nextOpen);
      if (nextOpen) {
        setHomeTodayFocusRequest((current) => current + 1);
      } else {
        setHomeWeekStartRequest((current) => current + 1);
      }
    }
    setNavigationOpen(nextOpen);
  }, [updateRightPanelOpen, view]);
  const handleToggleNavigation = useCallback(() => {
    updateNavigationOpen(!navigationOpen);
  }, [navigationOpen, updateNavigationOpen]);
  const rightPanelAvailable = (
    view === "home"
    || view === "today"
    || view === "backlog"
    || (view === "planning" && planningStep > 0 && planningStep < 4)
    || (view === "weekly-planning" && weeklyStep > 1)
  );
  const activeRightPane = rightPanes[rightPaneKey];
  useEffect(() => {
    if (autoScheduleRequest && autoScheduleRequest.pageKey !== rightPaneKey) {
      finishAutoSchedule(autoScheduleRequest);
    }
  }, [autoScheduleRequest, finishAutoSchedule, rightPaneKey]);
  const activeObjective = useMemo(() => (
    weeklyObjectives.find((objective) => objective.id === activeObjectiveId) || null
  ), [activeObjectiveId, weeklyObjectives]);
  const activeAreaDetails = useMemo(() => (
    areas.find((area) => area.id === activeAreaId) || null
  ), [activeAreaId, areas]);
  const activeTask = useMemo(() => (
    tasks.find((task) => task.id === activeTaskId)
    || Object.values(datedTasksByDate)
      .flat()
      .find((task) => task.id === activeTaskId)
    || (() => {
      const backlogTask = backlogGroups
        .flatMap((group) => group.items)
        .find((task) => task.id === activeTaskId);
      return backlogTask ? backlogTaskDetailsAdapter(backlogTask, areas) : null;
    })()
    || null
  ), [activeTaskId, areas, backlogGroups, datedTasksByDate, tasks]);
  const activeTaskDateKey = useMemo(() => {
    if (!activeTaskId) return null;
    const boardDateKey = findTaskDateKey({ tasks, datedTasksByDate }, activeTaskId);
    if (boardDateKey) return boardDateKey;
    const isBacklogTask = backlogGroups.some((group) => (
      group.items.some((task) => task.id === activeTaskId)
    ));
    return isBacklogTask ? CURRENT_DATE_KEY : null;
  }, [activeTaskId, backlogGroups, datedTasksByDate, tasks]);
  const activeTaskEvent = useMemo(() => (
    events.find((calendarEvent) => (
      calendarEvent.id === activeTaskId
      && (calendarEvent.dateKey || CURRENT_DATE_KEY) === activeTaskDateKey
    ))
    || events.find((calendarEvent) => calendarEvent.id === activeTaskId)
    || null
  ), [activeTaskDateKey, activeTaskId, events]);
  const activeTaskObjective = useMemo(() => (
    weeklyObjectives.find((objective) => objective.id === activeTask?.objectiveId)
    || accomplishedObjectives.find(
      (objective) => objective.id === activeTask?.objectiveId,
    )
    || null
  ), [activeTask, weeklyObjectives, accomplishedObjectives]);
  const taskLayoutRevision = useMemo(() => {
    const completionRevision = [
      ...tasks,
      ...Object.values(datedTasksByDate).flat(),
      ...backlogGroups.flatMap((group) => group.items),
      ...weeklyObjectives.flatMap((objective) => objective.tasks || []),
    ].map((task) => (
      `${task.taskId || task.id}:${task.complete ? 1 : 0}`
    )).join("|");

    return [
      view,
      taskScope,
      activeRightPane,
      activeObjectiveId || "",
      activeTaskId || "",
      planningStep,
      weeklyStep,
      navigationOpen ? 1 : 0,
      rightPanelOpen ? 1 : 0,
      completionRevision,
    ].join("::");
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
  ]);
  const openTaskDetails = useCallback((task, returnFocusElement) => {
    taskDetailsReturnFocusRef.current = returnFocusElement || document.activeElement;
    setAddingTask(null);
    setTaskDetailsEntryMode("direct");
    setTaskDetailsParentObjectiveId(null);
    setObjectiveDetailsParentTaskId(null);
    setActiveObjectiveId(null);
    setActiveTaskId(task.id);
  }, []);
  const openAreaDetails = useCallback((area, returnFocusElement) => {
    areaDetailsReturnFocusRef.current = returnFocusElement || document.activeElement;
    setAddingTask(null);
    setActiveTaskId(null);
    setActiveObjectiveId(null);
    setActiveAreaId(area.id);
  }, []);
  const closeAreaDetails = useCallback(() => {
    setActiveAreaId(null);
  }, []);
  const closeTaskDetails = useCallback(() => {
    if (taskDetailsParentObjectiveId && weeklyObjectives.some(
      (objective) => objective.id === taskDetailsParentObjectiveId,
    )) {
      setObjectiveDetailsEntryMode("from-task");
      setActiveTaskId(null);
      setActiveObjectiveId(taskDetailsParentObjectiveId);
      setTaskDetailsParentObjectiveId(null);
      return;
    }

    setActiveTaskId(null);
    setTaskDetailsParentObjectiveId(null);
  }, [taskDetailsParentObjectiveId, weeklyObjectives]);
  const openObjectiveDetails = useCallback((objective, returnFocusElement) => {
    objectiveDetailsReturnFocusRef.current = returnFocusElement || document.activeElement;
    objectiveDetailsScrollTopRef.current = 0;
    objectiveDetailsTaskFocusIdRef.current = null;
    setAddingTask(null);
    setObjectiveDetailsEntryMode("direct");
    setObjectiveDetailsParentTaskId(null);
    setTaskDetailsParentObjectiveId(null);
    setActiveTaskId(null);
    setActiveObjectiveId(objective.id);
  }, []);
  const closeObjectiveDetails = useCallback(() => {
    const parentTaskId = objectiveDetailsParentTaskId;
    const parentTaskEntryMode = objectiveDetailsParentTaskEntryModeRef.current;
    const parentTaskObjectiveId = objectiveDetailsParentTaskObjectiveIdRef.current;
    objectiveDetailsScrollTopRef.current = 0;
    objectiveDetailsTaskFocusIdRef.current = null;
    objectiveDetailsParentTaskEntryModeRef.current = "direct";
    objectiveDetailsParentTaskObjectiveIdRef.current = null;
    setActiveObjectiveId(null);
    setObjectiveDetailsParentTaskId(null);
    if (!parentTaskId) return;

    setTaskDetailsEntryMode(parentTaskEntryMode);
    setTaskDetailsParentObjectiveId(parentTaskObjectiveId);
    setActiveTaskId(parentTaskId);
  }, [objectiveDetailsParentTaskId]);
  const openObjectiveTaskDetails = useCallback((task, returnFocusElement, scrollTop) => {
    if (!activeObjective || !task?.id) return;

    taskDetailsReturnFocusRef.current = returnFocusElement || document.activeElement;
    objectiveDetailsScrollTopRef.current = scrollTop;
    objectiveDetailsTaskFocusIdRef.current = task.id;
    setAddingTask(null);
    setTaskDetailsEntryMode("from-project");
    setTaskDetailsParentObjectiveId(activeObjective.id);
    setActiveObjectiveId(null);
    setActiveTaskId(task.id);
  }, [activeObjective]);
  const openActiveTaskObjectiveDetails = useCallback((returnFocusElement, { taskDeleted = false } = {}) => {
    if (!activeTask?.id || !activeTaskObjective || !weeklyObjectives.some(
      (objective) => objective.id === activeTaskObjective.id,
    )) return;

    const returningToParent = taskDetailsParentObjectiveId === activeTaskObjective.id;
    objectiveDetailsReturnFocusRef.current = returnFocusElement || document.activeElement;
    if (!returningToParent) {
      objectiveDetailsScrollTopRef.current = 0;
      objectiveDetailsTaskFocusIdRef.current = null;
    }
    objectiveDetailsParentTaskEntryModeRef.current = taskDetailsEntryMode;
    objectiveDetailsParentTaskObjectiveIdRef.current = taskDetailsParentObjectiveId;
    setAddingTask(null);
    setObjectiveDetailsEntryMode("from-task");
    setObjectiveDetailsParentTaskId(taskDeleted ? null : activeTask.id);
    setTaskDetailsParentObjectiveId(null);
    setActiveTaskId(null);
    setActiveObjectiveId(activeTaskObjective.id);
  }, [
    activeTask,
    activeTaskObjective,
    taskDetailsEntryMode,
    taskDetailsParentObjectiveId,
    weeklyObjectives,
  ]);
  const selectRightPane = (pane) => {
    setRightPanes((current) => ({ ...current, [rightPaneKey]: pane }));
  };
  const handleAppContentClickCapture = (event) => {
    if (!rightPanelOpen && event.target.closest?.(".rail-button")) {
      updateRightPanelOpen(true);
    }
  };

  const navigate = (nextView) => {
    if (nextView === "weekly-planning") {
      setView("weekly-planning");
      setWeeklyStep(0);
      return;
    }
    setView(nextView);
    if (nextView === "planning") setPlanningStep(0);
  };

  const openTaskScope = (scope) => {
    setTaskScope(scope);
    setView("backlog");
  };

  const createAreaProject = (area, title) => {
    setWeeklyObjectives((items) => [
      ...items,
      {
        id: `objective-${Date.now()}`,
        title,
        channel: area.label,
        complete: false,
        focusedThisWeek: false,
        tasks: [],
      },
    ]);
    setToast(`${title} added to ${area.label}.`);
  };

  const createArea = (nextLabel, requestedColorOption) => {
    const label = nextLabel.trim();
    if (!label) return null;
    const duplicateArea = areas.some((area) => (
      area.label.localeCompare(label, undefined, { sensitivity: "accent" }) === 0
    ));
    if (duplicateArea) {
      reportActionError(`An Area named ${label} already exists.`);
      return null;
    }

    const paletteEntry = AREA_COLOR_OPTIONS.find((option) => (
      option.id === requestedColorOption?.id
    )) || AREA_COLOR_OPTIONS[areas.length % AREA_COLOR_OPTIONS.length];
    const area = {
      id: areaIdFromLabel(label, areas),
      label,
      accent: paletteEntry.accent,
      color: paletteEntry.color,
    };
    setAreas((items) => [...items, area]);
    setTaskScope(`area:${area.id}`);
    setView("backlog");
    setToast(`${label} Area created.`);
    return area;
  };

  const moveArea = (move) => {
    setAreas((items) => reorderAreas(items, move));
  };

  const restoreAreaOrder = (snapshot) => {
    setAreas(snapshot);
  };

  const changeAreaColorFromDetails = (areaId, colorOption) => {
    const area = areas.find((item) => item.id === areaId);
    if (!area || !colorOption) return;
    setAreas((items) => items.map((item) => (
      item.id === areaId
        ? { ...item, accent: colorOption.accent, color: colorOption.color }
        : item
    )));
    setRecurrenceDefinitions(value => Object.fromEntries(Object.entries(value).map(([id, definition]) => [id, objectiveChannel(definition.task.channel) === area.label ? { ...definition, task: { ...definition.task, accent: colorOption.accent }, event: definition.event ? { ...definition.event, color: colorOption.accent } : null } : definition])));
    setToast(`${area.label} color changed to ${colorOption.label.toLowerCase()}.`);
  };

  const renameAreaFromDetails = (areaId, nextLabel) => {
    const area = areas.find((item) => item.id === areaId);
    const label = nextLabel.trim();
    if (!area || !label) return false;
    if (area.label === label) return true;
    const duplicateArea = areas.some((item) => (
      item.id !== areaId
      && item.label.localeCompare(label, undefined, { sensitivity: "accent" }) === 0
    ));
    if (duplicateArea) {
      reportActionError(`An Area named ${label} already exists.`);
      return false;
    }

    const previousLabel = area.label;
    const renameTaskChannel = (task) => (
      objectiveChannel(task.channel) === previousLabel
        ? { ...task, channel: label }
        : task
    );
    const renameObjectiveChannel = (objective) => (
      objectiveChannel(objective.channel) === previousLabel
        ? {
            ...objective,
            channel: label,
            tasks: objective.tasks?.map(renameTaskChannel),
          }
        : objective
    );

    setAreas((items) => items.map((item) => (
      item.id === areaId ? { ...item, label } : item
    )));
    setRecurrenceDefinitions(value => Object.fromEntries(Object.entries(value).map(([id, definition]) => [id, { ...definition, task: renameTaskChannel(definition.task) }])));
    setTasks((items) => items.map(renameTaskChannel));
    setDatedTasksByDate((current) => Object.fromEntries(
      Object.entries(current).map(([dateKey, dateTasks]) => [
        dateKey,
        dateTasks.map(renameTaskChannel),
      ]),
    ));
    setBacklogGroups((groups) => groups.map((group) => ({
      ...group,
      items: group.items.map(renameTaskChannel),
    })));
    setWeeklyObjectives((objectives) => objectives.map(renameObjectiveChannel));
    setArchivedObjectives((objectives) => objectives.map(renameObjectiveChannel));
    setToast(`${previousLabel} renamed to ${label}.`);
    return true;
  };

  const archiveAreaFromDetails = (areaId) => {
    const area = areas.find((item) => item.id === areaId);
    if (!area) return;
    const projectIds = new Set(weeklyObjectives.filter((objective) => (
      objectiveChannel(objective.channel) === area.label
    )).map((objective) => objective.id));

    setArchivedAreas(items => [...items.filter(entry => entry.area.id !== areaId), { area, position: areas.findIndex(item => item.id === areaId), archivedAt: new Date().toISOString() }]);
    setAreas((items) => items.filter((item) => item.id !== areaId));
    setTaskScope((currentScope) => {
      if (currentScope === `area:${areaId}`) return "anytime";
      if (
        currentScope.startsWith("project:")
        && projectIds.has(currentScope.slice("project:".length))
      ) return "anytime";
      return currentScope;
    });
    setActiveAreaId(null);
    setToast(`${area.label} archived.`);
  };

  const deleteAreaFromDetails = (areaId) => {
    const area = areas.find((item) => item.id === areaId);
    if (!area) return;
    const projectIds = new Set(weeklyObjectives.filter((objective) => (
      objectiveChannel(objective.channel) === area.label
    )).map((objective) => objective.id));
    setRecurrenceStops(value => ({ ...value, ...Object.fromEntries(Object.entries(recurrenceDefinitions).filter(([, definition]) => objectiveChannel(definition.task.channel) === area.label || projectIds.has(definition.task.objectiveId)).map(([id]) => [id, true])) }));
    const taskBelongsToArea = (task) => (
      objectiveChannel(task.channel) === area.label
      || projectIds.has(task.objectiveId)
    );
    const currentBoardState = boardStateRef.current;
    const removedTaskIds = new Set([
      ...currentBoardState.tasks,
      ...Object.values(currentBoardState.datedTasksByDate).flat(),
      ...backlogGroups.flatMap((group) => group.items),
    ].filter(taskBelongsToArea).map((task) => task.id));
    const inactiveTasks = [...archivedObjectives, ...(workspaceStore.getState().fields["weekly.accomplishedObjectives"] || [])].flatMap(project => (project.tasks || []).filter(task => taskBelongsToArea(task) || objectiveChannel(project.channel) === area.label));
    inactiveTasks.forEach(task => removedTaskIds.add(task.taskId || task.id));
    detachInactiveTaskReferences([...removedTaskIds]);
    const nextBoardState = {
      tasks: currentBoardState.tasks.filter((task) => !taskBelongsToArea(task)),
      datedTasksByDate: Object.fromEntries(
        Object.entries(currentBoardState.datedTasksByDate).map(([dateKey, dateTasks]) => [
          dateKey,
          dateTasks.filter((task) => !taskBelongsToArea(task)),
        ]),
      ),
    };

    boardStateRef.current = nextBoardState;
    setAreas((items) => items.filter((item) => item.id !== areaId));
    setTasks(nextBoardState.tasks);
    setDatedTasksByDate(nextBoardState.datedTasksByDate);
    setBacklogGroups((groups) => groups.map((group) => ({
      ...group,
      items: group.items.filter((task) => !taskBelongsToArea(task)),
    })));
    setWeeklyObjectives((objectives) => objectives.filter((objective) => (
      !projectIds.has(objective.id)
    )));
    setWeeklyObjectiveOrder((objectiveIds) => objectiveIds.filter((objectiveId) => (
      !projectIds.has(objectiveId)
    )));
    setEvents((items) => items.filter((calendarEvent) => (
      !removedTaskIds.has(calendarEvent.id)
    )));
    setPendingScheduleDrop((pendingDrop) => (
      pendingDrop && removedTaskIds.has(pendingDrop.taskId) ? null : pendingDrop
    ));
    setTaskScope((currentScope) => {
      if (currentScope === `area:${areaId}`) return "anytime";
      if (
        currentScope.startsWith("project:")
        && projectIds.has(currentScope.slice("project:".length))
      ) return "anytime";
      return currentScope;
    });
    setActiveAreaId(null);
    setToast(`${area.label} deleted.`);
  };

  const openAddTask = (context) => {
    setAddingTask(typeof context === "string"
      ? { dateKey: context }
      : {
          dateKey: CURRENT_DATE_KEY,
          ...(context && typeof context === "object" ? context : {}),
        });
  };

  const addTask = (
    { area, dateKey, minutes, objectiveId, recurrence, title },
    { prepend = false } = {},
  ) => {
    const seriesId = `task-${Date.now()}`;
    const occurrenceDateKeys = recurrenceDateKeys(
      dateKey,
      recurrence,
      addDays(dateKey > CURRENT_DATE_KEY ? dateKey : CURRENT_DATE_KEY, 365),
    );
    const recurring = occurrenceDateKeys.length > 1 || Boolean(
      recurrence?.frequency && recurrence.frequency !== "none",
    );
    const occurrences = occurrenceDateKeys.map((occurrenceDateKey, index) => ({
      dateKey: occurrenceDateKey,
      task: {
        id: recurring ? `${seriesId}-${index + 1}` : seriesId,
        title,
        minutes,
        time: null,
        channel: area,
        complete: false,
        accent: areaAccentForLabel(area, areas),
        ...(objectiveId ? { objectiveId } : {}),
        ...(recurring ? {
          recurrence,
          recurrenceIndex: index,
          recurrenceSeriesId: seriesId,
          recurrenceStartDateKey: dateKey,
        } : {}),
      },
    }));

    const todayOccurrence = occurrences.find((item) => item.dateKey === CURRENT_DATE_KEY);
    if (todayOccurrence) {
      setTasks((items) => prepend
        ? [todayOccurrence.task, ...items]
        : insertBeforeCompletedTasks(items, todayOccurrence.task));
    }
    setDatedTasksByDate((current) => {
      const next = { ...current };
      occurrences.forEach((occurrence) => {
        if (occurrence.dateKey === CURRENT_DATE_KEY) return;
        const dateTasks = next[occurrence.dateKey] || [];
        next[occurrence.dateKey] = prepend
          ? [occurrence.task, ...dateTasks]
          : insertBeforeCompletedTasks(dateTasks, occurrence.task);
      });
      return next;
    });
    if (objectiveId) {
      setWeeklyObjectives((items) => items.map((objective) => (
        objective.id === objectiveId
          ? {
              ...objective,
              tasks: [
                ...(objective.tasks || []),
                ...occurrences.map((occurrence) => ({
                  id: `objective-${occurrence.task.id}`,
                  taskId: occurrence.task.id,
                  title,
                  minutes,
                  complete: false,
                })),
              ],
            }
          : objective
      )));
    }
    setAddingTask(null);
    const dateLabel = dateFromKey(dateKey).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    setToast(recurring
      ? `${title} · ${recurrenceLabel(recurrence, dateKey)}.`
      : dateKey === CURRENT_DATE_KEY
        ? "Task added to today."
        : `Task added to ${dateLabel}.`);
    return occurrences[0]?.task.id;
  };

  const createBoardTask = ({ title, dateKey }) => addTask({
    area: areas[0]?.label || "Ritua",
    dateKey,
    minutes: 30,
    title,
  }, { prepend: true });

  const createCalendarSessionFromSelection = ({ dateKey, title, start, end }) => {
    const id = `session-${crypto.randomUUID()}`;
    replaceWorkspaceFields(createCalendarSession(workspaceStore.getState().fields, {
      id, title, dateKey, start, end,
    }));
    setToast("Session created.");
    return id;
  };

  const assignTaskToWeeklyObjective = (task, objectiveId) => {
    const channel = objectiveChannel(task.channel);
    const objective = objectiveId
      ? weeklyObjectives.find((item) => item.id === objectiveId)
      : null;

    if (
      objective
      && (objective.complete || objectiveChannel(objective.channel) !== channel)
    ) {
      reportActionError(`Choose an active project in ${channel}.`);
      return;
    }

    if ((task.objectiveId || null) === (objective?.id || null)) return;

    setTasks((items) => linkTaskInList(items, task.id, objective?.id));
    setDatedTasksByDate((current) => Object.fromEntries(
      Object.entries(current).map(([dateKey, dateTasks]) => [
        dateKey,
        linkTaskInList(dateTasks, task.id, objective?.id),
      ]),
    ));
    setBacklogGroups((current) => current.map((group) => ({
      ...group,
      items: linkTaskInList(group.items, task.id, objective?.id),
    })));
    setWeeklyObjectives((items) => items.map((item) => {
      const objectiveTasks = (item.tasks || []).filter((objectiveTask) => (
        objectiveTask.taskId !== task.id && objectiveTask.id !== task.id
      ));
      if (item.id !== objective?.id) {
        return objectiveTasks.length === (item.tasks || []).length
          ? item
          : { ...item, tasks: objectiveTasks };
      }

      return {
        ...item,
        tasks: [
          ...objectiveTasks,
          {
            id: `${objective.id}-${task.id}`,
            taskId: task.id,
            title: task.title,
            minutes: Number.isFinite(task.minutes) ? task.minutes : 30,
            complete: Boolean(task.complete),
          },
        ],
      };
    }));
    setToast(objective
      ? `${task.title} added to ${objective.title}.`
      : `${task.title} is no longer linked to a project.`);
  };

  const mutateTaskAcrossPools = (taskId, mutateTask) => {
    const mutateItems = (items) => items.map((task) => (
      task.id === taskId ? mutateTask(task) : task
    ));
    setTasks(mutateItems);
    setDatedTasksByDate((current) => Object.fromEntries(
      Object.entries(current).map(([dateKey, dateTasks]) => [
        dateKey,
        mutateItems(dateTasks),
      ]),
    ));
    setBacklogGroups((current) => current.map((group) => ({
      ...group,
      items: mutateItems(group.items),
    })));
  };

  const updateObjectiveTaskMirrors = (taskId, patch) => {
    setWeeklyObjectives((items) => {
      const orderedItems = patch.complete === undefined
        ? items
        : setTaskCompletionInObjectiveMirrors(items, taskId, patch.complete);

      return orderedItems.map((objective) => ({
        ...objective,
        tasks: objective.tasks?.map((task) => (
          task.taskId === taskId || task.id === taskId
            ? { ...task, ...patch }
            : task
        )),
      }));
    });
  };

  const completeUndatedTaskToday = (taskId, { activityEntry } = {}) => {
    const sourceTask = backlogGroups
      .flatMap((group) => group.items)
      .find((task) => task.id === taskId);
    if (!sourceTask || sourceTask.complete) return false;

    const minutes = Number.isFinite(sourceTask.minutes) && sourceTask.minutes > 0
      ? sourceTask.minutes
      : 15;
    const taskToComplete = activityEntry
      ? {
          ...sourceTask,
          activity: appendTaskActivity(sourceTask, activityEntry),
        }
      : sourceTask;
    const nextTasks = completeUndatedTaskInTasks(
      boardStateRef.current.tasks,
      taskToComplete,
    );

    boardStateRef.current = {
      ...boardStateRef.current,
      tasks: nextTasks,
    };
    setTasks(nextTasks);
    setBacklogGroups((groups) => groups.map((group) => ({
      ...group,
      items: group.items.filter((task) => task.id !== taskId),
    })));
    updateObjectiveTaskMirrors(taskId, { complete: true, minutes });
    setToast(`${sourceTask.title} completed today · ${minutesLabel(minutes)}.`);
    return true;
  };

  const updateObjectiveFromDetails = (objectiveId, patch) => {
    setWeeklyObjectives((items) => items.map((objective) => (
      objective.id === objectiveId ? { ...objective, ...patch } : objective
    )));

    if (patch.channel) {
      const linkedTaskIds = new Set([
        ...tasks,
        ...Object.values(datedTasksByDate).flat(),
        ...backlogGroups.flatMap((group) => group.items),
      ].filter((task) => task.objectiveId === objectiveId).map((task) => task.id));
      const updateLinkedTaskArea = (task) => (
        task.objectiveId === objectiveId
          ? {
              ...task,
              channel: patch.channel,
              ...(task.accent !== undefined
                ? { accent: areaAccentForLabel(patch.channel, areas) }
                : {}),
            }
          : task
      );

      setRecurrenceDefinitions(value => Object.fromEntries(Object.entries(value).map(([id, definition]) => [id, definition.task.objectiveId === objectiveId ? { ...definition, task: updateLinkedTaskArea(definition.task), event: definition.event ? { ...definition.event, color: areaAccentForLabel(patch.channel, areas) } : null } : definition])));
      setTasks((items) => items.map(updateLinkedTaskArea));
      setDatedTasksByDate((items) => Object.fromEntries(
        Object.entries(items).map(([dateKey, dateTasks]) => [
          dateKey,
          dateTasks.map(updateLinkedTaskArea),
        ]),
      ));
      setBacklogGroups((items) => items.map((group) => ({
        ...group,
        items: group.items.map(updateLinkedTaskArea),
      })));
      setEvents((items) => items.map((calendarEvent) => (
        linkedTaskIds.has(calendarEvent.id)
          ? {
              ...calendarEvent,
              color: areaAccentForLabel(patch.channel, areas),
            }
          : calendarEvent
      )));
    }
  };

  const addObjectiveCommentFromDetails = (objectiveId, text, attachment) => {
    const comment = {
      id: `project-comment-${Date.now()}`,
      text,
      attachment: attachment || null,
      authorName: profileActor(),
      time: "now",
    };

    setWeeklyObjectives((objectives) => objectives.map((objective) => (
      objective.id === objectiveId
        ? { ...objective, comments: [...(objective.comments || []), comment] }
        : objective
    )));
  };

  const toggleObjectiveFromDetails = (objectiveId) => {
    const objective = weeklyObjectives.find((item) => item.id === objectiveId);
    if (!objective) return;
    const complete = !objective.complete;
    setWeeklyObjectives((items) => items.map((objective) => (
      objective.id === objectiveId ? { ...objective, complete } : objective
    )));
    setToast(complete ? "Project completed." : "Project reopened.");
  };

  const removeObjectiveFromWeekFromDetails = (objectiveId) => {
    setWeeklyObjectives((items) => items.map((objective) => (
      objective.id === objectiveId
        ? { ...objective, focusedThisWeek: false }
        : objective
    )));
    setWeeklyObjectiveOrder((objectiveIds) => (
      objectiveIds.filter((id) => id !== objectiveId)
    ));
    setToast("Project removed from this week.");
  };

  const moveProjectOutOfActiveDetails = (objectiveId, action) => {
    const objectiveIndex = weeklyObjectives.findIndex((objective) => (
      objective.id === objectiveId
    ));
    if (objectiveIndex < 0) return;

    const objective = weeklyObjectives[objectiveIndex];
    const projectScope = `project:${objectiveId}`;
    const area = areas.find((candidate) => (
      candidate.label === objectiveChannel(objective.channel)
    ));
    const fallbackTaskScope = area ? `area:${area.id}` : "anytime";
    const linkedTaskIds = Array.from(new Set([
      ...boardStateRef.current.tasks,
      ...Object.values(boardStateRef.current.datedTasksByDate).flat(),
      ...backlogGroups.flatMap((group) => group.items),
    ].filter((task) => task.objectiveId === objectiveId).map((task) => task.id)));
    const linkedSeriesIds = Object.entries(recurrenceDefinitions).filter(([, definition]) => definition.task.objectiveId === objectiveId).map(([id]) => id);
    const unlinkProject = (task) => {
      if (task.objectiveId !== objectiveId) return task;
      const nextTask = { ...task };
      delete nextTask.objectiveId;
      return nextTask;
    };
    setRecurrenceDefinitions(value => Object.fromEntries(Object.entries(value).map(([id, definition]) => [id, { ...definition, task: unlinkProject(definition.task) }])));
    const currentBoardState = boardStateRef.current;
    const nextBoardState = {
      tasks: currentBoardState.tasks.map(unlinkProject),
      datedTasksByDate: Object.fromEntries(
        Object.entries(currentBoardState.datedTasksByDate).map(([dateKey, dateTasks]) => [
          dateKey,
          dateTasks.map(unlinkProject),
        ]),
      ),
    };

    boardStateRef.current = nextBoardState;
    setTasks(nextBoardState.tasks);
    setDatedTasksByDate(nextBoardState.datedTasksByDate);
    setBacklogGroups((groups) => groups.map((group) => ({
      ...group,
      items: group.items.map(unlinkProject),
    })));
    setWeeklyObjectives((objectives) => objectives.filter((item) => item.id !== objectiveId));
    setWeeklyObjectiveOrder((objectiveIds) => objectiveIds.filter((id) => id !== objectiveId));
    if (action === "archive") {
      setArchivedObjectives((objectives) => [
        ...objectives.filter((item) => item.id !== objectiveId),
        { ...objective, archivedSeriesIds: linkedSeriesIds, archiveWeeklyOrderIndex: weeklyObjectiveOrder.indexOf(objectiveId), archivePosition: objectiveIndex, archivedAt: new Date().toISOString() },
      ]);
    }
    if (taskScope === projectScope) setTaskScope(fallbackTaskScope);

    closeObjectiveDetails();
    projectActionRevisionRef.current += 1;
    setToast("");
    setTaskDeletionUndo(null);
    setTaskAreaUndo(null);
    setProjectActionUndo({
      action,
      fallbackTaskScope,
      id: projectActionRevisionRef.current,
      linkedTaskIds,
      linkedSeriesIds,
      message: action === "archive"
        ? `${objective.title} archived.`
        : `${objective.title} deleted.`,
      objectiveEntry: { index: objectiveIndex, item: objective },
      previousTaskScope: taskScope,
      weeklyOrderIndex: weeklyObjectiveOrder.indexOf(objectiveId),
    });
  };

  const undoProjectAction = () => {
    if (!projectActionUndo) return;

    const {
      action,
      fallbackTaskScope,
      linkedTaskIds,
      objectiveEntry,
      previousTaskScope,
      weeklyOrderIndex,
    } = projectActionUndo;
    const objectiveId = objectiveEntry.item.id;
    setRecurrenceDefinitions(value => Object.fromEntries(Object.entries(value).map(([id, definition]) => [id, projectActionUndo.linkedSeriesIds?.includes(id) && !definition.task.objectiveId ? { ...definition, task: { ...definition.task, objectiveId } } : definition])));
    const linkedTaskIdSet = new Set(linkedTaskIds);
    const restoreProjectLink = (task) => (
      linkedTaskIdSet.has(task.id) && !task.objectiveId
        ? { ...task, objectiveId }
        : task
    );
    const currentBoardState = boardStateRef.current;
    const restoredBoardState = {
      tasks: currentBoardState.tasks.map(restoreProjectLink),
      datedTasksByDate: Object.fromEntries(
        Object.entries(currentBoardState.datedTasksByDate).map(([dateKey, dateTasks]) => [
          dateKey,
          dateTasks.map(restoreProjectLink),
        ]),
      ),
    };

    boardStateRef.current = restoredBoardState;
    setTasks(restoredBoardState.tasks);
    setDatedTasksByDate(restoredBoardState.datedTasksByDate);
    setBacklogGroups((groups) => groups.map((group) => ({
      ...group,
      items: group.items.map(restoreProjectLink),
    })));
    setWeeklyObjectives((objectives) => restoreIndexedEntries(
      objectives,
      [objectiveEntry],
      objectiveIdentity,
    ));
    if (action === "archive") {
      setArchivedObjectives((objectives) => objectives.filter((item) => item.id !== objectiveId));
    }
    if (weeklyOrderIndex >= 0) {
      setWeeklyObjectiveOrder((objectiveIds) => {
        if (objectiveIds.includes(objectiveId)) return objectiveIds;
        const nextIds = [...objectiveIds];
        nextIds.splice(Math.min(weeklyOrderIndex, nextIds.length), 0, objectiveId);
        return nextIds;
      });
    }
    if (previousTaskScope === `project:${objectiveId}` && taskScope === fallbackTaskScope) {
      setTaskScope(previousTaskScope);
    }
    setProjectActionUndo(null);
  };

  const toggleObjectiveTaskFromDetails = (
    objectiveId,
    objectiveTaskId,
    canonicalTaskId,
  ) => {
    const objectiveTask = activeObjective?.tasks?.find((task) => (
      task.id === objectiveTaskId
      || task.taskId === canonicalTaskId
    ));
    const canonicalTask = canonicalTaskId
      ? tasks.find((task) => task.id === canonicalTaskId)
        || Object.values(datedTasksByDate)
          .flat()
          .find((task) => task.id === canonicalTaskId)
        || backlogGroups
          .flatMap((group) => group.items)
          .find((task) => task.id === canonicalTaskId)
      : null;
    const complete = !(canonicalTask?.complete ?? objectiveTask?.complete);

    if (
      complete
      && canonicalTaskId
      && completeUndatedTaskToday(canonicalTaskId)
    ) {
      return;
    }

    toggleTaskCompletion(canonicalTaskId || objectiveTask?.taskId || objectiveTaskId);

    setToast(complete ? "Project task completed." : "Project task reopened.");
  };

  const addObjectiveTaskFromDetails = (objectiveId, title) => {
    const objective = weeklyObjectives.find((item) => item.id === objectiveId);
    if (!objective || objective.complete) return;

    const taskId = `backlog-${Date.now()}`;
    const task = {
      id: taskId,
      title,
      channel: objective.channel,
      objectiveId,
      complete: false,
    };

    setBacklogGroups((groups) => groups.map((group) => (
      group.label === "Anytime"
        ? { ...group, items: insertBeforeCompletedTasks(group.items, task) }
        : group
    )));
    setWeeklyObjectives((items) => items.map((item) => (
      item.id === objectiveId
        ? {
            ...item,
            tasks: [
              ...(item.tasks || []),
              {
                id: `${item.id}-${taskId}`,
                taskId,
                title,
                minutes: 0,
                complete: false,
              },
            ],
          }
        : item
    )));
    setToast(`${title} added to Anytime.`);
  };

  const updateTaskFromDetails = (taskId, patch, { unlinkFromProject = false } = {}) => {
    const resolvedPatch = patch.channel
      ? {
          ...patch,
          accent: areaAccentForLabel(patch.channel, areas),
        }
      : patch;
    const noteActivity = patch.notes !== undefined ? noteEditedActivity() : null;

    mutateTaskAcrossPools(taskId, (task) => {
      let nextTask = applyTaskDetailsPatch(task, resolvedPatch);
      if (noteActivity && patch.notes !== task.notes) {
        const activity = taskActivityWithCreation(task);
        if (!isNoteEditedActivity(activity[activity.length - 1])) {
          nextTask = { ...nextTask, activity: [...activity, noteActivity] };
        }
      }
      if (!unlinkFromProject) return nextTask;
      const unlinkedTask = { ...nextTask };
      delete unlinkedTask.objectiveId;
      return unlinkedTask;
    });
    if (unlinkFromProject) {
      setWeeklyObjectives((items) => items.map((objective) => {
        const objectiveTasks = objective.tasks || [];
        const remainingTasks = objectiveTasks.filter((task) => (
          task.taskId !== taskId && task.id !== taskId
        ));
        return remainingTasks.length === objectiveTasks.length
          ? objective
          : { ...objective, tasks: remainingTasks };
      }));
    } else {
      updateObjectiveTaskMirrors(taskId, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.minutes !== undefined ? { minutes: patch.minutes } : {}),
        ...(patch.actualMinutes !== undefined ? { actualMinutes: patch.actualMinutes } : {}),
      });
    }

    if (
      patch.title !== undefined
      || patch.channel !== undefined
      || patch.minutes !== undefined
    ) {
      setEvents((items) => items.map((calendarEvent) => {
        if (calendarEvent.id !== taskId) return calendarEvent;
        return {
          ...calendarEvent,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.channel !== undefined
            ? { color: areaAccentForLabel(patch.channel, areas) }
            : {}),
          ...(patch.minutes !== undefined
            ? { end: calendarEvent.start + patch.minutes }
            : {}),
        };
      }));
    }
  };

  const findCanonicalTask = (taskId) => (
    boardStateRef.current.tasks.find((task) => task.id === taskId)
    || Object.values(boardStateRef.current.datedTasksByDate).flat().find((task) => task.id === taskId)
    || backlogGroups.flatMap((group) => group.items).find((task) => task.id === taskId)
  );

  const moveTaskToArea = (taskId, channel, { unlinkFromProject = false } = {}) => {
    const task = findCanonicalTask(taskId);
    const area = areas.find((item) => item.label === channel);
    if (!task || !area || objectiveChannel(task.channel) === channel) return;
    const project = weeklyObjectives.find((item) => item.id === task.objectiveId);
    const removesProject = Boolean(project && objectiveChannel(project.channel) !== channel);
    if (removesProject && !unlinkFromProject) return;

    const projectEntries = removesProject
      ? captureIndexedEntries(project.tasks || [], (item) => taskIdentity(item) === taskId)
      : [];
    updateTaskFromDetails(taskId, { channel }, { unlinkFromProject: removesProject });
    setToast("");
    setTaskDeletionUndo(null);
    setProjectActionUndo(null);
    taskAreaRevisionRef.current += 1;
    setTaskAreaUndo({
      id: taskAreaRevisionRef.current,
      task,
      channel,
      previousAreaId: areas.find((item) => item.label === objectiveChannel(task.channel))?.id,
      removedProjectId: removesProject ? project.id : null,
      projectEntries,
      message: `${task.title} moved to ${channel}.`,
    });
  };

  const undoTaskAreaMove = () => {
    if (!taskAreaUndo) return;
    const { task: previousTask, channel, previousAreaId, removedProjectId, projectEntries } = taskAreaUndo;
    const task = findCanonicalTask(previousTask.id);
    const previousArea = areas.find((item) => item.id === previousAreaId);
    const previousProject = weeklyObjectives.find((item) => item.id === removedProjectId);
    setTaskAreaUndo(null);
    // Restore ownership only while it still matches this move; keep later edits intact.
    if (!task || objectiveChannel(task.channel) !== channel
      || (task.objectiveId || null) !== (removedProjectId ? null : previousTask.objectiveId || null)
      || (removedProjectId && !previousProject)) return;
    const restoredChannel = previousArea?.label || previousTask.channel;
    if (previousProject && objectiveChannel(previousProject.channel) !== objectiveChannel(restoredChannel)) return;

    updateTaskFromDetails(task.id, { channel: restoredChannel });
    mutateTaskAcrossPools(task.id, (item) => {
      const restored = { ...item };
      if (previousTask.objectiveId) restored.objectiveId = previousTask.objectiveId;
      else delete restored.objectiveId;
      return restored;
    });
    if (removedProjectId) {
      setWeeklyObjectives((items) => items.map((project) => (
        project.id === removedProjectId ? {
          ...project,
          tasks: restoreIndexedEntries(project.tasks || [], projectEntries.map((entry) => ({
            ...entry,
            item: {
              ...entry.item,
              title: task.title,
              minutes: task.minutes,
              actualMinutes: task.actualMinutes,
              complete: task.complete,
            },
          })), taskIdentity),
        } : project
      )));
    }
    setToast("");
  };

  const updateTaskRecurrenceFromDetails = (taskId, recurrence) => {
    const current = boardStateRef.current;
    const entries = [
      ...current.tasks.map(task => ({ dateKey: CURRENT_DATE_KEY, task })),
      ...Object.entries(current.datedTasksByDate).flatMap(([dateKey, list]) => list.map(task => ({ dateKey, task }))),
    ];
    const selected = entries.find(entry => entry.task.id === taskId)
      || { dateKey: activeTaskDateKey || CURRENT_DATE_KEY, task: backlogGroups.flatMap(group => group.items).find(task => task.id === taskId) };
    if (!selected.task) return;
    const oldSeries = selected.task.recurrenceSeriesId;
    const start = selected.dateKey < CURRENT_DATE_KEY ? CURRENT_DATE_KEY : selected.dateKey;
    const future = entries.filter(entry => (oldSeries ? entry.task.recurrenceSeriesId === oldSeries : entry.task.id === taskId) && entry.dateKey >= start && !entry.task.complete);
    const recurring = recurrence?.frequency && recurrence.frequency !== "none";
    const seriesId = `${taskId}-${crypto.randomUUID()}`;
    const dates = recurring ? recurrenceDateKeys(start, recurrence, addDays(start, 365)) : (selected.dateKey >= CURRENT_DATE_KEY && !selected.task.complete ? [selected.dateKey] : []);
    const template = withoutTaskRecurrence(backlogTaskDetailsAdapter(selected.task, areas));
    const reused = new Set();
    const occurrences = dates.map((dateKey, index) => {
      if (entries.some(entry => entry.dateKey === dateKey && entry.task.complete && (oldSeries ? entry.task.recurrenceSeriesId === oldSeries : entry.task.id === taskId))) return null;
      const existing = future.find(entry => entry.dateKey === dateKey && !reused.has(entry.task.id));
      if (existing) reused.add(existing.task.id);
      const task = existing ? withoutTaskRecurrence(existing.task) : freshOccurrence(template);
      return { dateKey, task: { ...task, id: existing?.task.id || `${seriesId}-date-${dateKey}`, ...(recurring ? { recurrence, recurrenceSeriesId: seriesId, recurrenceStartDateKey: start, recurrenceIndex: index } : {}) } };
    }).filter(Boolean);
    // Keep individually edited future work even if the new rule no longer includes its date.
    const hasWork = task => task.recurrenceEdited || ["title", "minutes", "time", "channel", "objectiveId", "subtasks"].some(key => JSON.stringify(task[key]) !== JSON.stringify(template[key])) || task.notes || task.media?.length || task.comments?.length || task.actualMinutes || task.activity?.length || task.subtasks?.some(item => item.complete);
    future.filter(entry => !reused.has(entry.task.id) && hasWork(entry.task)).forEach(entry => occurrences.push({ ...entry, task: withoutTaskRecurrence(entry.task) }));
    const removed = new Set(future.map(entry => entry.task.id));
    if (!entries.some(entry => entry.task.id === taskId)) removed.add(taskId);
    const retainedIds = new Set(occurrences.map(entry => entry.task.id));
    detachInactiveTaskReferences([...removed].filter(id => !retainedIds.has(id)));
    if (oldSeries) setRecurrenceStops(value => ({ ...value, [oldSeries]: true }));
    if (recurring) {
      setRecurrenceDefinitions(value => ({ ...value, [seriesId]: { task: { ...freshOccurrence(template), recurrence, recurrenceSeriesId: seriesId, recurrenceStartDateKey: start, recurrenceIndex: 0 }, event: events.find(event => event.id === selected.task.id) || null } }));
      setRecurrenceProgress(value => ({ ...value, [seriesId]: addDays(start, 365) }));
    }
    const next = { tasks: current.tasks.filter(task => !removed.has(task.id)), datedTasksByDate: Object.fromEntries(Object.entries(current.datedTasksByDate).map(([key, list]) => [key, list.filter(task => !removed.has(task.id))])) };
    for (const occurrence of occurrences) {
      const list = tasksForDateKey(next, occurrence.dateKey);
      const updated = occurrence.task.time ? orderTasksByTime([...list, occurrence.task]) : insertBeforeCompletedTasks(list, occurrence.task);
      if (occurrence.dateKey === CURRENT_DATE_KEY) next.tasks = updated;
      else next.datedTasksByDate[occurrence.dateKey] = updated;
    }
    const originalEvents = new Map(events.map(event => [event.id, event]));
    const sourceEvent = originalEvents.get(selected.task.id);
    const nextEvents = workspaceStore.getState().fields.events.filter(event => !removed.has(event.id));
    for (const occurrence of occurrences) {
      const source = originalEvents.get(occurrence.task.id) || sourceEvent;
      if (!source || !occurrence.task.time) continue;
      const event = { ...source, id: occurrence.task.id, dateKey: occurrence.dateKey, title: occurrence.task.title, complete: Boolean(occurrence.task.complete) };
      delete event.recurrenceSeriesId;
      if (occurrence.task.recurrenceSeriesId) event.recurrenceSeriesId = occurrence.task.recurrenceSeriesId;
      nextEvents.push(event);
    }
    boardStateRef.current = next;
    setTasks(next.tasks); setDatedTasksByDate(next.datedTasksByDate);
    setBacklogGroups(groups => groups.map(group => ({ ...group, items: group.items.filter(task => !removed.has(task.id)) })));
    setEvents(nextEvents);
    setWeeklyObjectives(objectives => objectives.map(objective => ({ ...objective, tasks: [
      ...(objective.tasks || []).filter(task => !removed.has(task.taskId || task.id)),
      ...occurrences.filter(entry => entry.task.objectiveId === objective.id).map(({ task }) => ({ id: `objective-${task.id}`, taskId: task.id, title: task.title, minutes: task.minutes, complete: Boolean(task.complete) })),
    ] })));
    if (removed.has(taskId)) setActiveTaskId(occurrences.find(entry => entry.task.id === taskId)?.task.id || occurrences[0]?.task.id || null);
  };

  const toggleTaskFromDetails = (taskId) => {
    const complete = !activeTask?.complete;
    const activityEntry = {
      id: `activity-${Date.now()}`,
      label: `${profileActor()} marked this ${complete ? "complete" : "incomplete"}`,
      time: "now",
    };

    if (complete && completeUndatedTaskToday(taskId, { activityEntry })) return;

    toggleTaskCompletion(taskId);
    mutateTaskAcrossPools(taskId, (task) => ({
      ...task,
      activity: appendTaskActivity(task, activityEntry),
    }));
    setToast(complete ? "Task completed." : "Task reopened.");
  };

  const deleteTaskFromDetails = (taskId, scope = "single") => {
    const taskTitle = activeTask?.id === taskId ? activeTask.title : "Task";
    const currentBoardState = boardStateRef.current;
    const selectedSeriesId = activeTask?.id === taskId
      ? activeTask.recurrenceSeriesId
      : null;
    const selectedRecurrenceIndex = activeTask?.id === taskId
      ? activeTask.recurrenceIndex
      : null;
    const deleteFollowing = scope === "following" && selectedSeriesId;
    if (deleteFollowing) setRecurrenceStops(value => ({ ...value, [selectedSeriesId]: true }));
    const matchesDeletionScope = (task) => {
      if (!deleteFollowing) return task.id === taskId;
      if (task.recurrenceSeriesId !== selectedSeriesId) return false;
      if (!Number.isFinite(selectedRecurrenceIndex)) return task.id === taskId;
      return Number(task.recurrenceIndex) >= selectedRecurrenceIndex;
    };
    const deletedTaskIds = new Set([
      ...currentBoardState.tasks,
      ...Object.values(currentBoardState.datedTasksByDate).flat(),
      ...backlogGroups.flatMap((group) => group.items),
    ].filter(matchesDeletionScope).map((task) => task.id));
    deletedTaskIds.add(taskId);
    const matchesDeletedTaskId = (task) => deletedTaskIds.has(task.taskId || task.id);
    const inactiveReferences = detachInactiveTaskReferences([...deletedTaskIds]);
    const deletionSnapshot = {
      inactiveReferences,
      stoppedSeriesId: deleteFollowing ? selectedSeriesId : null,
      previousSeriesStop: recurrenceStops[selectedSeriesId],
      boardTaskEntries: captureIndexedEntries(
        currentBoardState.tasks,
        matchesDeletionScope,
      ),
      datedTaskEntries: Object.fromEntries(
        Object.entries(currentBoardState.datedTasksByDate)
          .map(([dateKey, dateTasks]) => [
            dateKey,
            captureIndexedEntries(dateTasks, matchesDeletionScope),
          ])
          .filter(([, entries]) => entries.length),
      ),
      backlogTaskEntries: backlogGroups
        .map((group) => ({
          groupId: group.id,
          entries: captureIndexedEntries(group.items, matchesDeletionScope),
        }))
        .filter(({ entries }) => entries.length),
      objectiveTaskEntries: weeklyObjectives
        .map((objective) => ({
          objectiveId: objective.id,
          entries: captureIndexedEntries(
            objective.tasks || [],
            matchesDeletedTaskId,
          ),
        }))
        .filter(({ entries }) => entries.length),
      eventEntries: captureIndexedEntries(
        events,
        (calendarEvent) => deletedTaskIds.has(calendarEvent.id),
      ),
      pendingScheduleDrop: deletedTaskIds.has(pendingScheduleDrop?.taskId)
        ? pendingScheduleDrop
        : null,
    };
    const nextBoardState = {
      tasks: currentBoardState.tasks.filter((task) => !matchesDeletionScope(task)),
      datedTasksByDate: Object.fromEntries(
        Object.entries(currentBoardState.datedTasksByDate).map(([dateKey, dateTasks]) => [
          dateKey,
          dateTasks.filter((task) => !matchesDeletionScope(task)),
        ]),
      ),
    };

    boardStateRef.current = nextBoardState;
    setTasks(nextBoardState.tasks);
    setDatedTasksByDate(nextBoardState.datedTasksByDate);
    setBacklogGroups((groups) => groups.map((group) => ({
      ...group,
      items: group.items.filter((task) => !matchesDeletionScope(task)),
    })));
    setWeeklyObjectives((objectives) => objectives.map((objective) => ({
      ...objective,
      tasks: objective.tasks?.filter((task) => !matchesDeletedTaskId(task)),
    })));
    setEvents((items) => items.filter((calendarEvent) => (
      !deletedTaskIds.has(calendarEvent.id)
    )));
    setPendingScheduleDrop((pendingDrop) => (
      deletedTaskIds.has(pendingDrop?.taskId) ? null : pendingDrop
    ));
    objectiveDetailsTaskFocusIdRef.current = null;
    closeTaskDetails();
    taskDeletionRevisionRef.current += 1;
    setToast("");
    setProjectActionUndo(null);
    setTaskAreaUndo(null);
    setTaskDeletionUndo({
      ...deletionSnapshot,
      id: taskDeletionRevisionRef.current,
      message: deleteFollowing
        ? `${taskTitle || "Task"} and following tasks deleted.`
        : `${taskTitle || "Task"} deleted.`,
    });
  };

  const undoTaskDeletion = () => {
    if (!taskDeletionUndo) return;
    undoInactiveTaskReferences(taskDeletionUndo.inactiveReferences || []);
    if (taskDeletionUndo.stoppedSeriesId) setRecurrenceStops(value => {
      const next = { ...value };
      if (taskDeletionUndo.previousSeriesStop === undefined) delete next[taskDeletionUndo.stoppedSeriesId];
      else next[taskDeletionUndo.stoppedSeriesId] = taskDeletionUndo.previousSeriesStop;
      return next;
    });

    const currentBoardState = boardStateRef.current;
    const restoredBoardState = {
      tasks: restoreIndexedEntries(
        currentBoardState.tasks,
        taskDeletionUndo.boardTaskEntries,
        taskIdentity,
      ),
      datedTasksByDate: { ...currentBoardState.datedTasksByDate },
    };
    Object.entries(taskDeletionUndo.datedTaskEntries).forEach(([dateKey, entries]) => {
      restoredBoardState.datedTasksByDate[dateKey] = restoreIndexedEntries(
        restoredBoardState.datedTasksByDate[dateKey] || [],
        entries,
        taskIdentity,
      );
    });

    boardStateRef.current = restoredBoardState;
    setTasks(restoredBoardState.tasks);
    setDatedTasksByDate(restoredBoardState.datedTasksByDate);
    setBacklogGroups((groups) => groups.map((group) => {
      const removedEntries = taskDeletionUndo.backlogTaskEntries.find(
        ({ groupId }) => groupId === group.id,
      )?.entries;
      return removedEntries
        ? {
            ...group,
            items: restoreIndexedEntries(group.items, removedEntries, taskIdentity),
          }
        : group;
    }));
    setWeeklyObjectives((objectives) => objectives.map((objective) => {
      const removedEntries = taskDeletionUndo.objectiveTaskEntries.find(
        ({ objectiveId }) => objectiveId === objective.id,
      )?.entries;
      return removedEntries
        ? {
            ...objective,
            tasks: restoreIndexedEntries(
              objective.tasks || [],
              removedEntries,
              taskIdentity,
            ),
          }
        : objective;
    }));
    setEvents((items) => restoreIndexedEntries(
      items,
      taskDeletionUndo.eventEntries,
      eventIdentity,
    ));
    if (taskDeletionUndo.pendingScheduleDrop) {
      setPendingScheduleDrop((pendingDrop) => (
        pendingDrop || taskDeletionUndo.pendingScheduleDrop
      ));
    }
    setTaskDeletionUndo(null);
  };

  const toggleScheduledTaskFromBacklog = toggleTaskCompletion;

  const toggleSubtaskFromDetails = (taskId, subtaskId) => {
    const subtask = activeTask?.subtasks?.find((item) => item.id === subtaskId);
    const complete = !subtask?.complete;
    const activityEntry = {
      id: `activity-${Date.now()}`,
      label: `${profileActor()} marked “${subtask?.title || "a subtask"}” ${complete ? "complete" : "incomplete"}`,
      time: "now",
    };
    const toggleItems = (items) => toggleSubtaskInTasks(items, taskId, subtaskId).map((task) => (
      task.id === taskId
        ? {
            ...task,
            activity: appendTaskActivity(task, activityEntry),
          }
        : task
    ));

    setTasks(toggleItems);
    setDatedTasksByDate((current) => Object.fromEntries(
      Object.entries(current).map(([dateKey, dateTasks]) => [
        dateKey,
        toggleItems(dateTasks),
      ]),
    ));
    setBacklogGroups((items) => items.map((group) => ({
      ...group,
      items: toggleItems(group.items),
    })));
  };

  const updateSubtaskFromDetails = (taskId, subtaskId, patch) => {
    const removeSubtask = typeof patch.title === "string" && !patch.title.trim();
    mutateTaskAcrossPools(taskId, (task) => ({
      ...task,
      subtasks: removeSubtask
        ? task.subtasks?.filter((subtask) => subtask.id !== subtaskId)
        : task.subtasks?.map((subtask) => (
            subtask.id === subtaskId ? { ...subtask, ...patch } : subtask
          )),
    }));
  };

  const addSubtaskFromDetails = (
    taskId,
    { title, actualMinutes = null, minutes },
  ) => {
    const subtask = {
      id: `${taskId}-subtask-${Date.now()}`,
      title,
      minutes,
      actualMinutes,
      complete: false,
    };
    const activityEntry = {
      id: `activity-${Date.now()}-subtask`,
      label: `${profileActor()} added the subtask “${title}”`,
      time: "now",
    };

    mutateTaskAcrossPools(taskId, (task) => ({
      ...task,
      subtasks: [...(task.subtasks || []), subtask],
      activity: appendTaskActivity(task, activityEntry),
    }));
    setToast("Subtask added.");
  };

  const addCommentFromDetails = (taskId, text, attachment) => {
    const comment = {
      id: `comment-${Date.now()}`,
      text,
      attachment: attachment || null,
      authorName: profileActor(),
      time: "now",
    };
    const activityEntry = {
      id: `activity-${Date.now()}-comment`,
      label: `${profileActor()} commented`,
      time: "now",
    };

    mutateTaskAcrossPools(taskId, (task) => ({
      ...task,
      comments: [...(task.comments || []), comment],
      activity: appendTaskActivity(task, activityEntry),
    }));
  };

  const updateTaskTimingAcrossPools = (taskId, start, duration) => {
    const updater = (items) => updateTaskTiming(items, taskId, start, duration);
    setTasks(updater);
    setDatedTasksByDate((current) => Object.fromEntries(
      Object.entries(current).map(([dateKey, dateTasks]) => [dateKey, updater(dateTasks)]),
    ));
    setBacklogGroups((items) => items.map((group) => ({
      ...group,
      items: updater(group.items),
    })));
  };

  const moveBoardTask = ({
    taskId,
    sourceDateKey,
    targetDateKey,
    targetIndex,
    syncEventDate = true,
    visibleTaskIds,
  }) => {
    const currentBoardState = boardStateRef.current;
    const result = moveTaskBetweenDates({
      tasks: currentBoardState.tasks,
      datedTasksByDate: currentBoardState.datedTasksByDate,
      taskId,
      sourceDateKey,
      targetDateKey,
      targetIndex,
      visibleTaskIds,
    });

    if (!result.moved) return false;

    boardStateRef.current = {
      tasks: result.tasks,
      datedTasksByDate: result.datedTasksByDate,
    };
    setTasks(result.tasks);
    setDatedTasksByDate(result.datedTasksByDate);

    if (syncEventDate && sourceDateKey !== targetDateKey) {
      setEvents((items) => items.map((calendarEvent) => (
        calendarEvent.id === taskId
        && (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceDateKey
          ? { ...calendarEvent, dateKey: targetDateKey }
          : calendarEvent
      )));
    }

    return true;
  };

  const moveTaskObjectiveMirror = (task, targetObjectiveId, minutes) => {
    setWeeklyObjectives((objectives) => {
      const existingMirror = objectives
        .flatMap((objective) => objective.tasks || [])
        .find((objectiveTask) => (
          objectiveTask.taskId === task.id || objectiveTask.id === task.id
        ));
      const mirror = {
        ...(existingMirror || {
          id: `${targetObjectiveId || "standalone"}-${task.id}`,
          taskId: task.id,
        }),
        title: task.title,
        minutes,
        complete: Boolean(task.complete),
      };
      const withoutTask = objectives.map((objective) => ({
        ...objective,
        tasks: (objective.tasks || []).filter((objectiveTask) => (
          objectiveTask.taskId !== task.id && objectiveTask.id !== task.id
        )),
      }));
      if (!targetObjectiveId) return withoutTask;

      return withoutTask.map((objective) => (
        objective.id === targetObjectiveId
          ? { ...objective, tasks: [...(objective.tasks || []), mirror] }
          : objective
      ));
    });
  };

  const promoteBacklogTask = ({
    taskId,
    dateKey,
    targetIndex,
    start,
    end,
    taskSnapshot,
    destination,
  }) => {
    const sourceBacklogTask = backlogGroups
      .flatMap((group) => group.items)
      .find((task) => task.id === taskId)
      || taskSnapshot;
    if (!sourceBacklogTask || !dateKey) return false;

    const backlogTask = {
      ...sourceBacklogTask,
      ...(destination?.channel ? {
        channel: destination.channel,
        accent: areaAccentForLabel(destination.channel, areas),
      } : {}),
    };
    if (destination && destination.objectiveId) {
      backlogTask.objectiveId = destination.objectiveId;
    } else if (destination) {
      delete backlogTask.objectiveId;
    }

    const hasCalendarTime = Number.isFinite(start) && Number.isFinite(end);
    const duration = hasCalendarTime
      ? end - start
      : Math.max(backlogTask.minutes || 0, 30);
    const promotedTask = {
      ...backlogTaskDetailsAdapter(backlogTask, areas),
      minutes: duration,
      ...(hasCalendarTime ? {
        time: timeLabel(start),
        durationLabel: syncedDurationLabel(backlogTask, duration),
        activity: appendTaskActivity(backlogTask, {
          id: `activity-${Date.now()}-schedule`,
          label: `${profileActor()} updated the schedule`,
          time: "now",
        }),
      } : {}),
    };
    const currentBoardState = boardStateRef.current;
    const targetTasks = tasksForDateKey(currentBoardState, dateKey)
      .filter((item) => item.id !== taskId);
    const nextTargetTasks = hasCalendarTime
      ? orderTasksByTime([...targetTasks, promotedTask])
      : (() => {
          const insertionIndex = Math.max(
            0,
            Math.min(
              targetTasks.length,
              Number.isFinite(targetIndex) ? targetIndex : targetTasks.length,
            ),
          );
          return [
            ...targetTasks.slice(0, insertionIndex),
            promotedTask,
            ...targetTasks.slice(insertionIndex),
          ];
        })();
    const nextBoardState = dateKey === CURRENT_DATE_KEY
      ? { ...currentBoardState, tasks: nextTargetTasks }
      : {
          ...currentBoardState,
          datedTasksByDate: {
            ...currentBoardState.datedTasksByDate,
            [dateKey]: nextTargetTasks,
          },
        };

    boardStateRef.current = nextBoardState;
    setTasks(nextBoardState.tasks);
    setDatedTasksByDate(nextBoardState.datedTasksByDate);
    setBacklogGroups((items) => items.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id !== taskId),
    })));
    if (
      destination
      && (sourceBacklogTask.objectiveId || null) !== (destination.objectiveId || null)
    ) {
      moveTaskObjectiveMirror(
        backlogTask,
        destination.objectiveId || null,
        duration,
      );
    }
    updateObjectiveTaskMirrors(taskId, { minutes: duration });

    if (hasCalendarTime) {
      setEvents((items) => [
        ...items.filter((calendarEvent) => calendarEvent.id !== taskId),
        {
          id: taskId,
          dateKey,
          title: promotedTask.title || "Untitled task",
          start,
          end,
          color: promotedTask.accent,
          complete: Boolean(promotedTask.complete),
        },
      ]);
      setToast(`${promotedTask.title || "Task"} scheduled.`);
    } else {
      setToast(`${promotedTask.title || "Task"} added to the board.`);
    }

    return true;
  };

  const scheduleBacklogTaskFromDrop = (dateKey) => {
    const scheduleDrop = pendingScheduleDrop;
    if (!scheduleDrop || !dateKey) return;

    const targetProject = scheduleDrop.targetObjectiveId
      ? weeklyObjectives.find((objective) => objective.id === scheduleDrop.targetObjectiveId)
      : null;
    if (targetProject?.complete) {
      setPendingScheduleDrop(null);
      reportActionError("Reopen the Project before moving a Task into it.");
      return;
    }

    const promoted = promoteBacklogTask({
      taskId: scheduleDrop.taskId,
      dateKey,
      destination: {
        channel: targetProject?.channel || scheduleDrop.targetChannel || "Ritua",
        objectiveId: targetProject?.id || null,
      },
    });
    if (promoted) setPendingScheduleDrop(null);
  };

  const moveTaskToBacklog = ({
    taskId,
    targetData,
    insertAfter = false,
    taskSnapshot,
  }) => {
    if (!taskId || !targetData?.backlogDropTarget) return false;

    const currentBoardState = boardStateRef.current;
    const boardTask = currentBoardState.tasks.find((task) => task.id === taskId)
      || Object.values(currentBoardState.datedTasksByDate)
        .flat()
        .find((task) => task.id === taskId)
      || taskSnapshot;
    if (!boardTask) return false;

    const backlogTask = {
      ...boardTask,
      time: null,
      activity: appendTaskActivity(boardTask, {
        id: `activity-${Date.now()}-backlog`,
        label: `${profileActor()} moved this to ${targetData.backlogGroupLabel || "Anytime"}`,
        time: "now",
      }),
    };
    if (targetData.backlogContextual) {
      backlogTask.channel = targetData.backlogChannel || backlogTask.channel;
      if (targetData.backlogObjectiveId) {
        backlogTask.objectiveId = targetData.backlogObjectiveId;
      } else {
        delete backlogTask.objectiveId;
      }
    }

    const nextBoardState = {
      tasks: currentBoardState.tasks.filter((task) => task.id !== taskId),
      datedTasksByDate: Object.fromEntries(
        Object.entries(currentBoardState.datedTasksByDate).map(([dateKey, dateTasks]) => [
          dateKey,
          dateTasks.filter((task) => task.id !== taskId),
        ]),
      ),
    };
    boardStateRef.current = nextBoardState;
    setTasks(nextBoardState.tasks);
    setDatedTasksByDate(nextBoardState.datedTasksByDate);
    setEvents((items) => items.filter((calendarEvent) => calendarEvent.id !== taskId));

    const targetGroupLabel = targetData.backlogGroupLabel || "Anytime";
    const referenceItemId = targetData.itemId || targetData.referenceItemId;
    const shouldInsertAfter = targetData.kind === "collection-lane"
      ? targetData.insertAfterReference
      : insertAfter;
    setBacklogGroups((groups) => groups.map((group) => {
      const withoutTask = group.items.filter((task) => task.id !== taskId);
      if (group.label !== targetGroupLabel) {
        return { ...group, items: withoutTask };
      }

      const referenceIndex = referenceItemId
        ? withoutTask.findIndex((task) => task.id === referenceItemId)
        : -1;
      const insertionIndex = referenceIndex === -1
        ? withoutTask.length
        : referenceIndex + (shouldInsertAfter ? 1 : 0);
      return {
        ...group,
        items: [
          ...withoutTask.slice(0, insertionIndex),
          backlogTask,
          ...withoutTask.slice(insertionIndex),
        ],
      };
    }));
    setToast(`${backlogTask.title || "Task"} moved to ${targetGroupLabel}.`);
    return true;
  };

  const scheduleTaskFromDetails = (taskId, { dateKey, start, end }) => {
    const currentBoardState = boardStateRef.current;
    const sourceDateKey = findTaskDateKey(currentBoardState, taskId);
    const backlogTask = sourceDateKey
      ? null
      : backlogGroups
        .flatMap((group) => group.items)
        .find((task) => task.id === taskId);
    if (!sourceDateKey && !backlogTask) return;

    const duration = end - start;
    if (backlogTask) {
      promoteBacklogTask({ taskId, dateKey, start, end, taskSnapshot: backlogTask });
      return;
    }

    if (sourceDateKey !== dateKey) {
      moveBoardTask({
        taskId,
        sourceDateKey,
        targetDateKey: dateKey,
        targetIndex: tasksForDateKey(currentBoardState, dateKey).length,
        syncEventDate: false,
      });
    }

    const task = activeTask?.id === taskId
      ? activeTask
      : tasksForDateKey(boardStateRef.current, dateKey).find((item) => item.id === taskId);
    setEvents((items) => [
      ...items.filter((calendarEvent) => calendarEvent.id !== taskId),
      {
        id: taskId,
        dateKey,
        title: task?.title || "Untitled task",
        start,
        end,
        color: task?.accent || "violet",
        complete: Boolean(task?.complete),
      },
    ]);
    updateTaskTimingAcrossPools(taskId, start, duration);
    mutateTaskAcrossPools(taskId, (item) => ({
      ...item,
      activity: appendTaskActivity(item, {
        id: `activity-${Date.now()}-schedule`,
        label: `${profileActor()} updated the schedule`,
        time: "now",
      }),
    }));
    setToast(`${task?.title || "Task"} scheduled.`);
  };

  const scheduleTaskAtFirstAvailableTime = (task, requestedDateKey, source) => {
    if (autoScheduleRequest || task.time || task.complete) return;
    const dateKey = findTaskDateKey(boardStateRef.current, task.id) || requestedDateKey || CURRENT_DATE_KEY;
    const duration = task.minutes > 0 ? task.minutes : 30;
    const start = nextAvailableCalendarStart(events, duration, dateKey, { taskId: task.id });

    if (start === null) {
      reportActionError(`No ${minutesLabel(duration)} opening is available on this day.`);
      return;
    }

    const origin = captureScheduleOrigin(source);
    setAutoScheduleRequest({ taskId: task.id, dateKey, origin, pageKey: rightPaneKey });
    updateRightPanelOpen(true);
    selectRightPane("calendar");
    scheduleTaskFromDetails(task.id, {
      dateKey,
      start,
      end: start + duration,
    });
  };

  const removeTaskSchedule = (taskId, source) => {
    if (source && autoScheduleRequest) return;
    const calendarEvent = events.find((event) => event.id === taskId);
    if (source && calendarEvent) {
      setAutoScheduleRequest({
        kind: "unschedule",
        taskId,
        dateKey: calendarEvent.dateKey || CURRENT_DATE_KEY,
        calendarEvent,
        origin: captureScheduleOrigin(source),
        pageKey: rightPaneKey,
      });
      updateRightPanelOpen(true);
      selectRightPane("calendar");
    }
    setEvents((items) => items.filter((calendarEvent) => calendarEvent.id !== taskId));
    updateTaskTimingAcrossPools(taskId, null);
    mutateTaskAcrossPools(taskId, (task) => ({
      ...task,
      activity: appendTaskActivity(task, {
        id: `activity-${Date.now()}-unschedule`,
        label: `${profileActor()} removed this from the calendar`,
        time: "now",
      }),
    }));
    setToast("Task removed from the calendar.");
  };

  const restoreBoardSnapshot = () => {
    const snapshot = dragSessionRef.current?.boardSnapshot;
    if (!snapshot) return;

    boardStateRef.current = snapshot;
    setTasks(snapshot.tasks);
    setDatedTasksByDate(snapshot.datedTasksByDate);
  };

  const clearPostDragClickGuard = () => {
    const guard = postDragClickGuardRef.current;
    if (!guard) return;

    if (guard.timer && typeof window !== "undefined") {
      window.clearTimeout(guard.timer);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("click", guard.blockClick, true);
    }
    postDragClickGuardRef.current = null;
  };

  const armPostDragClickGuard = () => {
    clearPostDragClickGuard();
    if (typeof document === "undefined") return;

    const blockClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", blockClick, true);
    postDragClickGuardRef.current = { blockClick, timer: null };
  };

  const releasePostDragClickGuard = () => {
    const guard = postDragClickGuardRef.current;
    if (!guard) return;
    if (typeof window === "undefined") {
      clearPostDragClickGuard();
      return;
    }

    guard.timer = window.setTimeout(
      clearPostDragClickGuard,
      POST_DRAG_CLICK_GUARD_DURATION_MS,
    );
  };

  const resetBoardInsertionPreviewElements = (preview) => {
    const stack = preview?.stack;
    if (!stack) return;

    Array.from(stack.children).forEach((element) => {
      if (element.matches?.(".task-card[data-board-insertion-shift]")) {
        element.removeAttribute("data-board-insertion-shift");
      }
    });
    stack.classList.remove("board-external-insertion-preview");
    stack.style.removeProperty("--board-external-insertion-base-padding");
    stack.style.removeProperty("--board-external-insertion-size");
  };

  const cancelBoardInsertionPreviewCleanup = () => {
    const pendingCleanup = boardInsertionPreviewCleanupRef.current;
    if (!pendingCleanup) return;

    window.clearTimeout(pendingCleanup.timer);
    resetBoardInsertionPreviewElements(pendingCleanup.preview);
    boardInsertionPreviewCleanupRef.current = null;
  };

  const clearBoardInsertionPreview = ({ animate = false } = {}) => {
    const preview = boardInsertionPreviewRef.current;
    if (!preview) {
      if (!animate) cancelBoardInsertionPreviewCleanup();
      return;
    }
    boardInsertionPreviewRef.current = null;
    cancelBoardInsertionPreviewCleanup();

    if (!animate || typeof window === "undefined" || !preview.stack.isConnected) {
      resetBoardInsertionPreviewElements(preview);
      return;
    }

    preview.stack.style.setProperty("--board-external-insertion-size", "0px");
    const timer = window.setTimeout(() => {
      resetBoardInsertionPreviewElements(preview);
      if (boardInsertionPreviewCleanupRef.current?.timer === timer) {
        boardInsertionPreviewCleanupRef.current = null;
      }
    }, BOARD_INSERTION_PREVIEW_DURATION_MS);
    boardInsertionPreviewCleanupRef.current = { preview, timer };
  };

  const showBoardInsertionPreview = (target, pointer, sourceData) => {
    if (typeof document === "undefined" || !target?.element || !pointer) return false;
    const column = target.element.closest?.(
      '[data-board-drop-zone="true"][data-board-surface-id][data-date-key]',
    );
    const stack = column?.matches(".task-stack")
      ? column
      : column?.querySelector(".task-stack");
    if (!column || !stack) return false;

    const cards = Array.from(stack.children).filter((element) => (
      element.matches?.(".task-card[data-board-task-id]")
    ));
    let insertionIndex = cards.length;
    if (target.data?.kind === "board-task") {
      const targetCard = target.element.closest?.(".task-card[data-board-task-id]")
        || cards.find((card) => card.dataset.boardTaskId === target.data.taskId);
      const targetCardIndex = cards.indexOf(targetCard);
      if (targetCardIndex !== -1) {
        const targetRect = targetCard.getBoundingClientRect();
        insertionIndex = targetCardIndex + (
          pointer.y > targetRect.top + targetRect.height / 2 ? 1 : 0
        );
      }
    } else if (Number.isInteger(target.data?.insertionVisibleIndex)) {
      insertionIndex = target.data.insertionVisibleIndex;
    } else if (target.data?.insertionIndex === 0) {
      insertionIndex = 0;
    }

    insertionIndex = Math.max(0, Math.min(cards.length, insertionIndex));
    const previewCard = document.querySelector(
      '[data-preview-presentation="board"] .task-card',
    );
    const sourceHasSubtasks = Boolean(sourceData?.itemSnapshot?.subtasks?.length);
    const matchingCard = cards.find((card) => (
      card.classList.contains("has-subtasks") === sourceHasSubtasks
    ));
    const referenceHeight = previewCard?.getBoundingClientRect().height
      || (sourceHasSubtasks ? matchingCard?.getBoundingClientRect().height : 0)
      || BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT;
    const stackStyle = window.getComputedStyle(stack);
    const stackGap = Number.parseFloat(stackStyle.rowGap || stackStyle.gap) || 0;
    const insertionSize = Math.max(
      BOARD_INSERTION_PREVIEW_FALLBACK_HEIGHT,
      Math.ceil(referenceHeight + stackGap),
    );
    const previewKey = [
      column.dataset.boardSurfaceId,
      column.dataset.dateKey,
      insertionIndex,
      insertionSize,
    ].join(":");
    const currentPreview = boardInsertionPreviewRef.current;
    if (currentPreview?.key === previewKey) return true;

    cancelBoardInsertionPreviewCleanup();
    if (currentPreview && currentPreview.stack !== stack) {
      resetBoardInsertionPreviewElements(currentPreview);
    }

    if (!currentPreview || currentPreview.stack !== stack) {
      const basePadding = Number.parseFloat(stackStyle.paddingBottom) || 0;
      stack.style.setProperty(
        "--board-external-insertion-base-padding",
        `${basePadding}px`,
      );
      stack.classList.add("board-external-insertion-preview");
    }
    stack.style.setProperty(
      "--board-external-insertion-size",
      `${insertionSize}px`,
    );
    cards.forEach((card, index) => {
      if (index >= insertionIndex) {
        card.setAttribute("data-board-insertion-shift", "true");
      } else {
        card.removeAttribute("data-board-insertion-shift");
      }
    });
    boardInsertionPreviewRef.current = {
      key: previewKey,
      stack,
    };
    return true;
  };

  const projectBoardTask = (operation, pointerOverride, targetOverride) => {
    const sourceData = dragSessionRef.current?.sourceData || operation.source?.data;
    const target = targetOverride?.target || operation.target;
    const targetData = target?.data;

    if (
      sourceData?.kind !== "board-task"
      || (targetData?.kind !== "board-task" && targetData?.kind !== "board-column")
    ) {
      return false;
    }

    const currentBoardState = boardStateRef.current;
    const sourceDateKey = findTaskDateKey(currentBoardState, sourceData.taskId);
    const targetDateKey = targetData.dateKey;
    if (!sourceDateKey || !targetDateKey) return false;

    if (targetData.kind === "board-task" && targetData.taskId === sourceData.taskId) {
      return true;
    }

    const sourceDateTasks = tasksForDateKey(currentBoardState, sourceDateKey);
    const sourceIndex = sourceDateTasks.findIndex((task) => task.id === sourceData.taskId);
    if (sourceIndex === -1) return false;
    const pointer = pointerOverride
      || dragSessionRef.current?.pointer
      || operation.position.current;
    const targetRect = target.element?.getBoundingClientRect();
    if (!targetRect) return false;

    const isVisibleCardReorder = (
      targetData.kind === "board-task"
      && sourceDateKey === targetDateKey
      && Number.isInteger(targetData.visibleIndex)
      && Array.isArray(targetData.visibleTaskIds)
    );
    const sourceOrderIndex = isVisibleCardReorder
      ? targetData.visibleTaskIds.indexOf(sourceData.taskId)
      : sourceIndex;
    const targetOrderIndex = isVisibleCardReorder
      ? targetData.visibleIndex
      : targetData.index;
    const cardReorderDirection = targetData.kind === "board-task"
      && sourceDateKey === targetDateKey
      ? Math.sign(targetOrderIndex - sourceOrderIndex)
      : 0;
    const usesCardReorderThreshold = Boolean(
      cardReorderDirection && dragSessionRef.current?.grabOffset,
    );
    if (
      usesCardReorderThreshold
      && !crossedCardReorderThreshold(
        pointer,
        dragSessionRef.current,
        targetRect,
        cardReorderDirection,
      )
    ) return false;
    if (
      !targetOverride?.fromCardOverlap
      && !usesCardReorderThreshold
      && (
        pointer.x < targetRect.left
        || pointer.x > targetRect.right
        || pointer.y < targetRect.top
        || pointer.y > targetRect.bottom
      )
    ) return false;

    let targetIndex;
    let visibleTaskIds;
    let projectionPosition = "end";

    if (targetData.kind === "board-task") {
      const pointerInsideTarget = pointer.y >= targetRect.top
        && pointer.y <= targetRect.bottom;
      const verticalDirection = usesCardReorderThreshold
        ? cardReorderDirection
        : pointerInsideTarget
          ? dragSessionRef.current?.verticalDirection || 0
          : 0;
      const insertAfterTarget = verticalDirection === 0
        ? pointer.y > targetRect.top + targetRect.height / 2
        : verticalDirection > 0;
      projectionPosition = insertAfterTarget ? "after" : "before";
      const isVisibleSlotReorder = (
        sourceDateKey === targetDateKey
        && Number.isInteger(targetData.visibleIndex)
        && Array.isArray(targetData.visibleTaskIds)
      );
      const sourceSlotIndex = isVisibleSlotReorder
        ? targetData.visibleTaskIds.indexOf(sourceData.taskId)
        : sourceIndex;
      targetIndex = (
        isVisibleSlotReorder ? targetData.visibleIndex : targetData.index
      ) + (insertAfterTarget ? 1 : 0);

      if (sourceDateKey === targetDateKey && sourceSlotIndex < targetIndex) {
        targetIndex -= 1;
      }
      visibleTaskIds = isVisibleSlotReorder ? targetData.visibleTaskIds : undefined;
    } else {
      const isVisibleSlotReorder = (
        sourceDateKey === targetDateKey
        && Number.isInteger(targetData.insertionVisibleIndex)
        && Array.isArray(targetData.visibleTaskIds)
      );
      targetIndex = isVisibleSlotReorder
        ? targetData.insertionVisibleIndex
        : targetData.insertionIndex;
      visibleTaskIds = isVisibleSlotReorder ? targetData.visibleTaskIds : undefined;
    }

    const projectionKey = [
      target.id,
      targetDateKey,
      projectionPosition,
      targetIndex,
    ].join(":");
    if (lastBoardProjectionRef.current === projectionKey) return true;
    lastBoardProjectionRef.current = projectionKey;

    const moved = moveBoardTask({
      taskId: sourceData.taskId,
      sourceDateKey,
      targetDateKey,
      targetIndex,
      visibleTaskIds,
      syncEventDate: false,
    });
    if (moved && dragSessionRef.current) {
      dragSessionRef.current.projectedDateKey = targetDateKey;
      dragSessionRef.current.projectedBoardSurfaceId = (
        targetData.boardSurfaceId || sourceData.boardSurfaceId
      );
    }
    return true;
  };

  const restoreCollectionSnapshot = () => {
    const dragSession = dragSessionRef.current;
    const sourceData = dragSession?.sourceData;
    if (!sourceData?.onRestore || dragSession.collectionSnapshot === undefined) return;
    sourceData.onRestore(dragSession.collectionSnapshot);
  };

  const projectCollectionItem = (operation, pointerOverride, targetOverride) => {
    const dragSession = dragSessionRef.current;
    const sourceData = dragSession?.sourceData || operation.source?.data;
    const target = targetOverride?.target || operation.target;
    const targetData = target?.data;

    if (
      sourceData?.kind !== "collection-item"
      || (
        targetData?.kind !== "collection-item"
        && targetData?.kind !== "collection-lane"
      )
      || targetData.collectionId !== sourceData.collectionId
      || targetData.surfaceId !== sourceData.surfaceId
    ) {
      return false;
    }

    if (
      targetData.kind === "collection-item"
      && targetData.itemId === sourceData.itemId
    ) {
      return true;
    }

    const pointer = pointerOverride
      || dragSession?.pointer
      || operation.position.current;
    const sourceLaneId = dragSession.projectedCollectionLaneId
      || sourceData.sourceLaneId;
    const sourceIndex = Number.isInteger(dragSession.projectedCollectionIndex)
      ? dragSession.projectedCollectionIndex
      : sourceData.sourceIndex;
    const targetRect = target.element?.getBoundingClientRect();
    if (
      !targetRect
      || (
        !targetOverride?.fromItemOverlap
        && !targetOverride?.fromBoundaryThreshold
        && !targetOverride?.fromCardReorderThreshold
        && !targetOverride?.fromCollectionEdgeIntent
        && (
          pointer.x < targetRect.left
          || pointer.x > targetRect.right
          || pointer.y < targetRect.top
          || pointer.y > targetRect.bottom
        )
      )
    ) {
      return false;
    }

    const targetLaneId = targetData.laneId;
    let targetIndex;
    let projectionPosition = "end";

    if (targetData.kind === "collection-item") {
      const pointerInsideTarget = (
        pointer.y >= targetRect.top && pointer.y <= targetRect.bottom
      );
      const thresholdDirection = targetOverride?.fromCardReorderThreshold
        ? Math.sign(targetData.index - sourceIndex)
        : 0;
      const verticalDirection = thresholdDirection || (
        pointerInsideTarget ? dragSession.verticalDirection || 0 : 0
      );
      const insertAfterTarget = verticalDirection === 0
        ? pointer.y > targetRect.top + targetRect.height / 2
        : verticalDirection > 0;
      projectionPosition = insertAfterTarget ? "after" : "before";
      targetIndex = targetData.index + (insertAfterTarget ? 1 : 0);
      if (sourceLaneId === targetLaneId && sourceIndex < targetIndex) {
        targetIndex -= 1;
      }
    } else {
      targetIndex = targetData.insertionIndex;
    }

    const projectionKey = [
      "collection",
      sourceData.collectionId,
      target.id,
      targetLaneId,
      projectionPosition,
      targetIndex,
    ].join(":");
    if (lastBoardProjectionRef.current === projectionKey) return true;
    lastBoardProjectionRef.current = projectionKey;

    sourceData.onMove?.({
      itemId: sourceData.itemId,
      sourceLaneId,
      targetLaneId,
      targetIndex,
      targetData,
    });
    dragSession.projectedCollectionLaneId = targetLaneId;
    dragSession.projectedCollectionIndex = targetIndex;
    return true;
  };

  const updateDragPreviewPresentation = (sourceData, pointer) => {
    if (sourceData?.session) return;
    if (
      !sourceData
      || !(
        sourceData.backlogTask
        || sourceData.kind === "board-task"
        || sourceData.kind === "calendar-event"
      )
    ) return;

    const dragSession = dragSessionRef.current;
    const backlogTarget = backlogTargetAtPointer(pointer);
    const mainBacklogLane = Array.from(document.querySelectorAll(
      '[data-backlog-drop-zone="true"][data-collection-surface-id]',
    )).find((lane) => (
      isMainBacklogSurfaceId(lane.dataset.collectionSurfaceId)
    ));
    const rightPanel = document.querySelector(".right-panel");
    const pointerHasCrossedLeft = Boolean(
      mainBacklogLane
      && rightPanel
      && pointer?.x < rightPanel.getBoundingClientRect().left,
    );
    const boardTarget = boardPreviewTargetAtPointer(pointer);
    const isMainBacklogSource = Boolean(
      sourceData.backlogTask
      && isMainBacklogSurfaceId(sourceData.surfaceId),
    );
    const earlyRightPanelTarget = isMainBacklogSource
      ? visibleRightPanelTaskTarget()
      : null;
    const rightwardDistance = pointer && dragSession?.startPointer
      ? pointer.x - dragSession.startPointer.x
      : 0;
    if (isMainBacklogSource && earlyRightPanelTarget && dragSession) {
      dragSession.previewCardActive = dragSession.previewCardActive
        ? rightwardDistance > BACKLOG_CARD_PREVIEW_EXIT_DISTANCE
        : rightwardDistance >= BACKLOG_CARD_PREVIEW_ENTER_DISTANCE;
    }

    const cardPreviewPresentation = (target) => {
      const width = target?.width || dragSession?.sourceRect?.width;
      const sourceWidth = dragSession?.sourceRect?.width;
      const grabOffset = dragSession?.grabOffset;
      if (!width || !sourceWidth || !grabOffset) {
        return { kind: "board", width };
      }

      const proportionalGrabX = (grabOffset.x / sourceWidth) * width;
      const desiredGrabX = Math.max(24, Math.min(width - 24, proportionalGrabX));
      return {
        kind: "board",
        width,
        offsetX: Math.round(grabOffset.x - desiredGrabX),
        offsetY: Math.round(grabOffset.y - TASK_CARD_POINTER_TOP_OFFSET),
      };
    };

    let nextPresentation;
    if (
      sourceData.backlogTask
      && (boardTarget || dragSession?.previewCardActive)
    ) {
      nextPresentation = cardPreviewPresentation(boardTarget || earlyRightPanelTarget);
    } else if (backlogTarget || (pointerHasCrossedLeft && !sourceData.backlogTask)) {
      const lane = backlogTarget?.element?.closest?.('[data-backlog-drop-zone="true"]')
        || mainBacklogLane;
      nextPresentation = {
        kind: "backlog",
        variant: lane?.dataset.collectionSurfaceId === "right-panel-backlog"
          ? "panel"
          : "main",
        width: previewWidthForElement(lane),
      };
    } else {
      nextPresentation = {
        kind: sourceData.backlogTask
          ? "backlog"
          : sourceData.kind === "calendar-event"
            ? "calendar"
            : "board",
        variant: sourceData.preview?.variant,
        width: dragSessionRef.current?.sourceRect?.width,
      };
    }

    setDragPreviewPresentation((current) => (
      current?.kind === nextPresentation.kind
      && current?.variant === nextPresentation.variant
      && current?.width === nextPresentation.width
      && current?.offsetX === nextPresentation.offsetX
      && current?.offsetY === nextPresentation.offsetY
        ? current
        : nextPresentation
    ));
  };

  const handleDragStart = ({ operation, nativeEvent }) => {
    beginWorkspaceGesture();
    const sourceData = operation.source?.data;
    const pointer = pointerFromNativeEvent(nativeEvent);
    const sourceRect = operation.source?.element?.getBoundingClientRect();
    armPostDragClickGuard();
    clearBoardInsertionPreview();
    lastBoardProjectionRef.current = "";
    if (sourceData?.sessionTask) {
      setDragPreviewPresentation({ kind: "session-task", width: sourceRect?.width });
    } else if (
      sourceData?.backlogTask
      || sourceData?.kind === "board-task"
      || sourceData?.kind === "calendar-event"
    ) {
      setDragPreviewPresentation({
        kind: sourceData.backlogTask
          ? "backlog"
          : sourceData.kind === "calendar-event"
            ? "calendar"
            : "board",
        variant: sourceData.preview?.variant,
        width: sourceRect?.width,
      });
    } else {
      setDragPreviewPresentation(null);
    }

    if (sourceData?.kind === "collection-item") {
      const renderedSourceLaneId = operation.source?.element?.dataset.collectionLaneId
        || sourceData.sourceLaneId;
      const renderedSourceIndex = Number(
        operation.source?.element?.dataset.collectionIndex,
      );
      const currentSourceData = {
        ...sourceData,
        sourceLaneId: renderedSourceLaneId,
        sourceIndex: Number.isInteger(renderedSourceIndex)
          ? renderedSourceIndex
          : sourceData.sourceIndex,
      };
      const boardScrollElement = operation.source?.element?.closest?.(
        '[data-board-scroll-container="true"]',
      );
      dragSessionRef.current = {
        kind: "collection-item",
        sourceData: currentSourceData,
        collectionSnapshot: currentSourceData.collectionSnapshot,
        pointer,
        startPointer: pointer,
        grabOffset: sourceRect && pointer ? {
          x: pointer.x - sourceRect.left,
          y: pointer.y - sourceRect.top,
        } : null,
        verticalDirection: 0,
        horizontalDirection: 0,
        sourceRect: sourceRect ? {
          left: sourceRect.left,
          right: sourceRect.right,
          top: sourceRect.top,
          bottom: sourceRect.bottom,
          width: sourceRect.width,
        } : null,
        boardScrollElement,
        boardStartScrollLeft: boardScrollElement?.scrollLeft || 0,
        boardStartScrollTop: boardScrollElement?.scrollTop || 0,
        projectedCollectionLaneId: currentSourceData.sourceLaneId,
        projectedCollectionIndex: currentSourceData.sourceIndex,
        collectionOverlapProjectionActive: false,
        collectionTransferDirection: 0,
        previewCardActive: false,
      };
      return;
    }

    if (sourceData?.kind === "board-task") {
      const boardScrollElement = operation.source?.element?.closest?.(
        '[data-board-scroll-container="true"]',
      );
      dragSessionRef.current = {
        kind: "board-task",
        sourceData: { ...sourceData },
        boardSnapshot: boardStateRef.current,
        pointer,
        startPointer: pointer,
        grabOffset: sourceRect && pointer ? {
          x: pointer.x - sourceRect.left,
          y: pointer.y - sourceRect.top,
        } : null,
        verticalDirection: 0,
        horizontalDirection: 0,
        sourceRect: sourceRect ? {
          left: sourceRect.left,
          right: sourceRect.right,
          top: sourceRect.top,
          bottom: sourceRect.bottom,
          width: sourceRect.width,
        } : null,
        boardScrollElement,
        boardStartScrollLeft: boardScrollElement?.scrollLeft || 0,
        boardStartScrollTop: boardScrollElement?.scrollTop || 0,
        projectedDateKey: sourceData.sourceDateKey,
        projectedBoardSurfaceId: sourceData.boardSurfaceId,
        overlapProjectionActive: false,
        transferDirection: 0,
      };
      return;
    }

    dragSessionRef.current = sourceData ? {
      kind: sourceData.kind,
      sourceData: { ...sourceData },
      pointer,
      verticalDirection: 0,
      sourceRect: sourceRect ? {
        left: sourceRect.left,
        right: sourceRect.right,
        top: sourceRect.top,
        bottom: sourceRect.bottom,
        width: sourceRect.width,
      } : null,
    } : null;
  };

  const handleDragOver = (event) => {
    const { operation } = event;
    const sourceData = dragSessionRef.current?.sourceData || operation.source?.data;

    if (!sourceData?.sessionTask && sessionDragTaskId(sourceData) && sessionAtPointer(dragSessionRef.current?.pointer || operation.position.current)) {
      event.preventDefault();
      clearBoardInsertionPreview();
      lastBoardProjectionRef.current = "";
      return;
    }

    if (
      (sourceData?.kind === "board-task" || sourceData?.kind === "calendar-event")
      && (
        operation.target?.data?.backlogDropTarget
        || backlogTargetAtPointer(dragSessionRef.current?.pointer)
      )
    ) {
      event.preventDefault();
      lastBoardProjectionRef.current = "";
      return;
    }

    if (sourceData?.kind === "collection-item") {
      const externalTargetKind = operation.target?.data?.kind;
      if (
        sourceData.backlogTask
        && (
          externalTargetKind === "board-task"
          || externalTargetKind === "board-column"
          || externalTargetKind === "calendar-timeline"
        )
      ) {
        event.preventDefault();
        lastBoardProjectionRef.current = "";
        const pointerBoardTarget = boardTargetAtPointer(
          dragSessionRef.current?.pointer,
          boardStateRef.current,
        );
        if (pointerBoardTarget) {
          showBoardInsertionPreview(
            pointerBoardTarget,
            dragSessionRef.current?.pointer,
            sourceData,
          );
        } else {
          clearBoardInsertionPreview({ animate: true });
        }
        return;
      }

      const collectionTarget = collectionDragTarget(
        operation,
        dragSessionRef.current?.pointer,
        sourceData,
        dragSessionRef.current,
      );
      if (collectionTarget.blocked) {
        event.preventDefault();
        return;
      }
      const targetOverride = collectionTarget.targetOverride;
      const targetKind = (
        targetOverride?.target?.data?.kind || operation.target?.data?.kind
      );
      if (targetKind === "collection-item" || targetKind === "collection-lane") {
        event.preventDefault();
        const projected = projectCollectionItem(
          operation,
          dragSessionRef.current?.pointer,
          targetOverride,
        );
        if (
          !projected
          && !isPointerOverCollection(
            dragSessionRef.current?.pointer,
            sourceData.collectionId,
            sourceData.surfaceId,
          )
        ) {
          lastBoardProjectionRef.current = "";
        }
      } else {
        lastBoardProjectionRef.current = "";
      }
      return;
    }

    if (sourceData?.kind !== "board-task") return;

    const boardTarget = boardDragTarget(
      operation,
      dragSessionRef.current?.pointer,
      sourceData,
      dragSessionRef.current,
      boardStateRef.current,
    );
    if (boardTarget.blocked) {
      event.preventDefault();
      return;
    }
    const targetOverride = boardTarget.targetOverride;
    const targetKind = (
      targetOverride?.target?.data?.kind || operation.target?.data?.kind
    );
    if (targetKind === "board-task" || targetKind === "board-column") {
      event.preventDefault();
      const projected = projectBoardTask(
        operation,
        dragSessionRef.current?.pointer,
        targetOverride,
      );
      if (!projected && !isPointerOverBoard(dragSessionRef.current?.pointer)) {
        lastBoardProjectionRef.current = "";
      }
    } else {
      lastBoardProjectionRef.current = "";
    }
  };

  const handleDragMove = ({ operation, nativeEvent }) => {
    const sourceData = dragSessionRef.current?.sourceData || operation.source?.data;
    const pointer = pointerFromNativeEvent(nativeEvent) || operation.position.current;
    if (dragSessionRef.current && pointer) {
      const previousPointer = dragSessionRef.current.pointer;
      const deltaY = previousPointer ? pointer.y - previousPointer.y : 0;
      const deltaX = previousPointer ? pointer.x - previousPointer.x : 0;
      if (Math.abs(deltaY) >= 1) {
        dragSessionRef.current.verticalDirection = deltaY > 0 ? 1 : -1;
      }
      if (Math.abs(deltaX) >= 1) {
        dragSessionRef.current.horizontalDirection = deltaX > 0 ? 1 : -1;
      }
      dragSessionRef.current.pointer = pointer;
    }
    updateDragPreviewPresentation(sourceData, pointer);
    if (!sourceData?.sessionTask && sessionDragTaskId(sourceData) && sessionAtPointer(pointer)) {
      clearBoardInsertionPreview();
      lastBoardProjectionRef.current = "";
      return;
    }


    if (sourceData?.kind === "calendar-resize") {
      sourceData.onResizePreview?.(calendarResizeDeltaY(operation, pointer));
      return;
    }

    if (sourceData?.kind === "collection-item") {
      if (sourceData.backlogTask) {
        const pointerBoardTarget = boardTargetAtPointer(
          pointer,
          boardStateRef.current,
        );
        if (pointerBoardTarget) {
          showBoardInsertionPreview(pointerBoardTarget, pointer, sourceData);
          lastBoardProjectionRef.current = "";
          return;
        }
        clearBoardInsertionPreview({ animate: true });
      }

      const collectionTarget = collectionDragTarget(
        operation,
        pointer,
        sourceData,
        dragSessionRef.current,
      );
      if (collectionTarget.blocked) return;
      const targetOverride = collectionTarget.targetOverride;
      const targetKind = (
        targetOverride?.target?.data?.kind || operation.target?.data?.kind
      );
      if (targetKind === "collection-item" || targetKind === "collection-lane") {
        const projected = projectCollectionItem(
          operation,
          pointer,
          targetOverride,
        );
        if (
          !projected
          && !isPointerOverCollection(
            pointer,
            sourceData.collectionId,
            sourceData.surfaceId,
          )
        ) {
          lastBoardProjectionRef.current = "";
        }
      }
      return;
    }

    if (sourceData?.kind !== "board-task") return;

    const boardTarget = boardDragTarget(
      operation,
      pointer,
      sourceData,
      dragSessionRef.current,
      boardStateRef.current,
    );
    if (boardTarget.blocked) return;
    const targetOverride = boardTarget.targetOverride;
    const targetKind = (
      targetOverride?.target?.data?.kind || operation.target?.data?.kind
    );
    if (targetKind === "board-task" || targetKind === "board-column") {
      const projected = projectBoardTask(
        operation,
        pointer,
        targetOverride,
      );
      if (!projected && !isPointerOverBoard(pointer)) {
        lastBoardProjectionRef.current = "";
      }
    }
  };

  const handleDragEnd = ({ canceled, operation, nativeEvent }) => {
    try {
    const dragSession = dragSessionRef.current;
    const finalPointer = pointerFromNativeEvent(nativeEvent)
      || dragSession?.pointer
      || operation.position.current;
    if (dragSession) dragSession.pointer = finalPointer;
    const sourceData = dragSession?.sourceData || operation.source?.data;
    const target = operation.target;
    const targetData = target?.data;
    const finishDrag = () => {
      sourceData?.onResizePreview?.(null);
      clearBoardInsertionPreview();
      dragSessionRef.current = null;
      lastBoardProjectionRef.current = "";
      setDragPreviewPresentation(null);
      releasePostDragClickGuard();
    };

    if (canceled) {
      if (sourceData?.kind === "collection-item") restoreCollectionSnapshot();
      else if (sourceData?.kind === "board-task") restoreBoardSnapshot();
      finishDrag();
      return;
    }

    if (sourceData?.sessionTask) {
      const targetSessionId = sessionAtPointer(finalPointer) || null;
      // Reordering within the list is already projected by the shared collection flow.
      if (targetSessionId !== sourceData.sessionId) {
        replaceWorkspaceFields(moveSessionTask(workspaceStore.getState().fields, sourceData.sessionId, sourceData.taskId, targetSessionId));
      }
      finishDrag();
      return;
    }

    const sessionId = sessionAtPointer(finalPointer);
    const sessionTaskId = sessionDragTaskId(sourceData);
    if (sessionId && sessionTaskId) {
      if (sourceData.kind === "collection-item") restoreCollectionSnapshot();
      else if (sourceData.kind === "board-task") restoreBoardSnapshot();
      replaceWorkspaceFields(linkSessionTask(workspaceStore.getState().fields, sessionId, sessionTaskId));
      finishDrag();
      return;
    }

    if (sourceData?.session) {
      if (sourceData.kind === "calendar-resize") {
        const end = resizedCalendarEnd(sourceData, operation);
        setEvents(items => items.map(item => item.id === sourceData.eventId ? { ...item, end } : item));
      } else {
        const calendarTarget = calendarTargetAtPointer(finalPointer);
        if (calendarTarget?.data?.kind === "calendar-timeline") {
          const duration = sourceData.end - sourceData.start;
          const start = calendarStartAfterMove({
            start: sourceData.start, duration,
            deltaY: operation.position.current.y - operation.position.initial.y,
            scrollDelta: (sourceData.timelineScrollRef?.current?.scrollTop || 0) - (sourceData.dragStartScrollTopRef?.current || 0),
          });
          setEvents(items => items.map(item => item.id === sourceData.eventId
            ? { ...item, dateKey: calendarTarget.data.dateKey, start, end: start + duration } : item));
        }
      }
      finishDrag();
      return;
    }

    if (sourceData?.kind === "board-task" || sourceData?.kind === "calendar-event") {
      const scheduleElement = document.elementFromPoint(finalPointer.x, finalPointer.y)
        ?.closest?.('[data-backlog-schedule-target="true"]');
      const scheduleData = scheduleElement
        ? backlogDropDataFromElement(scheduleElement)
        : targetData?.backlogScheduleTarget ? targetData : null;
      if (scheduleData?.backlogContextual) {
        const taskId = sourceData.taskId || sourceData.eventId;
        const snapshot = dragSession?.boardSnapshot || boardStateRef.current;
        const task = snapshot.tasks.find((item) => item.id === taskId)
          || Object.values(snapshot.datedTasksByDate).flat().find((item) => item.id === taskId);
        const objectiveId = scheduleData.backlogObjectiveId || null;
        const channel = scheduleData.backlogChannel || task?.channel;
        if (task && (task.channel !== channel || (task.objectiveId || null) !== objectiveId)) {
          const objective = objectiveId
            ? weeklyObjectives.find((item) => item.id === objectiveId)
            : null;
          if (sourceData.kind === "board-task") restoreBoardSnapshot();
          if (objectiveId && (!objective || objective.complete)) {
            reportActionError("Choose an active project.");
          } else {
            mutateTaskAcrossPools(taskId, (item) => {
              const moved = { ...item, channel: objective?.channel || channel };
              if (objectiveId) moved.objectiveId = objectiveId;
              else delete moved.objectiveId;
              return moved;
            });
            moveTaskObjectiveMirror(task, objectiveId, task.minutes);
            setToast(`${task.title || "Task"} moved to ${objective?.title || channel}.`);
          }
          finishDrag();
          return;
        }
      }
      const pointerBacklogTarget = backlogTargetAtPointer(finalPointer);
      const backlogTarget = pointerBacklogTarget
        || (targetData?.backlogDropTarget ? target : null);
      const backlogTargetData = backlogTarget?.data;
      if (backlogTargetData?.backlogDropTarget) {
        const targetRect = backlogTarget.element?.getBoundingClientRect();
        const insertAfter = backlogTargetData.kind === "collection-item"
          && targetRect
          && finalPointer.y > targetRect.top + targetRect.height / 2;
        const moved = moveTaskToBacklog({
          taskId: sourceData.taskId || sourceData.eventId,
          targetData: backlogTargetData,
          insertAfter,
          taskSnapshot: sourceData.taskSnapshot,
        });
        if (moved) {
          finishDrag();
          return;
        }
      }
    }

    if (sourceData?.kind === "collection-item") {
      if (sourceData.backlogTask) {
        const scheduleCollectionTarget = collectionDragTarget(
          operation,
          finalPointer,
          sourceData,
          dragSession,
        );
        const scheduleTarget = scheduleCollectionTarget.targetOverride?.target
          || (targetData?.backlogScheduleTarget ? target : null);
        const scheduleTargetData = scheduleTarget?.data;
        if (scheduleTargetData?.backlogScheduleTarget) {
          restoreCollectionSnapshot();
          setPendingScheduleDrop({
            taskId: sourceData.taskId || sourceData.itemId,
            taskTitle: sourceData.itemSnapshot?.title || "Untitled task",
            targetChannel: scheduleTargetData.backlogChannel || null,
            targetObjectiveId: scheduleTargetData.backlogObjectiveId || null,
          });
          finishDrag();
          return;
        }

        const pointerCalendarTarget = calendarTargetAtPointer(finalPointer);
        const calendarTarget = targetData?.kind === "calendar-timeline"
          ? target
          : pointerCalendarTarget;
        if (calendarTarget?.element) {
          const targetDateKey = calendarTarget.data.dateKey || CURRENT_DATE_KEY;
          const timelineRect = calendarTarget.element.getBoundingClientRect();
          const sourceMinutes = sourceData.itemSnapshot?.minutes;
          const duration = Math.max(
            Number.isFinite(sourceMinutes) ? sourceMinutes : 0,
            30,
          );
          const nextStart = calendarStartAtPointer({
            pointerY: finalPointer.y,
            timelineTop: timelineRect.top,
            duration,
          });
          const promoted = promoteBacklogTask({
            taskId: sourceData.taskId,
            dateKey: targetDateKey,
            start: nextStart,
            end: nextStart + duration,
            taskSnapshot: sourceData.itemSnapshot,
          });
          if (promoted) {
            finishDrag();
            return;
          }
        }

        const pointerBoardTarget = boardTargetAtPointer(
          finalPointer,
          boardStateRef.current,
        );
        const boardTarget = pointerBoardTarget || (
          targetData?.kind === "board-task"
          || targetData?.kind === "board-column"
            ? target
            : null
        );
        const boardTargetData = boardTarget?.data;
        if (
          boardTarget?.element
          && (
            boardTargetData?.kind === "board-task"
            || boardTargetData?.kind === "board-column"
          )
        ) {
          const targetRect = boardTarget.element.getBoundingClientRect();
          const insertAfterTarget = boardTargetData.kind === "board-task"
            && finalPointer.y > targetRect.top + targetRect.height / 2;
          const targetIndex = boardTargetData.kind === "board-task"
            ? boardTargetData.index + (insertAfterTarget ? 1 : 0)
            : boardTargetData.insertionIndex;
          const promoted = promoteBacklogTask({
            taskId: sourceData.taskId,
            dateKey: boardTargetData.dateKey,
            targetIndex,
            taskSnapshot: sourceData.itemSnapshot,
          });
          if (promoted) {
            finishDrag();
            return;
          }
        }
      }

      const crossSurfaceTarget = collectionTargetAtPointer(
        finalPointer,
        sourceData,
        null,
      );
      const targetSurfaceId = crossSurfaceTarget?.data?.surfaceId;
      const sourceIsProjectCatalog = sourceData.surfaceId === "right-panel-objectives";
      const targetIsProjectCatalog = targetSurfaceId === "right-panel-objectives";
      const sourceIsWeeklyFocus = (
        sourceData.surfaceId === "weekly-objectives-step"
        || sourceData.surfaceId === "weekly-plan-objectives"
      );
      const targetIsWeeklyFocus = (
        targetSurfaceId === "weekly-objectives-step"
        || targetSurfaceId === "weekly-plan-objectives"
      );

      if (
        sourceData.collectionId === "weekly-objectives"
        && sourceIsProjectCatalog
        && targetIsWeeklyFocus
        && sourceData.onFocusObjectiveInWeek
      ) {
        const targetRect = crossSurfaceTarget.element?.getBoundingClientRect();
        const insertAfterTarget = (
          crossSurfaceTarget.data.kind === "collection-item"
          && targetRect
          && finalPointer.y > targetRect.top + targetRect.height / 2
        );
        const targetIndex = crossSurfaceTarget.data.kind === "collection-item"
          ? crossSurfaceTarget.data.index + (insertAfterTarget ? 1 : 0)
          : crossSurfaceTarget.data.insertionIndex;
        restoreCollectionSnapshot();
        sourceData.onFocusObjectiveInWeek(sourceData.itemId, targetIndex);
        finishDrag();
        return;
      }

      if (
        sourceData.collectionId === "weekly-objectives"
        && sourceIsWeeklyFocus
        && targetIsProjectCatalog
        && sourceData.onRemoveObjectiveFromWeek
      ) {
        const targetRect = crossSurfaceTarget.element?.getBoundingClientRect();
        const insertAfterTarget = (
          crossSurfaceTarget.data.kind === "collection-item"
          && targetRect
          && finalPointer.y > targetRect.top + targetRect.height / 2
        );
        const targetIndex = crossSurfaceTarget.data.kind === "collection-item"
          ? crossSurfaceTarget.data.index + (insertAfterTarget ? 1 : 0)
          : crossSurfaceTarget.data.insertionIndex;
        restoreCollectionSnapshot();
        sourceData.onRemoveObjectiveFromWeek(
          sourceData.itemId,
          crossSurfaceTarget.data.laneId === "other-projects"
            ? targetIndex
            : undefined,
        );
        finishDrag();
        return;
      }

      const hadValidCollectionProjection = Boolean(lastBoardProjectionRef.current);
      const collectionTarget = collectionDragTarget(
        operation,
        finalPointer,
        sourceData,
        dragSessionRef.current,
      );
      const targetOverride = collectionTarget.targetOverride;
      const landedOnCollection = collectionTarget.blocked
        ? false
        : projectCollectionItem(
          operation,
          finalPointer,
          targetOverride,
        );
      const canCommitLastProjection = (
        hadValidCollectionProjection
        && (
          isPointerOverCollection(
            finalPointer,
            sourceData.collectionId,
            sourceData.surfaceId,
          )
          || (
            sourceData.collectionId === RIGHT_PANEL_BACKLOG_COLLECTION_ID
            && isPointerOverRightPanelBacklogGroup(
              finalPointer,
              dragSession.projectedCollectionLaneId,
            )
          )
        )
      );
      if (!landedOnCollection && !canCommitLastProjection) {
        restoreCollectionSnapshot();
      }
      finishDrag();
      return;
    }

    if (!sourceData || sourceData.dragType !== CALENDAR_DRAG_TYPE) {
      finishDrag();
      return;
    }

    if (sourceData.kind === "calendar-resize") {
      const nextEnd = resizedCalendarEnd(sourceData, operation);

      setEvents((items) => items.map((calendarEvent) => (
        calendarEvent.id === sourceData.eventId
        && (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.dateKey
          ? { ...calendarEvent, end: nextEnd }
          : calendarEvent
      )));
      updateTaskTimingAcrossPools(
        sourceData.eventId,
        sourceData.start,
        nextEnd - sourceData.start,
      );
      finishDrag();
      return;
    }

    if (sourceData.kind === "calendar-event") {
      const pointerCalendarTarget = calendarTargetAtPointer(finalPointer);
      const calendarTarget = pointerCalendarTarget
        || (targetData?.kind === "calendar-timeline" ? target : null);
      const calendarTargetData = calendarTarget?.data;
      if (calendarTargetData?.kind !== "calendar-timeline" || !calendarTarget?.element) {
        setEvents((items) => items.filter((calendarEvent) => !(
          calendarEvent.id === sourceData.eventId
          && (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.dateKey
        )));
        updateTaskTimingAcrossPools(sourceData.eventId, null);
        finishDrag();
        return;
      }

      const targetDateKey = calendarTargetData.dateKey || CURRENT_DATE_KEY;
      const duration = sourceData.end - sourceData.start;
      const deltaY = operation.position.current.y - operation.position.initial.y;
      const scrollDelta = (
        sourceData.timelineScrollRef?.current?.scrollTop
        - (sourceData.dragStartScrollTopRef?.current || 0)
      ) || 0;
      const nextStart = calendarStartAfterMove({
        start: sourceData.start,
        duration,
        deltaY,
        scrollDelta,
      });

      if (nextStart === sourceData.start && targetDateKey === sourceData.dateKey) {
        finishDrag();
        return;
      }

      setEvents((items) => items.map((calendarEvent) => (
        calendarEvent.id === sourceData.eventId
        && (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.dateKey
          ? {
              ...calendarEvent,
              dateKey: targetDateKey,
              start: nextStart,
              end: nextStart + duration,
            }
          : calendarEvent
      )));
      updateTaskTimingAcrossPools(sourceData.eventId, nextStart);
      finishDrag();
      return;
    }

    const pointerCalendarTarget = calendarTargetAtPointer(finalPointer);
    const calendarTarget = pointerCalendarTarget
      || (targetData?.kind === "calendar-timeline" ? target : null);
    const calendarTargetData = calendarTarget?.data;
    if (
      (sourceData.kind === "task" || sourceData.kind === "board-task")
      && calendarTargetData?.kind === "calendar-timeline"
      && calendarTarget?.element
    ) {
      const targetDateKey = calendarTargetData.dateKey || CURRENT_DATE_KEY;
      const timelineRect = calendarTarget.element.getBoundingClientRect();
      const duration = Math.max(sourceData.minutes, 30);
      const nextStart = calendarStartAtPointer({
        pointerY: finalPointer.y,
        timelineTop: timelineRect.top,
        duration,
      });

      if (sourceData.kind === "board-task") {
        restoreBoardSnapshot();
        const currentDateKey = findTaskDateKey(boardStateRef.current, sourceData.taskId);
        if (currentDateKey && currentDateKey !== targetDateKey) {
          moveBoardTask({
            taskId: sourceData.taskId,
            sourceDateKey: currentDateKey,
            targetDateKey,
            syncEventDate: false,
          });
        }
      }

      setEvents((items) => [
        ...items.filter((calendarEvent) => calendarEvent.id !== sourceData.taskId),
        {
          id: sourceData.taskId,
          dateKey: targetDateKey,
          title: sourceData.title,
          start: nextStart,
          end: nextStart + duration,
          color: sourceData.color || "violet",
        },
      ]);
      updateTaskTimingAcrossPools(sourceData.taskId, nextStart);
      finishDrag();
      return;
    }

    if (sourceData.kind !== "board-task") {
      finishDrag();
      return;
    }

    const hadValidBoardProjection = Boolean(lastBoardProjectionRef.current);
    const boardTarget = boardDragTarget(
      operation,
      finalPointer,
      sourceData,
      dragSessionRef.current,
      boardStateRef.current,
    );
    const targetOverride = boardTarget.targetOverride;
    const landedOnBoard = boardTarget.blocked
      ? false
      : projectBoardTask(
        operation,
        finalPointer,
        targetOverride,
      );
    const canCommitLastProjection = (
      hadValidBoardProjection
      && isPointerOverBoard(finalPointer)
    );
    if (!landedOnBoard && !canCommitLastProjection) {
      restoreBoardSnapshot();
      finishDrag();
      return;
    }

    const finalDateKey = findTaskDateKey(boardStateRef.current, sourceData.taskId);
    if (finalDateKey && finalDateKey !== sourceData.sourceDateKey) {
      setEvents((items) => items.map((calendarEvent) => (
        calendarEvent.id === sourceData.taskId
        && (calendarEvent.dateKey || CURRENT_DATE_KEY) === sourceData.sourceDateKey
          ? { ...calendarEvent, dateKey: finalDateKey }
          : calendarEvent
      )));
    }
    finishDrag();
    } finally { endWorkspaceGesture(); }
  };

  return (
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
      <TaskReorderAnimator revision={taskLayoutRevision} />
      <AutoScheduleAnimation
        request={autoScheduleRequest?.pageKey === rightPaneKey ? autoScheduleRequest : null}
        onFinish={finishAutoSchedule}
      >
      <main className="app-window" aria-label={`${activeTitle}`}>
        <div
          className={`app-shell${!navigationOpen ? " navigation-collapsed" : ""}${!rightPanelOpen ? " right-panel-collapsed" : ""}`}
          data-view={view}
        >
          <div
            className="app-workspace"
            aria-hidden={activeTask || activeObjective || activeAreaDetails || pendingScheduleDrop ? "true" : undefined}
            inert={activeTask || activeObjective || activeAreaDetails || pendingScheduleDrop ? true : undefined}
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
            {view === "home" ? (
              <BoardView
                areas={areas}
                tasks={tasks}
                setTasks={setTasks}
                datedTasksByDate={datedTasksByDate}
                setDatedTasksByDate={setDatedTasksByDate}
                events={events}
                setEvents={setEvents}
                objectives={weeklyObjectives}
                setObjectives={setWeeklyObjectives}
                weeklyFocusedObjectives={weeklyFocusedObjectives}
                setWeeklyFocusedObjectives={updateWeeklyFocusedObjectives}
                rightPanelUnavailableTaskIds={rightPanelUnavailableTaskIds}
                backlogGroups={backlogGroups}
                setBacklogGroups={setBacklogGroups}
                weekStartRequest={homeWeekStartRequest}
                todayFocusRequest={homeTodayFocusRequest}
                activeRightPane={activeRightPane}
                onRightPaneChange={selectRightPane}
                onWorkspaceViewChange={(nextView) => updateNavigationOpen(nextView === "board")}
                onAddTask={openAddTask}
                onCreateBoardTask={createBoardTask}
                onCreateCalendarSession={createCalendarSessionFromSelection}
                onCompleteUndatedTask={completeUndatedTaskToday}
                onAssignObjective={assignTaskToWeeklyObjective}
                onQuickSchedule={scheduleTaskAtFirstAvailableTime}
                onUnscheduleTask={removeTaskSchedule}
                onOpenObjective={openObjectiveDetails}
                onOpenTask={openTaskDetails}
              />
            ) : null}
            {view === "today" ? (
              <BoardView
                areas={areas}
                tasks={tasks}
                setTasks={setTasks}
                datedTasksByDate={datedTasksByDate}
                setDatedTasksByDate={setDatedTasksByDate}
                events={events}
                setEvents={setEvents}
                objectives={weeklyObjectives}
                setObjectives={setWeeklyObjectives}
                weeklyFocusedObjectives={weeklyFocusedObjectives}
                setWeeklyFocusedObjectives={updateWeeklyFocusedObjectives}
                rightPanelUnavailableTaskIds={rightPanelUnavailableTaskIds}
                backlogGroups={backlogGroups}
                setBacklogGroups={setBacklogGroups}
                activeRightPane={activeRightPane}
                onRightPaneChange={selectRightPane}
                singleDay
                onAddTask={openAddTask}
                onCreateBoardTask={createBoardTask}
                onCreateCalendarSession={createCalendarSessionFromSelection}
                onCompleteUndatedTask={completeUndatedTaskToday}
                onAssignObjective={assignTaskToWeeklyObjective}
                onQuickSchedule={scheduleTaskAtFirstAvailableTime}
                onUnscheduleTask={removeTaskSchedule}
                onOpenObjective={openObjectiveDetails}
                onOpenTask={openTaskDetails}
              />
            ) : null}
            {view === "backlog" ? (
              <BacklogView
                areas={areas}
                groups={backlogGroups}
                scheduledItems={scheduledBacklogTasks}
                setGroups={setBacklogGroups}
                scope={taskScope}
                onScopeChange={openTaskScope}
                tasks={tasks}
                setTasks={setTasks}
                datedTasksByDate={datedTasksByDate}
                setDatedTasksByDate={setDatedTasksByDate}
                events={events}
                setEvents={setEvents}
                objectives={weeklyObjectives}
                setObjectives={setWeeklyObjectives}
                weeklyFocusedObjectives={weeklyFocusedObjectives}
                setWeeklyFocusedObjectives={updateWeeklyFocusedObjectives}
                rightPanelUnavailableTaskIds={rightPanelUnavailableTaskIds}
                activeRightPane={activeRightPane}
                onRightPaneChange={selectRightPane}
                onCreateBoardTask={createBoardTask}
                onCreateCalendarSession={createCalendarSessionFromSelection}
                onCompleteUndatedTask={completeUndatedTaskToday}
                onAssignObjective={assignTaskToWeeklyObjective}
                onQuickSchedule={scheduleTaskAtFirstAvailableTime}
                onUnscheduleTask={removeTaskSchedule}
                onOpenArea={openAreaDetails}
                onOpenObjective={openObjectiveDetails}
                onOpenTask={openTaskDetails}
                onToggleObjective={toggleObjectiveFromDetails}
                onToggleScheduledTask={toggleScheduledTaskFromBacklog}
              />
            ) : null}
            {view === "planning" ? (
              <DailyPlanningView
                onRevealCalendar={() => {
                  selectRightPane("calendar");
                  updateRightPanelOpen(true);
                }}
                areas={areas}
                tasks={tasks}
                setTasks={setTasks}
                datedTasksByDate={datedTasksByDate}
                setDatedTasksByDate={setDatedTasksByDate}
                events={events}
                setEvents={setEvents}
                objectives={weeklyObjectives}
                setObjectives={setWeeklyObjectives}
                weeklyFocusedObjectives={weeklyFocusedObjectives}
                setWeeklyFocusedObjectives={updateWeeklyFocusedObjectives}
                rightPanelUnavailableTaskIds={rightPanelUnavailableTaskIds}
                backlogGroups={backlogGroups}
                setBacklogGroups={setBacklogGroups}
                activeRightPane={activeRightPane}
                onRightPaneChange={selectRightPane}
                step={planningStep}
                setStep={setPlanningStep}
                onDone={() => { setDailyCompletedDate(CURRENT_DATE_KEY); setView("home"); setToast("Day planned!"); }}
                onAddTask={openAddTask}
                onCreateBoardTask={createBoardTask}
                onCreateCalendarSession={createCalendarSessionFromSelection}
                onCompleteUndatedTask={completeUndatedTaskToday}
                setToast={setToast}
                onAssignObjective={assignTaskToWeeklyObjective}
                onQuickSchedule={scheduleTaskAtFirstAvailableTime}
                onUnscheduleTask={removeTaskSchedule}
                onOpenObjective={openObjectiveDetails}
                onOpenTask={openTaskDetails}
              />
            ) : null}
            {view === "weekly-planning" ? (
              <WeeklyPlanningView
                areas={areas}
                days={weeklyCompletedDays}
                setDays={setWeeklyCompletedDays}
                tasks={tasks}
                setTasks={setTasks}
                datedTasksByDate={datedTasksByDate}
                setDatedTasksByDate={setDatedTasksByDate}
                events={events}
                setEvents={setEvents}
                objectives={weeklyObjectives}
                setObjectives={setWeeklyObjectives}
                weeklyFocusedObjectives={weeklyFocusedObjectives}
                setWeeklyFocusedObjectives={updateWeeklyFocusedObjectives}
                rightPanelUnavailableTaskIds={rightPanelUnavailableTaskIds}
                backlogGroups={backlogGroups}
                setBacklogGroups={setBacklogGroups}
                activeRightPane={activeRightPane}
                onRightPaneChange={selectRightPane}
                step={weeklyStep}
                setStep={setWeeklyStep}
                onExit={() => setView("home")}
                onDone={() => {
                  replaceWorkspaceFields(completeWeeklyPlanning(workspaceStore.getState().fields, CURRENT_DATE_KEY));
                  setToast("Week planned!");
                }}
                onAddTask={openAddTask}
                onCreateBoardTask={createBoardTask}
                onCreateCalendarSession={createCalendarSessionFromSelection}
                onCompleteUndatedTask={completeUndatedTaskToday}
                onAssignObjective={assignTaskToWeeklyObjective}
                onQuickSchedule={scheduleTaskAtFirstAvailableTime}
                onUnscheduleTask={removeTaskSchedule}
                setToast={setToast}
                onOpenObjective={openObjectiveDetails}
                onOpenTask={openTaskDetails}
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
              onAddComment={(text, attachment) => (
                addObjectiveCommentFromDetails(activeObjective.id, text, attachment)
              )}
              onAddTask={(title) => (
                addObjectiveTaskFromDetails(activeObjective.id, title)
              )}
              onArchive={() => moveProjectOutOfActiveDetails(activeObjective.id, "archive")}
              onClose={closeObjectiveDetails}
              onDelete={() => moveProjectOutOfActiveDetails(activeObjective.id, "delete")}
              onOpenTask={openObjectiveTaskDetails}
              onRemoveFromWeek={() => (
                removeObjectiveFromWeekFromDetails(activeObjective.id)
              )}
              onToggle={() => toggleObjectiveFromDetails(activeObjective.id)}
              onToggleTask={(objectiveTaskId, canonicalTaskId) => (
                toggleObjectiveTaskFromDetails(
                  activeObjective.id,
                  objectiveTaskId,
                  canonicalTaskId,
                )
              )}
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
              onColorChange={(colorOption) => (
                changeAreaColorFromDetails(activeAreaDetails.id, colorOption)
              )}
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
              onAddComment={(text, attachment) => (
                addCommentFromDetails(activeTask.id, text, attachment)
              )}
              onAddSubtask={(subtask) => addSubtaskFromDetails(activeTask.id, subtask)}
              onAssignProject={(objectiveId) => (
                assignTaskToWeeklyObjective(activeTask, objectiveId)
              )}
              onChangeArea={(channel, options) => (
                updateTaskFromDetails(activeTask.id, { channel }, options)
              )}
              onClose={closeTaskDetails}
              onDelete={(scope) => deleteTaskFromDetails(activeTask.id, scope)}
              onOpenObjective={activeTaskObjective && weeklyObjectives.some(
                (objective) => objective.id === activeTaskObjective.id,
              ) ? openActiveTaskObjectiveDetails : undefined}
              onRemoveSchedule={() => removeTaskSchedule(activeTask.id)}
              onSchedule={(schedule) => scheduleTaskFromDetails(activeTask.id, schedule)}
              onToggle={() => toggleTaskFromDetails(activeTask.id)}
              onToggleSubtask={(subtaskId) => (
                toggleSubtaskFromDetails(activeTask.id, subtaskId)
              )}
              onUpdateSubtask={(subtaskId, patch) => (
                updateSubtaskFromDetails(activeTask.id, subtaskId, patch)
              )}
              onReorderSubtasks={(move) => {
                if (move.sourceLaneId !== "subtasks" || move.targetLaneId !== "subtasks") return;
                mutateTaskAcrossPools(activeTask.id, (task) => ({
                  ...task,
                  subtasks: moveItemBetweenLanes({
                    lanes: { subtasks: task.subtasks || [] },
                    ...move,
                  }).subtasks,
                }));
              }}
              onUpdateRecurrence={(recurrence) => (
                updateTaskRecurrenceFromDetails(activeTask.id, recurrence)
              )}
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
        disabled={(source) => source?.data?.kind === "calendar-resize"}
      >
        {(source) => (
          <DndPreview
            areas={areas}
            presentation={dragPreviewPresentation}
            source={source}
          />
        )}
      </DragOverlay>
      </DragDropProvider>
      </TaskAreaActionsProvider>
    </AreaFoldersProvider>
    </CalendarSessionsProvider>
  );
}

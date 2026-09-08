import { CURRENT_DATE_KEY } from "./dates.js";

const BOARD_GROUP_PREFIX = "board";

const clampInsertionIndex = (index, length) => (
  Math.max(0, Math.min(length, Number.isFinite(index) ? index : length))
);

const tasksForDate = (tasks, datedTasksByDate, dateKey) => (
  dateKey === CURRENT_DATE_KEY ? tasks : datedTasksByDate[dateKey] || []
);

const reorderVisibleSlots = (dateTasks, taskId, visibleTaskIds, targetIndex) => {
  const visibleIdSet = new Set(visibleTaskIds);
  const visibleSlots = [];
  const visibleTasks = [];

  dateTasks.forEach((task, index) => {
    if (!visibleIdSet.has(task.id)) return;
    visibleSlots.push(index);
    visibleTasks.push(task);
  });

  const sourceIndex = visibleTasks.findIndex((task) => task.id === taskId);
  if (sourceIndex === -1) return { dateTasks, moved: false };

  const movedTask = visibleTasks[sourceIndex];
  const remainingVisibleTasks = visibleTasks.filter((task) => task.id !== taskId);
  const insertionIndex = clampInsertionIndex(targetIndex, remainingVisibleTasks.length);

  if (sourceIndex === insertionIndex) {
    return { dateTasks, movedTask, moved: false };
  }

  const reorderedVisibleTasks = [
    ...remainingVisibleTasks.slice(0, insertionIndex),
    movedTask,
    ...remainingVisibleTasks.slice(insertionIndex),
  ];
  const reorderedTasks = [...dateTasks];
  visibleSlots.forEach((slot, index) => {
    reorderedTasks[slot] = reorderedVisibleTasks[index];
  });

  return { dateTasks: reorderedTasks, movedTask, moved: true };
};

const withTasksForDate = (state, dateKey, dateTasks) => {
  if (dateKey === CURRENT_DATE_KEY) {
    return { ...state, tasks: dateTasks };
  }

  return {
    ...state,
    datedTasksByDate: {
      ...state.datedTasksByDate,
      [dateKey]: dateTasks,
    },
  };
};

export const boardGroupId = (surfaceId, dateKey) => (
  `${BOARD_GROUP_PREFIX}:${surfaceId}:${dateKey}`
);

export const acceptsBoardTaskDrag = (source) => (
  source.data?.kind === "board-task"
  || (
    source.data?.kind === "collection-item"
    && source.data?.backlogTask === true
  )
);

export function moveTaskBetweenDates({
  tasks,
  datedTasksByDate,
  taskId,
  sourceDateKey,
  targetDateKey,
  targetIndex,
  visibleTaskIds,
}) {
  const sourceTasks = tasksForDate(tasks, datedTasksByDate, sourceDateKey);
  const sourceIndex = sourceTasks.findIndex((task) => task.id === taskId);

  if (sourceIndex === -1 || !targetDateKey) {
    return { tasks, datedTasksByDate, moved: false };
  }

  const movedTask = sourceTasks[sourceIndex];
  const remainingSourceTasks = sourceTasks.filter((task) => task.id !== taskId);

  if (sourceDateKey === targetDateKey) {
    if (visibleTaskIds?.length) {
      const visibleResult = reorderVisibleSlots(
        sourceTasks,
        taskId,
        visibleTaskIds,
        targetIndex,
      );

      if (!visibleResult.moved) {
        return {
          tasks,
          datedTasksByDate,
          movedTask: visibleResult.movedTask,
          moved: false,
        };
      }

      const nextState = withTasksForDate(
        { tasks, datedTasksByDate },
        sourceDateKey,
        visibleResult.dateTasks,
      );
      return { ...nextState, movedTask: visibleResult.movedTask, moved: true };
    }

    const insertionIndex = clampInsertionIndex(targetIndex, remainingSourceTasks.length);
    const reorderedTasks = [
      ...remainingSourceTasks.slice(0, insertionIndex),
      movedTask,
      ...remainingSourceTasks.slice(insertionIndex),
    ];
    const nextState = withTasksForDate(
      { tasks, datedTasksByDate },
      sourceDateKey,
      reorderedTasks,
    );

    return { ...nextState, movedTask, moved: sourceIndex !== insertionIndex };
  }

  const targetTasks = tasksForDate(tasks, datedTasksByDate, targetDateKey)
    .filter((task) => task.id !== taskId);
  const insertionIndex = clampInsertionIndex(targetIndex, targetTasks.length);
  const nextTargetTasks = [
    ...targetTasks.slice(0, insertionIndex),
    movedTask,
    ...targetTasks.slice(insertionIndex),
  ];
  const withoutSource = withTasksForDate(
    { tasks, datedTasksByDate },
    sourceDateKey,
    remainingSourceTasks,
  );
  const nextState = withTasksForDate(withoutSource, targetDateKey, nextTargetTasks);

  return { ...nextState, movedTask, moved: true };
}

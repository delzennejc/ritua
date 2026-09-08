export const completedTasksLast = (tasks) => [
  ...tasks.filter((task) => !task.complete),
  ...tasks.filter((task) => task.complete),
];

export const upcomingScheduledTasks = (
  tasks,
  datedTasksByDate,
  currentDateKey,
) => [
  ...tasks.map((task, scheduledDateIndex) => ({
    ...task,
    scheduledDateIndex,
    scheduledDateKey: currentDateKey,
  })),
  ...Object.entries(datedTasksByDate)
    .filter(([dateKey]) => dateKey >= currentDateKey)
    .sort(([firstDateKey], [secondDateKey]) => (
      firstDateKey.localeCompare(secondDateKey)
    ))
    .flatMap(([dateKey, dateTasks]) => (
      dateTasks.map((task, scheduledDateIndex) => ({
        ...task,
        scheduledDateIndex,
        scheduledDateKey: dateKey,
      }))
    )),
];

export const nextScheduledOccurrences = (scheduledTasks) => {
  const visibleSeriesIds = new Set();

  return scheduledTasks.filter((task) => {
    if (!task.recurrenceSeriesId) return true;
    if (visibleSeriesIds.has(task.recurrenceSeriesId)) return false;
    visibleSeriesIds.add(task.recurrenceSeriesId);
    return true;
  });
};

export const setTaskCompletionInObjectiveMirrors = (
  objectives,
  taskId,
  complete,
) => objectives.map((objective) => ({
  ...objective,
  tasks: (() => {
    const sourceTask = objective.tasks?.find((task) => (
      task.taskId === taskId || task.id === taskId
    ));
    if (!sourceTask || sourceTask.complete === complete) return objective.tasks;

    return toggleTaskInTasks(
      objective.tasks,
      sourceTask.id || sourceTask.taskId,
    );
  })(),
}));

const minutesFromTimeLabel = (time) => {
  if (typeof time !== "string") return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
};

export const orderTasksByTime = (tasks) => tasks
  .map((task, index) => ({
    task,
    index,
    start: minutesFromTimeLabel(task.time),
  }))
  .sort((first, second) => {
    if (first.task.complete !== second.task.complete) {
      return Number(first.task.complete) - Number(second.task.complete);
    }

    if (first.task.complete) return first.index - second.index;

    if (first.start === null && second.start !== null) return 1;
    if (first.start !== null && second.start === null) return -1;

    return (first.start ?? 0) - (second.start ?? 0)
      || first.index - second.index;
  })
  .map(({ task }) => task);

export const setTaskTimeInTasks = (tasks, taskId, time) => {
  if (!tasks.some((task) => task.id === taskId)) return tasks;

  return orderTasksByTime(tasks.map((task) => (
    task.id === taskId ? { ...task, time } : task
  )));
};

export const insertBeforeCompletedTasks = (tasks, task) => {
  const firstCompletedIndex = tasks.findIndex((item) => item.complete);
  const insertionIndex = firstCompletedIndex === -1
    ? tasks.length
    : firstCompletedIndex;

  return [
    ...tasks.slice(0, insertionIndex),
    task,
    ...tasks.slice(insertionIndex),
  ];
};

const incompletePositionFor = (tasks, taskId) => {
  const incompleteTasks = tasks.filter((task) => !task.complete);
  const index = incompleteTasks.findIndex((task) => task.id === taskId);
  if (index === -1) return null;

  return {
    index,
    previousTaskId: incompleteTasks[index - 1]?.id || null,
    nextTaskId: incompleteTasks[index + 1]?.id || null,
  };
};

const restoreIncompleteTask = (tasks, task, position) => {
  if (!position) return insertBeforeCompletedTasks(tasks, task);

  const nextTaskIndex = position.nextTaskId
    ? tasks.findIndex((item) => (
        !item.complete && item.id === position.nextTaskId
      ))
    : -1;
  if (nextTaskIndex !== -1) {
    return [
      ...tasks.slice(0, nextTaskIndex),
      task,
      ...tasks.slice(nextTaskIndex),
    ];
  }

  const previousTaskIndex = position.previousTaskId
    ? tasks.findIndex((item) => (
        !item.complete && item.id === position.previousTaskId
      ))
    : -1;
  if (previousTaskIndex !== -1) {
    return [
      ...tasks.slice(0, previousTaskIndex + 1),
      task,
      ...tasks.slice(previousTaskIndex + 1),
    ];
  }

  let activeTaskIndex = 0;
  let fallbackIndex = -1;
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].complete) continue;
    if (activeTaskIndex === position.index) {
      fallbackIndex = index;
      break;
    }
    activeTaskIndex += 1;
  }
  if (fallbackIndex === -1) {
    fallbackIndex = tasks.findIndex((item) => item.complete);
  }
  const insertionIndex = fallbackIndex === -1 ? tasks.length : fallbackIndex;

  return [
    ...tasks.slice(0, insertionIndex),
    task,
    ...tasks.slice(insertionIndex),
  ];
};

const currentMinuteOfDay = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

export const toggleTaskInTasks = (tasks, taskId, completedAtMinute) => {
  const sourceIndex = tasks.findIndex((task) => task.id === taskId);
  if (sourceIndex === -1) return tasks;

  const sourceTask = tasks[sourceIndex];
  const complete = !sourceTask.complete;
  const resolvedCompletionMinute = Number.isFinite(completedAtMinute)
    ? Math.max(0, Math.min(24 * 60 - 1, completedAtMinute))
    : currentMinuteOfDay();
  const incompletePosition = complete
    ? incompletePositionFor(tasks, taskId)
    : sourceTask.incompletePosition;
  const taskWithoutPosition = { ...sourceTask };
  delete taskWithoutPosition.incompletePosition;
  const toggledTask = {
    ...taskWithoutPosition,
    complete,
    completedAtMinute: complete ? resolvedCompletionMinute : null,
    ...(complete && incompletePosition ? { incompletePosition } : {}),
    ...(
      complete && sourceTask.subtasks?.length
        ? {
            subtasks: sourceTask.subtasks.map((subtask) => ({
              ...subtask,
              complete: true,
              completedAtMinute: subtask.complete
                ? subtask.completedAtMinute
                : resolvedCompletionMinute,
            })),
          }
        : {}
    ),
  };
  const remainingTasks = tasks.filter((task) => task.id !== taskId);

  if (complete) {
    return insertBeforeCompletedTasks(remainingTasks, toggledTask);
  }

  return restoreIncompleteTask(remainingTasks, toggledTask, incompletePosition);
};

export const completeUndatedTaskInTasks = (
  tasks,
  sourceTask,
  completedAtMinute,
) => {
  const task = {
    ...sourceTask,
    complete: false,
    minutes: Number.isFinite(sourceTask.minutes) && sourceTask.minutes > 0
      ? sourceTask.minutes
      : 15,
  };
  const tasksWithSource = insertBeforeCompletedTasks(
    tasks.filter((item) => item.id !== task.id),
    task,
  );

  return toggleTaskInTasks(tasksWithSource, task.id, completedAtMinute);
};

export const toggleSubtaskInTasks = (
  tasks,
  taskId,
  subtaskId,
  completedAtMinute,
) => {
  const resolvedCompletionMinute = Number.isFinite(completedAtMinute)
    ? Math.max(0, Math.min(24 * 60 - 1, completedAtMinute))
    : currentMinuteOfDay();

  return tasks.map((task) => (
    task.id === taskId
      ? {
        ...task,
        subtasks: task.subtasks?.map((subtask) => {
          if (subtask.id !== subtaskId) return subtask;
          const complete = !subtask.complete;
          return {
            ...subtask,
            complete,
            completedAtMinute: complete ? resolvedCompletionMinute : null,
          };
        }),
      }
      : task
  ));
};

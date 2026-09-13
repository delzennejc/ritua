export const sessionDragTaskId = (source) => {
  if (!source || source.session) return null;
  if (source.sessionTask || source.kind === "task" || source.kind === "board-task") return source.taskId;
  if (source.kind === "calendar-event") return source.eventId;
  if (source.kind === "collection-item" && source.backlogTask) return source.taskId || source.itemSnapshot?.id || source.itemId;
  return null;
};

export const sessionAtPointer = (pointer) => pointer && document.elementFromPoint(pointer.x, pointer.y)
  ?.closest('[data-calendar-session="true"]')?.dataset.calendarEventId;

import { CollisionPriority } from "@dnd-kit/abstract";
import { useDroppable } from "@dnd-kit/react";
import {
  acceptsBoardTaskDrag,
  boardGroupId,
} from "../utils/board";

export function SortableTaskLane({
  as: Element = "section",
  boardSurfaceId,
  dateKey,
  tasks,
  allTasks = tasks,
  className = "",
  children,
  ...props
}) {
  const group = boardGroupId(boardSurfaceId, dateKey);
  const isFilteredBoard = tasks.length !== allTasks.length;
  const visibleTaskIds = isFilteredBoard
    ? tasks.map((task) => task.id)
    : undefined;
  const columnDrop = useDroppable({
    id: `board-column:${boardSurfaceId}:${dateKey}`,
    type: "board-column",
    accept: acceptsBoardTaskDrag,
    collisionPriority: CollisionPriority.Low,
    data: {
      kind: "board-column",
      dateKey,
      insertionIndex: allTasks.length,
      insertionVisibleIndex: isFilteredBoard ? tasks.length : undefined,
      visibleTaskIds,
      boardSurfaceId,
      group,
    },
  });
  const taskBoardProps = (task, visibleIndex) => ({
    boardDateKey: dateKey,
    boardIndex: allTasks.findIndex((item) => item.id === task.id),
    boardSurfaceId,
    boardVisibleIndex: isFilteredBoard ? visibleIndex : undefined,
    boardVisibleTaskIds: visibleTaskIds,
  });

  return (
    <Element
      ref={columnDrop.ref}
      className={`${className} ${columnDrop.isDropTarget ? "board-drop-target" : ""}`.trim()}
      data-board-drop-zone="true"
      data-board-surface-id={boardSurfaceId}
      data-date-key={dateKey}
      {...props}
    >
      {typeof children === "function"
        ? children({ isFilteredBoard, taskBoardProps, visibleTaskIds })
        : children}
    </Element>
  );
}

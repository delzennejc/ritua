import { CollisionPriority } from "@dnd-kit/abstract";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import { useSortable } from "@dnd-kit/react/sortable";
import { ArrowsClockwise, CheckCircle } from "@phosphor-icons/react";
import { acceptsBoardTaskDrag, boardGroupId } from "../utils/board";
import { CALENDAR_DRAG_TYPE } from "../utils/calendar";
import { backlogDateLabel } from "../utils/dates";
import { recurrenceLabel } from "../../../../domain/recurrence";
import { FolderLabel } from "./FolderLabel";
import { SortableCollectionItem } from "./SortableCollection";

const BACKLOG_TASK_ACTION_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
].join(",");

function backlogTaskOpenProps(item, onOpen) {
  if (!onOpen) return {};

  return {
    "data-backlog-task-openable": "true",
    onClick: (event) => {
      if (event.defaultPrevented) return;
      const actionTarget = event.target?.closest?.(BACKLOG_TASK_ACTION_SELECTOR);
      if (
        actionTarget
        && actionTarget !== event.currentTarget
        && event.currentTarget.contains(actionTarget)
      ) return;

      const returnFocusElement = event.currentTarget.querySelector(
        "[data-task-title-id]",
      );
      onOpen(item, returnFocusElement || event.currentTarget);
    },
  };
}

function BacklogTaskContent({
  dragPreview,
  item,
  onOpen,
  onToggle,
  showArea,
  variant,
}) {
  const CompletionControl = dragPreview || !onToggle ? "span" : "button";
  return (
    <>
      <CompletionControl
        className={`backlog-completion-toggle ${item.complete ? "complete" : ""}`}
        type={CompletionControl === "button" ? "button" : undefined}
        aria-label={CompletionControl === "button"
          ? `Mark ${item.title} ${item.complete ? "incomplete" : "complete"}`
          : undefined}
        onClick={CompletionControl === "button" ? (event) => {
          event.stopPropagation();
          onToggle(item.id);
        } : undefined}
        onPointerDown={CompletionControl === "button" ? (event) => event.stopPropagation() : undefined}
      >
        <CheckCircle size={variant === "panel" ? 17 : 19} weight={item.complete ? "fill" : "regular"} />
      </CompletionControl>
      <span className="backlog-task-copy">
        {onOpen && !dragPreview ? (
          <button
            className="backlog-task-title"
            data-task-title-id={item.id}
            type="button"
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onOpen(item, event.currentTarget);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(item, event.currentTarget);
            }}
          >
            {item.title}
          </button>
        ) : (
          <span className="backlog-task-title">{item.title}</span>
        )}
        {item.recurrenceSeriesId ? (
          <span
            className="backlog-task-recurrence"
            role="img"
            aria-label={`Recurring task: ${recurrenceLabel(
              item.recurrence,
              item.recurrenceStartDateKey || item.scheduledDateKey,
            )}`}
            title={recurrenceLabel(
              item.recurrence,
              item.recurrenceStartDateKey || item.scheduledDateKey,
            )}
          >
            <ArrowsClockwise size={13} aria-hidden="true" />
          </span>
        ) : null}
      </span>
      {showArea ? (
        <FolderLabel channel={item.channel || "Ritua"} className="backlog-folder" />
      ) : null}
      {item.scheduledDateKey ? (
        <span className="backlog-task-date">
          {backlogDateLabel(item.scheduledDateKey)}
        </span>
      ) : null}
    </>
  );
}

function BoardBacklogTaskRow({
  boardDateKey,
  boardIndex,
  boardSurfaceId,
  boardVisibleIndex,
  boardVisibleTaskIds,
  children,
  className,
  item,
  layoutProps,
  openProps,
}) {
  const group = boardGroupId(boardSurfaceId, boardDateKey);
  const index = Number.isInteger(boardVisibleIndex) ? boardVisibleIndex : boardIndex;
  const sortable = useSortable({
    id: `board-task:${boardSurfaceId}:${item.id}`,
    group,
    index,
    type: CALENDAR_DRAG_TYPE,
    accept: acceptsBoardTaskDrag,
    collisionPriority: CollisionPriority.High,
    plugins: [SortableKeyboardPlugin],
    data: {
      kind: "board-task",
      dragType: CALENDAR_DRAG_TYPE,
      taskId: item.id,
      title: item.title,
      minutes: item.minutes,
      color: item.accent || "violet",
      time: item.time,
      durationLabel: item.durationLabel,
      channel: item.channel,
      sourceDateKey: boardDateKey,
      sourceIndex: boardIndex,
      sourceVisibleIndex: boardVisibleIndex,
      dateKey: boardDateKey,
      index: boardIndex,
      visibleIndex: boardVisibleIndex,
      visibleTaskIds: boardVisibleTaskIds,
      boardSurfaceId,
      group,
      pointerActivationDistance: 5,
      taskSnapshot: item,
    },
  });

  return (
    <div
      ref={sortable.ref}
      className={`${className} collection-sortable-item ${sortable.isDragging ? "dragging" : ""}`.trim()}
      data-board-task-id={item.id}
      data-dnd-drop-target={sortable.isDropTarget ? "true" : undefined}
      role="group"
      tabIndex={0}
      aria-label={`Drag ${item.title} to reorder, move to another day, schedule, or move to Tasks`}
      {...layoutProps}
      {...openProps}
    >
      {children}
    </div>
  );
}

export function BacklogTaskRow({
  boardDateKey,
  boardIndex,
  boardSurfaceId,
  boardVisibleIndex,
  boardVisibleTaskIds,
  collectionItem,
  dragPreview = false,
  item,
  onOpen,
  onToggle,
  showArea = true,
  variant = "main",
}) {
  const Element = variant === "panel" ? "li" : "div";
  const className = variant === "panel"
    ? `right-panel-backlog-row ${item.complete ? "complete" : ""}`
    : [
        "backlog-row",
        item.complete ? "complete" : "",
        item.scheduledDateKey ? "has-scheduled-date" : "",
        item.scheduledDateKey && showArea ? "with-area" : "",
      ].filter(Boolean).join(" ");
  const openProps = dragPreview ? {} : backlogTaskOpenProps(item, onOpen);
  const layoutProps = dragPreview ? {} : {
    "data-task-layout-complete": String(Boolean(item.complete)),
    "data-task-layout-id": item.id,
  };

  if (
    !dragPreview
    && boardDateKey
    && boardSurfaceId
    && Number.isInteger(boardIndex)
  ) {
    return (
      <BoardBacklogTaskRow
        boardDateKey={boardDateKey}
        boardIndex={boardIndex}
        boardSurfaceId={boardSurfaceId}
        boardVisibleIndex={boardVisibleIndex}
        boardVisibleTaskIds={boardVisibleTaskIds}
        className={className}
        item={item}
        layoutProps={layoutProps}
        openProps={openProps}
      >
        <BacklogTaskContent
          item={item}
          onOpen={onOpen}
          onToggle={onToggle}
          showArea={showArea}
          variant={variant}
        />
      </BoardBacklogTaskRow>
    );
  }

  if (dragPreview || !collectionItem) {
    return (
      <Element
        className={`${className} ${dragPreview ? "collection-drag-preview" : ""}`.trim()}
        {...layoutProps}
        {...openProps}
      >
        <BacklogTaskContent
          dragPreview={dragPreview}
          item={item}
          onOpen={onOpen}
          onToggle={onToggle}
          showArea={showArea}
          variant={variant}
        />
      </Element>
    );
  }

  return (
    <SortableCollectionItem
      as={Element}
      className={className}
      {...layoutProps}
      aria-label={variant === "panel"
        ? `Drag ${item.title} to reorder, move between task lists, or add to the board or calendar`
        : `Drag ${item.title} to reorder, move between horizons, areas, and projects, or add to the board or calendar`}
      role={variant === "panel" ? "listitem" : "group"}
      {...collectionItem}
      dragType={CALENDAR_DRAG_TYPE}
      externalDropData={{
        backlogTask: true,
        taskId: item.id,
      }}
      pointerActivationDistance={onOpen ? 5 : undefined}
      {...openProps}
    >
      <BacklogTaskContent
        item={item}
        onOpen={onOpen}
        onToggle={onToggle}
        showArea={showArea}
        variant={variant}
      />
    </SortableCollectionItem>
  );
}

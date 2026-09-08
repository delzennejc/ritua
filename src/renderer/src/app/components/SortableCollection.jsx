import { CollisionPriority } from "@dnd-kit/abstract";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";

const COLLECTION_DRAG_TYPE = "collection-item";
export const acceptsExternalTaskDrop = (source) => (
  source.data?.kind === "board-task"
  || source.data?.kind === "calendar-event"
);

const acceptsCollection = (collectionId, acceptExternalTaskDrop = false) => (source) => (
  (
    source.data?.kind === COLLECTION_DRAG_TYPE
    && source.data.collectionId === collectionId
  )
  || (
    acceptExternalTaskDrop
    && acceptsExternalTaskDrop(source)
  )
);

const collectionGroupId = (surfaceId, collectionId, laneId) => (
  `collection:${surfaceId}:${collectionId}:${laneId}`
);

export function SortableCollectionLane({
  as: Element = "div",
  axis = "vertical",
  children,
  className = "",
  collectionId,
  collectionSnapshot,
  acceptExternalTaskDrop = false,
  externalDropData,
  items,
  laneId,
  onMove,
  onRestore,
  surfaceId,
  ...props
}) {
  const group = collectionGroupId(surfaceId, collectionId, laneId);
  const droppable = useDroppable({
    id: `collection-lane:${surfaceId}:${collectionId}:${laneId}`,
    type: "collection-lane",
    accept: acceptsCollection(collectionId, acceptExternalTaskDrop),
    collisionPriority: CollisionPriority.Low,
    data: {
      kind: "collection-lane",
      collectionId,
      laneId,
      insertionIndex: items.length,
      surfaceId,
      group,
      ...externalDropData,
    },
  });
  const collectionItemProps = (item, index, preview = {}) => ({
    collectionId,
    collectionSnapshot,
    index,
    itemId: item.id,
    itemSnapshot: item,
    laneId,
    onMove,
    onRestore,
    preview,
    surfaceId,
    acceptExternalTaskDrop,
    targetDropData: externalDropData,
  });

  return (
    <Element
      ref={droppable.ref}
      className={`${className} ${droppable.isDropTarget ? "collection-drop-target" : ""}`.trim()}
      data-collection-axis={axis}
      data-collection-drop-zone="true"
      data-collection-id={collectionId}
      data-collection-lane-id={laneId}
      data-collection-length={items.length}
      data-collection-surface-id={surfaceId}
      data-backlog-drop-zone={externalDropData?.backlogDropTarget ? "true" : undefined}
      data-backlog-schedule-target={externalDropData?.backlogScheduleTarget ? "true" : undefined}
      data-backlog-group-label={externalDropData?.backlogGroupLabel}
      data-backlog-channel={externalDropData?.backlogChannel}
      data-backlog-contextual={externalDropData?.backlogContextual ? "true" : undefined}
      data-backlog-objective-id={externalDropData?.backlogObjectiveId || undefined}
      {...props}
    >
      {typeof children === "function"
        ? children({ collectionItemProps })
        : children}
    </Element>
  );
}

export function SortableCollectionDropProxy({
  as: Element = "div",
  acceptExternalTaskDrop = false,
  children,
  className = "",
  collectionId,
  externalDropData,
  insertionIndex = 0,
  laneId,
  lowPriority = false,
  proxyId = "proxy",
  surfaceId,
  ...props
}) {
  const group = collectionGroupId(surfaceId, collectionId, laneId);
  const droppable = useDroppable({
    id: `collection-proxy:${surfaceId}:${collectionId}:${laneId}:${proxyId}`,
    type: "collection-lane",
    accept: acceptsCollection(collectionId, acceptExternalTaskDrop),
    collisionPriority: lowPriority
      ? CollisionPriority.Lowest
      : CollisionPriority.Highest,
    data: {
      kind: "collection-lane",
      collectionId,
      laneId,
      insertionIndex,
      surfaceId,
      group,
      ...externalDropData,
    },
  });

  return (
    <Element
      ref={droppable.ref}
      className={`${className} ${droppable.isDropTarget ? "collection-drop-target" : ""}`.trim()}
      data-collection-drop-proxy="true"
      data-collection-id={collectionId}
      data-collection-insertion-index={insertionIndex}
      data-collection-lane-id={laneId}
      data-collection-surface-id={surfaceId}
      data-backlog-drop-zone={externalDropData?.backlogDropTarget ? "true" : undefined}
      data-backlog-schedule-target={externalDropData?.backlogScheduleTarget ? "true" : undefined}
      data-backlog-group-label={externalDropData?.backlogGroupLabel}
      data-backlog-channel={externalDropData?.backlogChannel}
      data-backlog-contextual={externalDropData?.backlogContextual ? "true" : undefined}
      data-backlog-objective-id={externalDropData?.backlogObjectiveId || undefined}
      {...props}
    >
      {children}
    </Element>
  );
}

export function SortableCollectionItem({
  as: Element = "div",
  acceptExternalTaskDrop = false,
  children,
  className = "",
  collectionId,
  collectionSnapshot,
  dragType = COLLECTION_DRAG_TYPE,
  externalDropData,
  index,
  itemId,
  itemSnapshot,
  laneId,
  onMove,
  onRestore,
  pointerActivationDistance,
  pointerActivatorSelector,
  preview,
  surfaceId,
  targetDropData,
  ...props
}) {
  const group = collectionGroupId(surfaceId, collectionId, laneId);
  const sortable = useSortable({
    id: `collection-item:${surfaceId}:${collectionId}:${itemId}`,
    group,
    index,
    type: dragType,
    accept: acceptsCollection(collectionId, acceptExternalTaskDrop),
    collisionPriority: CollisionPriority.High,
    plugins: [SortableKeyboardPlugin],
    data: {
      kind: COLLECTION_DRAG_TYPE,
      dragType,
      collectionId,
      collectionSnapshot,
      index,
      itemId,
      itemSnapshot,
      laneId,
      onMove,
      onRestore,
      pointerActivationDistance,
      pointerActivatorSelector,
      preview,
      sourceIndex: index,
      sourceLaneId: laneId,
      surfaceId,
      group,
      ...targetDropData,
      ...externalDropData,
    },
  });

  return (
    <Element
      ref={sortable.ref}
      className={`${className} collection-sortable-item ${sortable.isDragging ? "dragging" : ""}`.trim()}
      data-collection-id={collectionId}
      data-collection-index={index}
      data-collection-item-id={itemId}
      data-collection-lane-id={laneId}
      data-collection-surface-id={surfaceId}
      data-dnd-drop-target={sortable.isDropTarget ? "true" : undefined}
      tabIndex={0}
      {...props}
    >
      {typeof children === "function"
        ? children({
          handleRef: sortable.handleRef,
          isDragging: sortable.isDragging,
        })
        : children}
    </Element>
  );
}

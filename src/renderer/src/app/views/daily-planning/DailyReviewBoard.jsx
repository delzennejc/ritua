import { areaAccentForLabel } from '../../utils/workspace-presenters'
import { useLayoutEffect, useRef, useState } from 'react'
import { useDragDropMonitor } from '@dnd-kit/react'
import { CheckCircle } from '@phosphor-icons/react'
import { SortableCollectionLane } from '../../components/SortableCollection'
import { TaskCard } from '../../components/TaskCard'
import { FolderLabel } from '../../components/FolderLabel'
import { TaskActionConfirmation } from '../../components/TaskActionConfirmation'
import { useWorkspaceTaskActions } from '../../hooks/useWorkspaceTaskActions'
import { moveItemBetweenLanes } from '../../utils/collections'
import { pointerFromNativeEvent } from '../../interactions/drag-targets'
import { addDays, CURRENT_DATE_KEY } from '../../utils/dates'
import { toggleTaskSubtask } from '../../../desktop/workspace-actions'
import { updateDailyReviewTask } from '../../../desktop/daily-plan-actions'
import { reportActionError } from '../../../desktop/ActionErrors'

const laneId = (areaId, done) => JSON.stringify([areaId, done])

// Measure the content independently so removing the last card animates from the
// previous full height, rather than jumping to the empty-state height first.
function ReviewLaneCollapse({ expanded, dragging, children }) {
  const shellRef = useRef(null)
  const contentRef = useRef(null)
  const heightRef = useRef(null)
  useLayoutEffect(() => {
    const shell = shellRef.current
    const measure = () => {
      const contentHeight = contentRef.current.getBoundingClientRect().height
      const height = expanded
        ? dragging
          ? Math.max(heightRef.current || 0, contentHeight)
          : contentHeight
        : 0
      if (height === heightRef.current) return
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      shell.dataset.animating = String(heightRef.current !== null && !reducedMotion)
      shell.style.height = `${height}px`
      heightRef.current = height
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [expanded, dragging])
  return (
    <div
      className="daily-review-lane-collapse"
      ref={shellRef}
      data-expanded={expanded}
      aria-hidden={!expanded}
      inert={!expanded}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'height')
          event.currentTarget.dataset.animating = 'false'
      }}
    >
      <div ref={contentRef} className="daily-review-lane-content">
        {children}
      </div>
    </div>
  )
}

export function DailyReviewBoard({ tasks, areas, projects }) {
  const { onOpenTask, onAssignObjective, onQuickSchedule, onUnscheduleTask } = useWorkspaceTaskActions()
  const [dragging, setDragging] = useState(false)
  const [dragAreaId, setDragAreaId] = useState(null)
  const boardRef = useRef(null)
  const trackDragArea = ({ operation, nativeEvent }) => {
    if (operation.source?.data?.collectionId !== 'daily-review') return
    const pointer = pointerFromNativeEvent(nativeEvent) || operation.position.current
    const column = [...(boardRef.current?.querySelectorAll('[data-review-area-id]') || [])].find((node) => {
      const rect = node.getBoundingClientRect()
      return (
        pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom
      )
    })
    setDragAreaId(column?.dataset.reviewAreaId || null)
  }
  useDragDropMonitor({
    onDragStart(event) {
      if (event.operation.source?.data?.collectionId !== 'daily-review') return
      setDragging(true)
      trackDragArea(event)
    },
    onDragMove: trackDragArea,
    onDragOver: trackDragArea,
    onDragEnd() {
      setDragging(false)
      setDragAreaId(null)
    },
  })
  const [preview, setPreview] = useState(null)
  const previewRef = useRef(null)
  const [pendingMove, setPendingMove] = useState(null)
  const knownAreas = useRef(new Set())
  const [announcement, setAnnouncement] = useState('')
  const yesterday = addDays(CURRENT_DATE_KEY, -1)
  // Keep an emptied column available as a destination for the rest of this review.
  for (const area of areas)
    if (tasks.some((task) => task.channel === area.label)) knownAreas.current.add(area.id)
  const visibleAreas = areas.filter((area) => knownAreas.current.has(area.id))
  const lanes = Object.fromEntries(
    visibleAreas.flatMap((area) =>
      [false, true].map((done) => [
        laneId(area.id, done),
        tasks.filter((task) => task.channel === area.label && Boolean(task.complete) === done),
      ]),
    ),
  )
  const displayedLanes = preview || lanes
  const clearPreview = () => {
    previewRef.current = null
    setPreview(null)
  }
  const apply = (move) => {
    try {
      updateDailyReviewTask(move)
      setAnnouncement('Yesterday’s review updated.')
      requestAnimationFrame(() => {
        const card = [...(boardRef.current?.querySelectorAll('[data-collection-item-id]') || [])].find(
          (node) => node.dataset.collectionItemId === move.taskId,
        )
        card?.focus({ preventScroll: true })
      })
    } catch (error) {
      reportActionError(error.message)
    }
  }
  const commit = () => {
    const projected = previewRef.current
    clearPreview()
    if (!projected) return
    const move = projected.move
    const items = projected.lanes[move.targetLaneId] || []
    const [areaId, complete] = JSON.parse(move.targetLaneId)
    const index = items.findIndex((task) => task.id === move.itemId)
    const command = { taskId: move.itemId, areaId, complete, beforeTaskId: items[index + 1]?.id }
    const task = tasks.find((item) => item.id === move.itemId)
    const area = areas.find((item) => item.id === areaId)
    command.accent = areaAccentForLabel(area?.label, areas)
    const project = projects.find((item) => item.id === task?.objectiveId)
    if (project && project.channel !== area?.label) setPendingMove({ command, area, project })
    else apply(command)
  }
  const move = (operation) => {
    const next = moveItemBetweenLanes({ lanes: previewRef.current?.lanes || lanes, ...operation })
    previewRef.current = { lanes: next, move: operation }
    setPreview(next)
  }
  return (
    <section className="daily-review-completed" aria-label="Yesterday’s tasks" ref={boardRef} tabIndex={-1}>
      {tasks.length || visibleAreas.length ? (
        <div className="daily-review-groups">
          {visibleAreas.map((area) => (
            <section
              className="daily-review-area"
              key={area.id}
              data-review-area-id={area.id}
              aria-label={`${area.label} yesterday`}
            >
              <h3>
                <FolderLabel channel={area.label} />
              </h3>
              {[false, true].map((done) => {
                const id = laneId(area.id, done)
                const items = displayedLanes[id] || []
                const expanded = done || items.length > 0 || (dragging && dragAreaId === String(area.id))
                const lane = (
                  <SortableCollectionLane
                    disabled={!expanded}
                    className="daily-review-lane"
                    aria-label={`${area.label} ${done ? 'Done' : 'To review'}`}
                    collectionId="daily-review"
                    surfaceId="daily-review"
                    laneId={id}
                    items={items}
                    collectionSnapshot={lanes}
                    onMove={move}
                    onRestore={clearPreview}
                    onCommit={commit}
                  >
                    {({ collectionItemProps }) => (
                      <>
                        <h4>
                          {done ? 'Done' : 'To review'} <span>{items.length}</span>
                        </h4>
                        <div className="task-stack">
                          {items.map((task, index) => (
                            <TaskCard
                              key={task.id}
                              task={preview ? { ...task, channel: area.label, complete: done } : task}
                              projects={projects}
                              collectionItem={collectionItemProps(task, index)}
                              onToggle={() => apply({ taskId: task.id, complete: !task.complete })}
                              onToggleSubtask={toggleTaskSubtask}
                              onAssignObjective={onAssignObjective}
                              onSchedule={(source) => onQuickSchedule(task, yesterday, source)}
                              onUnschedule={onUnscheduleTask}
                              onOpen={onOpenTask}
                            />
                          ))}
                          {!items.length ? (
                            <p className="daily-review-drop-hint">
                              {done ? 'Drop completed tasks here' : 'Drop tasks here to reopen'}
                            </p>
                          ) : null}
                        </div>
                      </>
                    )}
                  </SortableCollectionLane>
                )
                return done ? (
                  <div key={id}>{lane}</div>
                ) : (
                  <ReviewLaneCollapse key={id} expanded={expanded} dragging={dragging}>
                    {lane}
                  </ReviewLaneCollapse>
                )
              })}
            </section>
          ))}
        </div>
      ) : (
        <div className="daily-empty">
          <CheckCircle size={26} aria-hidden="true" />
          <p>No tasks to review from yesterday.</p>
          <span>You can start fresh with today’s plan.</span>
        </div>
      )}
      {pendingMove ? (
        <TaskActionConfirmation
          id="daily-review-area-confirm"
          triggerRef={boardRef}
          title={`Move to ${pendingMove.area.label}?`}
          description={
            <>
              This will remove the task from the <strong>{pendingMove.project.title}</strong> Project.
            </>
          }
          confirmLabel="Move"
          onClose={(restoreFocus) => {
            setPendingMove(null)
            if (restoreFocus) boardRef.current?.focus()
          }}
          onConfirm={() => apply({ ...pendingMove.command, unlinkFromProject: true })}
        />
      ) : null}
      <span className="daily-announcement" role="status">
        {announcement}
      </span>
    </section>
  )
}

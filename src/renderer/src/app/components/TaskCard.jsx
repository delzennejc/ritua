import { ChoiceDropdown } from './Dropdown'
import { useId } from 'react'
import { CollisionPriority } from '@dnd-kit/abstract'
import { SortableKeyboardPlugin } from '@dnd-kit/dom/sortable'
import {
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  CalendarCheck,
  CalendarPlus,
  CheckCircle,
  PushPin,
} from '@phosphor-icons/react'
import { useDraggable } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { acceptsBoardTaskDrag, boardGroupId } from '../utils/board'
import { CALENDAR_DRAG_TYPE } from '../utils/calendar'
import { minutesLabel, timeLabel } from '../utils/time'
import { recurrenceLabel } from '../../../../domain/recurrence'
import { FolderLabel, useAreaColor } from './FolderLabel'
import { SortableCollectionItem } from './SortableCollection'
import { TaskAreaAction } from './TaskAreaAction'
import { TaskScheduleAction } from './TaskScheduleAction'
import { useCalendarSessions } from './session-context'
import { useTaskContextMenu } from './TaskContextMenu'
import { TaskStatusAction } from './TaskStatusAction'
import { CURRENT_DATE_KEY } from '../utils/dates'

const TASK_CARD_ACTION_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
  '[data-task-card-action]',
].join(',')

const taskLayoutProps = (task) => ({
  'data-task-layout-complete': String(Boolean(task.complete)),
  'data-task-layout-id': task.id,
})

function taskCardOpenProps(task, onOpen) {
  if (!onOpen) return {}

  return {
    'data-task-card-openable': 'true',
    onClick: (event) => {
      if (event.defaultPrevented) return

      const actionTarget = event.target?.closest?.(TASK_CARD_ACTION_SELECTOR)
      if (actionTarget && actionTarget !== event.currentTarget && event.currentTarget.contains(actionTarget))
        return

      const returnFocusElement = event.currentTarget.querySelector('[data-task-title-id]')
      onOpen(task, returnFocusElement || event.currentTarget)
    },
  }
}

function DraggableTaskCard({ task, className, contextMenuProps, previewOptions, children, openProps }) {
  const instanceId = useId()
  const draggable = useDraggable({
    id: `task:${instanceId}:${task.id}`,
    type: CALENDAR_DRAG_TYPE,
    data: {
      kind: 'task',
      dragType: CALENDAR_DRAG_TYPE,
      taskId: task.id,
      title: task.title,
      minutes: task.minutes,
      color: task.accent || 'violet',
      time: task.time,
      durationLabel: task.durationLabel,
      channel: task.channel,
      taskSnapshot: task,
      previewOptions,
    },
  })

  return (
    <article
      ref={draggable.ref}
      className={`${className} task-card-draggable ${draggable.isDragging ? 'dragging' : ''}`}
      {...taskLayoutProps(task)}
      role="group"
      tabIndex={0}
      aria-label={`Drag ${task.title} to calendar`}
      {...openProps}
      {...contextMenuProps}
    >
      {children()}
    </article>
  )
}

function BoardDraggableTaskCard({
  task,
  className,
  boardDateKey,
  boardIndex,
  boardSurfaceId,
  todayStatus,
  boardGroup,
  boardVisibleIndex,
  boardVisibleTaskIds,
  contextMenuProps,
  previewOptions,
  children,
  openProps,
}) {
  const group = boardGroup || boardGroupId(boardSurfaceId, boardDateKey)
  const sortIndex = Number.isInteger(boardVisibleIndex) ? boardVisibleIndex : boardIndex
  const sortable = useSortable({
    id: `board-task:${boardSurfaceId}:${task.id}`,
    group,
    index: sortIndex,
    type: CALENDAR_DRAG_TYPE,
    accept: acceptsBoardTaskDrag,
    collisionPriority: CollisionPriority.High,
    plugins: [SortableKeyboardPlugin],
    data: {
      kind: 'board-task',
      dragType: CALENDAR_DRAG_TYPE,
      taskId: task.id,
      title: task.title,
      minutes: task.minutes,
      color: task.accent || 'violet',
      time: task.time,
      durationLabel: task.durationLabel,
      channel: task.channel,
      sourceDateKey: boardDateKey,
      sourceIndex: boardIndex,
      sourceVisibleIndex: boardVisibleIndex,
      dateKey: boardDateKey,
      index: boardIndex,
      visibleIndex: boardVisibleIndex,
      visibleTaskIds: boardVisibleTaskIds,
      boardSurfaceId,
      todayStatus,
      group,
      taskSnapshot: task,
      previewOptions,
    },
  })

  return (
    <article
      ref={sortable.ref}
      className={`${className} task-card-draggable ${sortable.isDragging ? 'dragging' : ''}`}
      {...taskLayoutProps(task)}
      data-board-task-id={task.id}
      data-today-status={todayStatus}
      data-dnd-drop-target={sortable.isDropTarget ? 'true' : undefined}
      role="group"
      tabIndex={0}
      aria-label={
        todayStatus
          ? `Drag ${task.title} to reorder in ${todayStatus}, move to another Today board, schedule, or move to Tasks`
          : `Drag ${task.title} to reorder, move to another day, schedule, or move to Tasks`
      }
      {...openProps}
      {...contextMenuProps}
    >
      {children()}
    </article>
  )
}

export function TaskCard({
  task,
  projects = [],
  onToggle,
  onToggleSubtask,
  onAssignObjective,
  onSchedule,
  onUnschedule,
  compact = false,
  onOpen,
  orderControls,
  onMove,
  boardDateKey,
  boardIndex,
  boardSurfaceId,
  todayStatus,
  boardGroup,
  boardVisibleIndex,
  boardVisibleTaskIds,
  collectionItem,
  dragPreview = false,
  showAssignObjective,
  showSchedule,
  showOrderControls,
  showWorkflowStatus = true,
}) {
  const hasSubtasks = Boolean(task.subtasks?.length)
  const sessions = useCalendarSessions()?.taskSessions.get(task.id) || []
  const session =
    sessions.find((session) => session.dateKey === (boardDateKey || task.scheduledDateKey)) || sessions[0]
  const scheduled = Boolean(task.time || session)
  const displayTime = session ? `${timeLabel(session.start)}-${timeLabel(session.end)}` : task.time
  const sessionTitle = session ? Array.from(session.title) : []
  const sessionLabel = sessionTitle.length > 20 ? `${sessionTitle.slice(0, 19).join('')}…` : session?.title
  const durationLabel = task.minutes > 0 ? task.durationLabel || minutesLabel(task.minutes) : null
  const className = `task-card ${displayTime ? 'has-time' : 'no-time'} ${task.complete ? 'complete' : ''} ${hasSubtasks ? 'has-subtasks' : ''} ${compact ? 'compact' : ''} ${task.id === 'review' ? 'tall' : ''} ${task.id === 'before' ? 'history' : ''} ${task.id === 'main' ? 'main-card' : ''}`
  const isBoardTask = Boolean(boardDateKey && boardSurfaceId && Number.isInteger(boardIndex))
  const canAssignObjective = showAssignObjective ?? Boolean(onAssignObjective)
  const hasOrderControls = showOrderControls ?? Boolean(orderControls)
  const taskArea = task.channel
  const areaProjects = projects.filter(
    (project) => project.channel === taskArea && (!project.complete || project.id === task.objectiveId),
  )
  const currentProject = projects.find((project) => project.id === task.objectiveId)
  const projectColor = useAreaColor(currentProject?.channel || taskArea)
  const openProps = taskCardOpenProps(task, onOpen)
  const contextMenuProps = useTaskContextMenu(task, { disabled: dragPreview })
  const previewOptions = {
    compact,
    showAssignObjective: canAssignObjective,
    showSchedule: showSchedule ?? Boolean(onSchedule || onUnschedule),
    showOrderControls: hasOrderControls,
  }
  const renderContent = () => (
    <>
      {displayTime ? (
        <div className="task-card-topline">
          <span className={`time-chip ${task.accent || 'violet'}`}>{displayTime}</span>
          {session ? (
            <span className="task-session-name" title={session.title}>
              {sessionLabel}
            </span>
          ) : durationLabel ? (
            <span className="duration-chip">{durationLabel}</span>
          ) : null}
        </div>
      ) : null}
      {onOpen ? (
        <button
          className="task-title"
          data-task-title-id={task.id}
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onOpen(task, event.currentTarget)
          }}
          onClick={(event) => {
            event.stopPropagation()
            onOpen(task, event.currentTarget)
          }}
        >
          {task.title}
        </button>
      ) : (
        <span className="task-title">{task.title}</span>
      )}
      {hasSubtasks ? (
        <ul className="task-subtasks">
          {task.subtasks.map((subtask) => (
            <li className={subtask.complete ? 'complete' : ''} key={subtask.id}>
              <button
                className="icon-button subtask-toggle"
                aria-label={
                  subtask.complete ? `Mark ${subtask.title} incomplete` : `Mark ${subtask.title} complete`
                }
                onClick={() => onToggleSubtask?.(task.id, subtask.id)}
              >
                <CheckCircle size={16} weight={subtask.complete ? 'fill' : 'regular'} />
              </button>
              <span className="subtask-title">{subtask.title}</span>
              <span className="subtask-duration">{minutesLabel(subtask.minutes)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="task-meta">
        <button
          className="icon-button small completion-toggle"
          aria-label={task.complete ? 'Mark incomplete' : 'Mark complete'}
          onClick={() => onToggle?.(task.id)}
        >
          <CheckCircle size={19} weight={task.complete ? 'fill' : 'regular'} />
        </button>
        {task.recurrenceSeriesId ? (
          <span
            className="task-recurrence-indicator"
            role="img"
            aria-label={recurrenceLabel(task.recurrence, task.recurrenceStartDateKey)}
            title={recurrenceLabel(task.recurrence, task.recurrenceStartDateKey)}
          >
            <ArrowsClockwise size={14} aria-hidden="true" />
          </span>
        ) : null}
        {!dragPreview &&
        !todayStatus &&
        showWorkflowStatus &&
        (boardDateKey || task.scheduledDateKey) === CURRENT_DATE_KEY ? (
          <TaskStatusAction task={task} />
        ) : null}
        {onAssignObjective ? (
          <span
            className={`task-objective-picker ${task.objectiveId ? 'linked' : 'task-objective-action'}`}
            style={task.objectiveId ? { '--project-color': projectColor } : undefined}
            title={currentProject?.title || `Choose a project in ${taskArea}`}
          >
            <ChoiceDropdown
              label={`Project for ${task.title}`}
              className="project-icon-dropdown"
              trigger={<PushPin mirrored size={14} aria-hidden="true" />}
              value={task.objectiveId || ''}
              onChange={(value) => onAssignObjective(task, value || null)}
              options={[
                { value: '', label: areaProjects.length ? 'No project' : `No projects in ${taskArea}` },
                ...areaProjects.map((project) => ({
                  value: project.id,
                  label: project.title,
                  disabled: project.complete,
                  icon: <PushPin mirrored size={15} />,
                })),
              ]}
            />
          </span>
        ) : task.objectiveId ? (
          <span
            className="task-objective-indicator"
            style={{ '--project-color': projectColor }}
            role="img"
            aria-label="Linked to a project"
            title={currentProject?.title || 'Linked to a project'}
          >
            <PushPin mirrored size={14} aria-hidden="true" />
          </span>
        ) : canAssignObjective ? (
          <span className="task-objective-picker task-objective-action" aria-hidden="true">
            <PushPin mirrored size={14} />
          </span>
        ) : null}
        {(onSchedule || onUnschedule || showSchedule) && (scheduled || !task.complete) ? (
          dragPreview ? (
            <span
              className={`icon-button small task-auto-schedule${scheduled ? ' scheduled' : ''}`}
              aria-hidden="true"
            >
              {scheduled ? <CalendarCheck size={14} /> : <CalendarPlus size={14} />}
            </span>
          ) : (
            <TaskScheduleAction task={task} onSchedule={onSchedule} onUnschedule={onUnschedule} />
          )
        ) : null}
        {!task.time && durationLabel ? (
          <span
            className="duration-chip task-estimate"
            title={`Planned duration: ${minutesLabel(task.minutes)}`}
          >
            {durationLabel}
          </span>
        ) : null}
        {dragPreview ? (
          <FolderLabel channel={task.channel} className="task-folder" />
        ) : (
          <TaskAreaAction task={task} />
        )}
        {hasOrderControls ? (
          <span className="order-controls">
            <button className="icon-button small" onClick={() => onMove?.(-1)} aria-label="Move task up">
              <ArrowUp size={13} />
            </button>
            <button className="icon-button small" onClick={() => onMove?.(1)} aria-label="Move task down">
              <ArrowDown size={13} />
            </button>
          </span>
        ) : null}
      </div>
    </>
  )

  if (dragPreview) {
    return (
      <article className={`${className} dnd-task-card-preview`} aria-hidden="true">
        {renderContent()}
      </article>
    )
  }

  if (collectionItem) {
    return (
      <SortableCollectionItem
        as="article"
        className={className}
        {...taskLayoutProps(task)}
        aria-label={`Drag ${task.title} to reorder or move to another list`}
        {...collectionItem}
        itemSnapshot={task}
        preview={{ type: 'task', options: previewOptions }}
        {...openProps}
        {...contextMenuProps}
      >
        {() => renderContent()}
      </SortableCollectionItem>
    )
  }

  if (isBoardTask) {
    return (
      <BoardDraggableTaskCard
        task={task}
        className={className}
        boardDateKey={boardDateKey}
        boardIndex={boardIndex}
        boardSurfaceId={boardSurfaceId}
        todayStatus={todayStatus}
        boardGroup={boardGroup}
        boardVisibleIndex={boardVisibleIndex}
        boardVisibleTaskIds={boardVisibleTaskIds}
        previewOptions={previewOptions}
        openProps={openProps}
        contextMenuProps={contextMenuProps}
      >
        {() => renderContent()}
      </BoardDraggableTaskCard>
    )
  }

  if (task.complete) {
    return (
      <article className={className} {...taskLayoutProps(task)} {...openProps} {...contextMenuProps}>
        {renderContent()}
      </article>
    )
  }
  return (
    <DraggableTaskCard
      task={task}
      className={className}
      previewOptions={previewOptions}
      openProps={openProps}
      contextMenuProps={contextMenuProps}
    >
      {() => renderContent()}
    </DraggableTaskCard>
  )
}

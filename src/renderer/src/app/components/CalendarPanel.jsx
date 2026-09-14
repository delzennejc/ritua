import { sessionAtPointer, sessionDragTaskId } from '../utils/session-drag'
import { DEFAULT_SESSION_MINUTES, calendarCompletionTasks } from '../../../../domain/calendar-sessions'
import { SessionChecklist } from './CalendarSessions'
import { useCalendarSessions } from './session-context'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { useDragDropMonitor, useDraggable, useDroppable } from '@dnd-kit/react'
import { ArrowsClockwise, Check } from '@phosphor-icons/react'
import { DEFAULT_AREAS } from '../../../../domain/workspace-defaults'
import {
  CALENDAR_DAY_MINUTES,
  CALENDAR_DRAG_TYPE,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_MIN_EVENT_MINUTES,
  CALENDAR_SNAP_MINUTES,
  calendarEndAfterResize,
  calendarStartAfterMove,
  calendarStartAtPointer,
  clampCalendarEnd,
  groupTaskCompletions,
  layoutCalendarEvents,
  snapCalendarMinutes,
} from '../utils/calendar'
import { CURRENT_DATE_KEY, dateFromKey } from '../utils/dates'
import { currentDayMinute, minutesLabel, timeLabel } from '../utils/time'
import { TaskComposer } from './TaskComposer'
import { ShutdownMarker } from './ShutdownMarker'
import { useAutoSchedule } from './AutoScheduleAnimation'

const syncedDurationLabel = (task, minutes) => {
  if (!task.durationLabel) return task.durationLabel
  const nextLabel = minutesLabel(minutes)
  if (!task.durationLabel.includes('/')) return nextLabel

  const [previousActual] = task.durationLabel.split('/')
  const actualLabel =
    task.actualMinutes !== undefined ? minutesLabel(task.actualMinutes) : previousActual.trim()
  return `${actualLabel} / ${nextLabel}`
}

const CALENDAR_EDITOR_VIEWPORT_GUTTER = 18
const CALENDAR_EDITOR_FALLBACK_HEIGHT = 360
const CALENDAR_DROP_PREVIEW_ID = 'calendar-drop-preview'
const CALENDAR_EVENT_SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event, source) => {
      if (event.pointerType === 'mouse') {
        return [new PointerActivationConstraints.Distance({ value: 5 })]
      }

      const defaultConstraints = PointerSensor.defaults.activationConstraints
      return typeof defaultConstraints === 'function' ? defaultConstraints(event, source) : defaultConstraints
    },
  }),
  KeyboardSensor,
]

const pointerFromDragEvent = ({ nativeEvent, operation }) => {
  if (Number.isFinite(nativeEvent?.clientX) && Number.isFinite(nativeEvent?.clientY)) {
    return { x: nativeEvent.clientX, y: nativeEvent.clientY }
  }

  const position = operation.position.current
  return Number.isFinite(position?.x) && Number.isFinite(position?.y)
    ? { x: position.x, y: position.y }
    : null
}

const calendarDropTaskFromSource = (sourceData) => {
  if (!sourceData || sourceData.dragType !== CALENDAR_DRAG_TYPE) return null

  if (sourceData.kind === 'calendar-event') {
    return {
      taskId: sourceData.eventId,
      title: sourceData.title,
      duration: Math.max(sourceData.end - sourceData.start, CALENDAR_MIN_EVENT_MINUTES),
    }
  }

  if (sourceData.kind === 'task' || sourceData.kind === 'board-task') {
    return {
      taskId: sourceData.taskId,
      title: sourceData.title,
      duration: Math.max(Number.isFinite(sourceData.minutes) ? sourceData.minutes : 0, 30),
    }
  }

  if (sourceData.kind === 'collection-item' && sourceData.backlogTask) {
    const task = sourceData.itemSnapshot
    return {
      taskId: sourceData.taskId || task?.id,
      title: task?.title || sourceData.title,
      duration: Math.max(Number.isFinite(task?.minutes) ? task.minutes : 0, 30),
    }
  }

  return null
}

const calendarDropPreviewForSample = ({
  operation,
  pointer,
  sourceData,
  timelineElement,
  timelineViewportElement,
  timelineScrollTop,
}) => {
  const task = calendarDropTaskFromSource(sourceData)
  if (!task || !pointer || !timelineElement || !timelineViewportElement) return null

  const timelineRect = timelineElement.getBoundingClientRect()
  const viewportRect = timelineViewportElement.getBoundingClientRect()
  const pointerIsInside =
    pointer.x >= Math.max(timelineRect.left, viewportRect.left) &&
    pointer.x <= Math.min(timelineRect.right, viewportRect.right) &&
    pointer.y >= Math.max(timelineRect.top, viewportRect.top) &&
    pointer.y <= Math.min(timelineRect.bottom, viewportRect.bottom)
  if (!pointerIsInside) return null

  let start
  if (sourceData.kind === 'calendar-event') {
    const initialY = operation.position.initial?.y
    if (!Number.isFinite(initialY)) return null
    start = calendarStartAfterMove({
      start: sourceData.start,
      duration: task.duration,
      deltaY: pointer.y - initialY,
      scrollDelta: timelineScrollTop - (sourceData.dragStartScrollTopRef?.current || 0),
    })
  } else {
    start = calendarStartAtPointer({
      pointerY: pointer.y,
      timelineTop: timelineRect.top,
      duration: task.duration,
    })
  }

  return {
    ...task,
    start,
    end: start + task.duration,
  }
}

const sameCalendarDropPreview = (current, next) =>
  current?.taskId === next?.taskId &&
  current?.title === next?.title &&
  current?.start === next?.start &&
  current?.end === next?.end

function CompletionMarker({ completedAtMinute, tasks, positionForMinutes }) {
  const markerRef = useRef(null)
  const tooltipId = useId()
  const [tooltipPosition, setTooltipPosition] = useState(null)
  const tooltipOpen = Boolean(tooltipPosition)

  const updateTooltipPosition = useCallback(() => {
    const markerRect = markerRef.current?.getBoundingClientRect()
    if (!markerRect) return

    setTooltipPosition({
      right: window.innerWidth - markerRect.left + 8,
      top: markerRect.top + markerRect.height / 2,
    })
  }, [])

  useLayoutEffect(() => {
    if (!tooltipOpen) return undefined

    updateTooltipPosition()
    window.addEventListener('resize', updateTooltipPosition)
    window.addEventListener('scroll', updateTooltipPosition, true)
    return () => {
      window.removeEventListener('resize', updateTooltipPosition)
      window.removeEventListener('scroll', updateTooltipPosition, true)
    }
  }, [tooltipOpen, updateTooltipPosition])

  const showTooltip = () => updateTooltipPosition()
  const hideTooltip = () => setTooltipPosition(null)
  const taskCount = tasks.filter((task) => task.completionKind !== 'subtask').length
  const subtaskCount = tasks.length - taskCount
  const isSubtaskOnly = taskCount === 0
  const completionCountLabel = [
    taskCount ? `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}` : null,
    subtaskCount ? `${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'}` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const completedAtLabel = timeLabel(completedAtMinute)

  return (
    <>
      <button
        ref={markerRef}
        className={`completion-marker ${isSubtaskOnly ? 'subtask' : ''}`}
        type="button"
        style={{ top: positionForMinutes(completedAtMinute) }}
        aria-label={`${completionCountLabel} completed at ${completedAtLabel}`}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        <Check size={isSubtaskOnly ? 7 : 8} weight="bold" aria-hidden="true" />
      </button>
      {tooltipPosition
        ? createPortal(
            <div className="completion-tooltip" id={tooltipId} role="tooltip" style={tooltipPosition}>
              <strong>Completed at {completedAtLabel}</strong>
              <ul>
                {tasks.map((task) => (
                  <li key={task.completionKey || task.id}>
                    {task.title}
                    {task.completionKind === 'subtask' ? ` · ${task.parentTitle}` : ''}
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function CalendarSessionEditor({ areas, draft, dateKey, panelRect, onChange, onCancel, onSave }) {
  const editorRef = useRef(null)
  const titleRef = useRef(null)
  const [editorHeight, setEditorHeight] = useState(CALENDAR_EDITOR_FALLBACK_HEIGHT)
  const [scheduleError, setScheduleError] = useState('')
  const isWeekCalendar = panelRect.layout === 'week-calendar'
  const availableWidth = isWeekCalendar
    ? window.innerWidth - CALENDAR_EDITOR_VIEWPORT_GUTTER * 2
    : Math.max(300, panelRect.left - 36)
  const width = Math.min(440, availableWidth)
  const rightSideLeft = panelRect.anchorRight + 16
  const weekCalendarLeft =
    rightSideLeft + width <= window.innerWidth - CALENDAR_EDITOR_VIEWPORT_GUTTER
      ? rightSideLeft
      : Math.max(CALENDAR_EDITOR_VIEWPORT_GUTTER, panelRect.anchorLeft - width - 16)
  const maximumTop = Math.max(
    CALENDAR_EDITOR_VIEWPORT_GUTTER,
    window.innerHeight - editorHeight - CALENDAR_EDITOR_VIEWPORT_GUTTER,
  )
  const desiredTop = panelRect.selectionTop ?? panelRect.top + CALENDAR_EDITOR_VIEWPORT_GUTTER
  const editorStyle = {
    left: `${
      isWeekCalendar
        ? weekCalendarLeft
        : Math.max(CALENDAR_EDITOR_VIEWPORT_GUTTER, panelRect.left - width - 16)
    }px`,
    top: `${Math.max(CALENDAR_EDITOR_VIEWPORT_GUTTER, Math.min(desiredTop, maximumTop))}px`,
    width: `${width}px`,
  }
  const scrimStyle = {
    right: isWeekCalendar ? '0px' : `${Math.max(0, window.innerWidth - panelRect.left)}px`,
  }

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return undefined
    const measure = () => {
      const measuredHeight = editor.getBoundingClientRect().height
      setEditorHeight((current) =>
        measuredHeight && Math.abs(measuredHeight - current) > 0.5 ? measuredHeight : current,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(editor)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    titleRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
      if (event.key !== 'Tab' || !editorRef.current) return

      const focusable = Array.from(editorRef.current.querySelectorAll('input, select, button'))
      const firstFocusable = focusable[0]
      const lastFocusable = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault()
        lastFocusable?.focus()
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault()
        firstFocusable?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  const submit = (event) => {
    event.preventDefault()
    if (!draft.title.trim()) return
    if (draft.end - draft.start < CALENDAR_MIN_EVENT_MINUTES) {
      setScheduleError('Choose a session lasting at least 15 minutes.')
      return
    }
    setScheduleError('')
    onSave()
  }

  return createPortal(
    <>
      <div
        className="calendar-task-editor-dismiss"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
      >
        <div className="calendar-task-editor-scrim" style={scrimStyle} />
      </div>
      <TaskComposer
        areas={areas}
        entityLabel="Session"
        ariaLabel="Create a session from this calendar time"
        className="calendar-task-editor"
        dateKey={draft.dateKey || dateKey}
        end={draft.end}
        error={scheduleError}
        formRef={editorRef}
        helper={`${CALENDAR_SNAP_MINUTES}-minute calendar precision`}
        onCancel={onCancel}
        onDateChange={(nextDateKey) => onChange({ dateKey: nextDateKey })}
        onEndChange={(nextEnd) => {
          setScheduleError('')
          onChange({ end: nextEnd === 0 && draft.start > 0 ? 24 * 60 : nextEnd })
        }}
        onStartChange={(nextStart) => {
          setScheduleError('')
          onChange({
            start: nextStart,
            end: Math.min(24 * 60, Math.max(draft.end, nextStart + 15)),
          })
        }}
        onSubmit={submit}
        onTitleChange={(title) => onChange({ title })}
        start={draft.start}
        style={editorStyle}
        submitLabel="Create session"
        title={draft.title}
        titleInputRef={titleRef}
      />
    </>,
    document.body,
  )
}

function CalendarEvent({
  dropActive = false,
  removing = false,
  calendarEvent,
  column,
  columnCount,
  columnSpan,
  dateKey,
  currentMinute,
  onOpenTask,
  setEvents,

  task,
  timelineScrollRef,
  positionForMinutes,
  heightForMinutes,
}) {
  const { openSession, taskMap } = useCalendarSessions()
  const isSession = calendarEvent.kind === 'session'
  const sessionTasks = isSession
    ? (calendarEvent.taskIds || []).map((id) => taskMap.get(id)).filter(Boolean)
    : []
  const completedCount = sessionTasks.filter((task) => task.complete).length
  const dragStartScrollTopRef = useRef(0)
  const pointerStartRef = useRef(null)
  const [resizePreview, setResizePreview] = useState(null)
  const eventDateKey = calendarEvent.dateKey || CURRENT_DATE_KEY
  const isCompletedPastSession =
    isSession &&
    sessionTasks.length > 0 &&
    completedCount === sessionTasks.length &&
    (eventDateKey < CURRENT_DATE_KEY ||
      (eventDateKey === CURRENT_DATE_KEY && calendarEvent.end <= currentMinute))
  const autoSchedule = useAutoSchedule()
  const updateResizePreview = useCallback(
    (deltaY) => {
      if (deltaY === null) {
        setResizePreview(null)
        return
      }

      setResizePreview({
        deltaY,
        scrollTop: timelineScrollRef.current?.scrollTop || 0,
      })
    },
    [timelineScrollRef],
  )
  const resizeDraggable = useDraggable({
    disabled: removing,
    id: `calendar-resize:${eventDateKey}:${calendarEvent.id}`,
    type: CALENDAR_DRAG_TYPE,
    data: {
      kind: 'calendar-resize',
      dragType: CALENDAR_DRAG_TYPE,
      eventId: calendarEvent.id,
      session: isSession,
      dateKey: eventDateKey,
      title: calendarEvent.title,
      color: calendarEvent.color,
      start: calendarEvent.start,
      end: calendarEvent.end,
      timelineScrollRef,
      dragStartScrollTopRef,
      onResizePreview: updateResizePreview,
    },
  })
  const draggable = useDraggable({
    id: `calendar-event:${eventDateKey}:${calendarEvent.id}`,
    type: CALENDAR_DRAG_TYPE,
    sensors: CALENDAR_EVENT_SENSORS,
    data: {
      kind: 'calendar-event',
      dragType: CALENDAR_DRAG_TYPE,
      eventId: calendarEvent.id,
      session: isSession,
      dateKey: eventDateKey,
      title: calendarEvent.title,
      color: calendarEvent.color,
      start: calendarEvent.start,
      end: calendarEvent.end,
      timelineScrollRef,
      dragStartScrollTopRef,
      taskSnapshot: task,
    },
    disabled: removing || resizeDraggable.isDragging,
  })
  const isResizing = resizeDraggable.isDragging
  const displayedEnd = resizePreview
    ? calendarEndAfterResize({
        start: calendarEvent.start,
        end: calendarEvent.end,
        deltaY: resizePreview.deltaY,
        scrollDelta: resizePreview.scrollTop - dragStartScrollTopRef.current,
      })
    : calendarEvent.end
  const top = positionForMinutes(calendarEvent.start)
  const height = heightForMinutes(displayedEnd - calendarEvent.start)
  const widthPercent = (columnSpan / columnCount) * 100
  const leftPercent = (column / columnCount) * 100

  useEffect(() => {
    document.body.classList.toggle('calendar-event-resizing', isResizing)
    const timelineScroll = timelineScrollRef.current
    const updatePreviewForScroll = () => {
      setResizePreview((current) =>
        current ? { ...current, scrollTop: timelineScroll?.scrollTop || 0 } : current,
      )
    }
    if (isResizing) {
      timelineScroll?.addEventListener('scroll', updatePreviewForScroll, { passive: true })
    }

    return () => {
      document.body.classList.remove('calendar-event-resizing')
      timelineScroll?.removeEventListener('scroll', updatePreviewForScroll)
    }
  }, [isResizing, timelineScrollRef])

  const updateEventEnd = (nextEnd) => {
    setEvents?.((items) =>
      items.map((item) =>
        item.id === calendarEvent.id && (item.dateKey || CURRENT_DATE_KEY) === dateKey
          ? { ...item, end: nextEnd }
          : item,
      ),
    )
  }

  const resizeWithKeyboard = (event) => {
    if (resizeDraggable.isDragging) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextEnd = clampCalendarEnd(
      calendarEvent.end + direction * CALENDAR_SNAP_MINUTES,
      calendarEvent.start,
    )
    updateEventEnd(nextEnd)
  }
  const rememberDragStartScroll = (event) => {
    if (draggable.isDragging || resizeDraggable.isDragging) return
    dragStartScrollTopRef.current = timelineScrollRef.current?.scrollTop || 0
    if (event.type === 'pointerdown') {
      pointerStartRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      }
    }
  }
  const trackPointerIntent = (event) => {
    const start = pointerStartRef.current
    if (!start || start.pointerId !== event.pointerId || start.moved) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) {
      start.moved = true
    }
  }
  const openTaskDetails = (event) => {
    const moved = pointerStartRef.current?.moved
    pointerStartRef.current = null
    if (
      (!isSession && !task) ||
      (!isSession && !onOpenTask) ||
      event.defaultPrevented ||
      moved ||
      draggable.isDragging ||
      resizeDraggable.isDragging
    )
      return
    event.stopPropagation()
    if (isSession) openSession(calendarEvent.id, event.currentTarget)
    else onOpenTask(task, event.currentTarget)
  }
  const openTaskDetailsWithKeyboard = (event) => {
    if (event.key !== 'Enter' || (!isSession && (!task || !onOpenTask))) return
    event.preventDefault()
    event.stopPropagation()
    if (isSession) openSession(calendarEvent.id, event.currentTarget)
    else onOpenTask(task, event.currentTarget)
  }

  return (
    <div
      ref={draggable.ref}
      className={`calendar-event ${isSession ? `calendar-session ${isCompletedPastSession ? 'session-completed-past' : ''} ${displayedEnd - calendarEvent.start < 90 ? 'session-short' : ''} ${displayedEnd - calendarEvent.start <= 30 ? 'session-tiny' : ''}` : ''} ${calendarEvent.color || ''} ${dropActive ? 'session-drop-active' : ''} ${calendarEvent.complete ? 'complete' : ''} ${draggable.isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
      data-calendar-session={isSession ? 'true' : undefined}
      data-session-completed-past={isCompletedPastSession ? 'true' : undefined}
      data-calendar-event-id={removing ? undefined : calendarEvent.id}
      data-calendar-removal-id={removing ? calendarEvent.id : undefined}
      inert={removing ? true : undefined}
      aria-hidden={removing ? 'true' : undefined}
      data-auto-schedule-pending={
        autoSchedule?.kind !== 'unschedule' && autoSchedule?.taskId === calendarEvent.id ? 'true' : undefined
      }
      data-calendar-task-openable={task && onOpenTask ? 'true' : undefined}
      style={{
        top,
        left: `${leftPercent}%`,
        width: `calc(${widthPercent}% - 2px)`,
        height: `max(${height}, 20px)`,
      }}
      title={`${calendarEvent.title}, ${timeLabel(calendarEvent.start)}–${timeLabel(displayedEnd)}${isCompletedPastSession ? ' · Completed session, time slot has ended' : ''}`}
    >
      <div
        ref={draggable.handleRef}
        className="calendar-event-drag-surface"
        tabIndex={0}
        role="button"
        aria-label={
          isSession
            ? `Open session ${calendarEvent.title}, or drag to reschedule`
            : task && onOpenTask
              ? `Open details for ${calendarEvent.title}, or drag to reschedule or move to Tasks`
              : `Move ${calendarEvent.title}, ${timeLabel(calendarEvent.start)}–${timeLabel(calendarEvent.end)}, or drag to Tasks`
        }
        onPointerDownCapture={rememberDragStartScroll}
        onPointerMoveCapture={trackPointerIntent}
        onKeyDownCapture={rememberDragStartScroll}
        onKeyDown={openTaskDetailsWithKeyboard}
        onClick={openTaskDetails}
      >
        <strong className="calendar-event-title">
          {calendarEvent.recurrenceSeriesId ? <ArrowsClockwise size={11} aria-hidden="true" /> : null}
          {isSession ? (
            <span className="session-name">{calendarEvent.title}</span>
          ) : (
            <>
              {calendarEvent.complete ? '✓ ' : ''}
              {calendarEvent.title}
            </>
          )}
          {isSession ? (
            <span className="session-count">
              {completedCount}/{sessionTasks.length}
            </span>
          ) : null}
        </strong>
        <span className={isSession ? 'session-time' : undefined}>
          {timeLabel(calendarEvent.start)}–{timeLabel(displayedEnd)}
          {isCompletedPastSession ? (
            <span className="session-completed-label">
              <Check size={10} weight="bold" aria-hidden="true" />
              Completed
            </span>
          ) : null}
        </span>
      </div>
      {isSession ? (
        <div className="session-card-body">
          <progress
            className="session-progress"
            value={completedCount}
            max={sessionTasks.length || 1}
            aria-label={`${completedCount} of ${sessionTasks.length} tasks complete`}
          />
          <SessionChecklist session={calendarEvent} compact />
        </div>
      ) : null}
      <button
        ref={resizeDraggable.ref}
        className="calendar-event-resize-handle"
        type="button"
        data-resize-handle
        aria-label={`Resize ${calendarEvent.title} from the bottom`}
        title="Drag to resize"
        onPointerDownCapture={rememberDragStartScroll}
        onKeyDownCapture={rememberDragStartScroll}
        onKeyDown={resizeWithKeyboard}
      />
    </div>
  )
}

export function CalendarPane({
  areas = DEFAULT_AREAS,
  events = [],
  removingEvent = null,
  setEvents,
  tasks = [],

  dateKey = CURRENT_DATE_KEY,
  toolbarContent = null,
  focusRequest = null,
  visibleTaskIds,
  selectedAreaIds = [],
  onCreateSession,
  onOpenTask,
  enableSlotCreation = true,
}) {
  const { taskMap } = useCalendarSessions()
  const [sessionDropId, setSessionDropId] = useState(null)
  const timelineScrollRef = useRef(null)
  const selectionAnchorRef = useRef(null)
  const selectionPointerIdRef = useRef(null)
  const selectionCancelPointerIdRef = useRef(null)
  const calendarDropDragRef = useRef(null)
  const [draftSelection, setDraftSelection] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [editorPanelRect, setEditorPanelRect] = useState(null)
  const [calendarDropPreview, setCalendarDropPreview] = useState(null)
  const [currentMinute, setCurrentMinute] = useState(() => currentDayMinute())
  const refreshCalendarDropPreview = useCallback((sample) => {
    const timelineScroll = timelineScrollRef.current
    const timelineElement = timelineScroll?.querySelector('[data-calendar-drop-zone="true"]')
    const sessionId = sessionDragTaskId(sample?.sourceData) ? sessionAtPointer(sample.pointer) : null
    setSessionDropId(sessionId)
    const nextPreview =
      sample && !sessionId && !sample.sourceData?.sessionTask
        ? calendarDropPreviewForSample({
            ...sample,
            timelineElement,
            timelineViewportElement: timelineScroll,
            timelineScrollTop: timelineScroll?.scrollTop || 0,
          })
        : null
    setCalendarDropPreview((current) =>
      sameCalendarDropPreview(current, nextPreview) ? current : nextPreview,
    )
  }, [])
  const trackCalendarDrop = useCallback(
    (event) => {
      const sample = {
        operation: event.operation,
        pointer: pointerFromDragEvent(event),
        sourceData: event.operation.source?.data,
      }
      calendarDropDragRef.current = sample
      refreshCalendarDropPreview(sample)
    },
    [refreshCalendarDropPreview],
  )
  const clearCalendarDropPreview = useCallback(() => {
    calendarDropDragRef.current = null
    setCalendarDropPreview(null)
    setSessionDropId(null)
  }, [])
  const calendarDropMonitorHandlers = useMemo(
    () => ({
      onDragStart: trackCalendarDrop,
      onDragMove: trackCalendarDrop,
      onDragEnd: clearCalendarDropPreview,
    }),
    [clearCalendarDropPreview, trackCalendarDrop],
  )
  useDragDropMonitor(calendarDropMonitorHandlers)
  const startHour = 0
  const endHour = 24
  const defaultStartHour = 8
  const hourBoundaries = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index)
  const startMinutes = startHour * 60
  const endMinutes = endHour * 60
  const hourHeight = CALENDAR_HOUR_HEIGHT
  const timelineStyle = { height: `${(endHour - startHour) * hourHeight + 1}px` }
  const offsetForMinutes = (minutes) => ((minutes - startMinutes) / 60) * hourHeight
  const positionForMinutes = (minutes) => `${offsetForMinutes(minutes)}px`
  const heightForMinutes = (minutes) => `${(minutes / 60) * hourHeight}px`
  const selectedDate = dateFromKey(dateKey)
  const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const dayNumber = selectedDate.getDate()
  const isCurrentDay = dateKey === CURRENT_DATE_KEY
  useEffect(() => {
    if (!isCurrentDay) return undefined
    const refreshCurrentTime = () => setCurrentMinute(currentDayMinute())
    refreshCurrentTime()
    const interval = window.setInterval(refreshCurrentTime, 30_000)
    window.addEventListener('focus', refreshCurrentTime)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshCurrentTime)
    }
  }, [isCurrentDay])
  const visibleTaskIdSet = visibleTaskIds ? new Set(visibleTaskIds) : null
  const visibleTasks = visibleTaskIdSet ? tasks.filter((task) => visibleTaskIdSet.has(task.id)) : tasks
  const taskCompletionById = new Map(visibleTasks.map((task) => [task.id, task.complete]))
  // The removed event survives only as an inert visual until its exit finishes.
  const displayedEvents = removingEvent
    ? [...events.filter((event) => event.id !== removingEvent.id), removingEvent]
    : events
  const visibleEvents = displayedEvents
    .filter(
      (calendarEvent) =>
        calendarEvent.kind !== 'shutdown' &&
        (calendarEvent.dateKey || CURRENT_DATE_KEY) === dateKey &&
        (calendarEvent.kind === 'session' || !visibleTaskIdSet || visibleTaskIdSet.has(calendarEvent.id)) &&
        calendarEvent.end > startMinutes &&
        calendarEvent.start < endMinutes,
    )
    .map((calendarEvent) => ({
      ...calendarEvent,
      complete: taskCompletionById.get(calendarEvent.id) ?? calendarEvent.complete,
    }))
  const shutdownEvent = events.find((event) => event.kind === 'shutdown' && event.dateKey === dateKey)
  const laidOutEvents = layoutCalendarEvents(visibleEvents)
  const calendarDropLayout = calendarDropPreview
    ? layoutCalendarEvents([
        ...visibleEvents.filter((calendarEvent) => calendarEvent.id !== calendarDropPreview.taskId),
        {
          id: CALENDAR_DROP_PREVIEW_ID,
          title: calendarDropPreview.title,
          start: calendarDropPreview.start,
          end: calendarDropPreview.end,
        },
      ]).find((item) => item.calendarEvent.id === CALENDAR_DROP_PREVIEW_ID)
    : null
  const completionGroups = groupTaskCompletions(
    calendarCompletionTasks(visibleTasks, [...taskMap.values()], dateKey),
  )
  const timelineDroppable = useDroppable({
    id: `calendar-timeline:${dateKey}`,
    accept: CALENDAR_DRAG_TYPE,
    data: {
      kind: 'calendar-timeline',
      dateKey,
    },
  })

  useLayoutEffect(() => {
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = (defaultStartHour - startHour) * hourHeight
    }
  }, [])

  useLayoutEffect(() => {
    const timelineScroll = timelineScrollRef.current
    if (!timelineScroll || focusRequest?.dateKey !== dateKey) return
    const revealTime = () => {
      // A collapsed panel or responsive overlay must be visible before scrolling.
      if (!timelineScroll.clientHeight) return
      timelineScroll.scrollTop = Math.max(
        0,
        (focusRequest.start / 60) * CALENDAR_HOUR_HEIGHT - timelineScroll.clientHeight / 2,
      )
      observer.disconnect()
    }
    const observer = new ResizeObserver(revealTime)
    observer.observe(timelineScroll)
    revealTime()
    return () => observer.disconnect()
  }, [dateKey, focusRequest])

  useEffect(() => {
    const timelineScroll = timelineScrollRef.current
    const refreshForScroll = () => {
      refreshCalendarDropPreview(calendarDropDragRef.current)
    }
    timelineScroll?.addEventListener('scroll', refreshForScroll, { passive: true })
    return () => timelineScroll?.removeEventListener('scroll', refreshForScroll)
  }, [refreshCalendarDropPreview])

  useEffect(() => {
    setDraftSelection(null)
    setSelecting(false)
    setEditorPanelRect(null)
    clearCalendarDropPreview()
  }, [clearCalendarDropPreview, dateKey])

  useEffect(() => {
    document.body.classList.toggle('calendar-slot-selecting', selecting)
    return () => document.body.classList.remove('calendar-slot-selecting')
  }, [selecting])

  const cancelSelection = useCallback((suppressPointerId = null) => {
    timelineScrollRef.current?.querySelector('.timeline')?.focus({ preventScroll: true })
    setDraftSelection(null)
    setSelecting(false)
    setEditorPanelRect(null)
    selectionAnchorRef.current = null
    selectionPointerIdRef.current = null
    if (Number.isFinite(suppressPointerId)) {
      selectionCancelPointerIdRef.current = suppressPointerId
      queueMicrotask(() => {
        if (selectionCancelPointerIdRef.current === suppressPointerId) {
          selectionCancelPointerIdRef.current = null
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!selecting) return
    const cancel = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelSelection()
      }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [selecting, cancelSelection])

  const minutesAtPointer = (event) => {
    const timelineRect = event.currentTarget.getBoundingClientRect()
    const rawMinutes = ((event.clientY - timelineRect.top) / hourHeight) * 60
    return Math.max(0, Math.min(CALENDAR_DAY_MINUTES, snapCalendarMinutes(rawMinutes)))
  }

  const selectionAtPointer = (event) => {
    const anchor = selectionAnchorRef.current
    if (anchor === null) return null
    const pointerMinutes = minutesAtPointer(event)
    let start = Math.min(anchor, pointerMinutes)
    let end = Math.max(anchor, pointerMinutes)

    if (start === end) {
      end = Math.min(CALENDAR_DAY_MINUTES, start + DEFAULT_SESSION_MINUTES)
      if (end === start) start = Math.max(0, end - CALENDAR_MIN_EVENT_MINUTES)
    }

    end = Math.min(CALENDAR_DAY_MINUTES, Math.max(end, start + CALENDAR_MIN_EVENT_MINUTES))
    return { start, end }
  }

  const startSelection = (event) => {
    if (!enableSlotCreation) return
    if (selectionCancelPointerIdRef.current === event.pointerId) {
      selectionCancelPointerIdRef.current = null
      return
    }
    if (event.button !== 0 || event.target.closest('.calendar-event, button, input')) return
    event.preventDefault()
    const anchor = Math.min(CALENDAR_DAY_MINUTES - CALENDAR_MIN_EVENT_MINUTES, minutesAtPointer(event))
    selectionAnchorRef.current = anchor
    selectionPointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setEditorPanelRect(null)
    setSelecting(true)
    setDraftSelection({
      dateKey,
      start: anchor,
      end: Math.min(CALENDAR_DAY_MINUTES, anchor + DEFAULT_SESSION_MINUTES),
      title: '',
    })
  }

  const updateSelection = (event) => {
    if (event.pointerId !== selectionPointerIdRef.current) return
    const range = selectionAtPointer(event)
    if (!range) return
    setDraftSelection((current) => ({ ...current, ...range }))
  }

  const finishSelection = (event) => {
    if (event.pointerId !== selectionPointerIdRef.current) return
    const range = selectionAtPointer(event)
    const rightPanelRect = event.currentTarget.closest('.right-panel')?.getBoundingClientRect()
    const weekCalendarDayRect = event.currentTarget.closest('.week-calendar-day')?.getBoundingClientRect()
    const editorHostRect = rightPanelRect || weekCalendarDayRect
    const timelineRect = event.currentTarget.getBoundingClientRect()
    const selectionTop = range
      ? timelineRect.top + offsetForMinutes(range.start)
      : editorHostRect?.top + CALENDAR_EDITOR_VIEWPORT_GUTTER
    if (range) setDraftSelection((current) => ({ ...current, ...range }))
    setSelecting(false)
    selectionAnchorRef.current = null
    selectionPointerIdRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (editorHostRect) {
      setEditorPanelRect({
        top: editorHostRect.top,
        right: editorHostRect.right,
        bottom: editorHostRect.bottom,
        left: editorHostRect.left,
        width: editorHostRect.width,
        anchorLeft: timelineRect.left,
        anchorRight: timelineRect.right,
        layout: rightPanelRect ? 'right-panel' : 'week-calendar',
        selectionTop,
      })
    }
  }

  const createWithKeyboard = (event) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const viewport = timelineScrollRef.current.getBoundingClientRect()
    const start = Math.min(1425, snapCalendarMinutes((timelineScrollRef.current.scrollTop / hourHeight) * 60))
    setDraftSelection({ dateKey, start, end: Math.min(1440, start + DEFAULT_SESSION_MINUTES), title: '' })
    setEditorPanelRect({
      top: viewport.top,
      bottom: viewport.bottom,
      left: viewport.left,
      right: viewport.right,
      width: viewport.width,
      anchorLeft: rect.left,
      anchorRight: rect.right,
      layout: event.currentTarget.closest('.right-panel') ? 'right-panel' : 'week-calendar',
      selectionTop: viewport.top,
    })
  }

  const saveSelection = () => {
    if (!draftSelection?.title.trim()) return
    onCreateSession?.({
      dateKey: draftSelection.dateKey || dateKey,
      title: draftSelection.title.trim(),
      start: draftSelection.start,
      end: draftSelection.end,
    })
    cancelSelection()
  }

  return (
    <>
      <div className="calendar-header">{toolbarContent}</div>
      <div
        className="calendar-content"
        aria-label={`Calendar for ${selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`}
      >
        <div className="calendar-day-head">
          <span>{dayName}</span>
          <strong>{dayNumber}</strong>
        </div>
        <div className="calendar-all-day" aria-label="All-day tasks">
          {dateKey?.slice(5) === '07-14' ? <div className="holiday">La fête nationale</div> : null}
        </div>
        <div className="calendar-timeline-scroll" ref={timelineScrollRef}>
          <div
            ref={timelineDroppable.ref}
            className={`timeline ${timelineDroppable.isDropTarget ? 'calendar-drop-target' : ''} ${selecting ? 'selecting' : ''}`}
            tabIndex={enableSlotCreation ? 0 : undefined}
            role="group"
            aria-label="Calendar time slots. Press Enter to create a session."
            onKeyDown={enableSlotCreation ? createWithKeyboard : undefined}
            data-calendar-drop-zone="true"
            data-date-key={dateKey}
            style={timelineStyle}
            onPointerDown={enableSlotCreation ? startSelection : undefined}
            onPointerMove={enableSlotCreation ? updateSelection : undefined}
            onPointerUp={enableSlotCreation ? finishSelection : undefined}
            onPointerCancel={enableSlotCreation ? () => cancelSelection() : undefined}
          >
            {hourBoundaries.map((hour) => (
              <div className="hour-line" style={{ top: positionForMinutes(hour * 60) }} key={hour}>
                <span>{String(hour % endHour).padStart(2, '0')}:00</span>
              </div>
            ))}
            {laidOutEvents.map(({ calendarEvent, column, columnCount, columnSpan }) => (
              <CalendarEvent
                key={`${calendarEvent.dateKey || CURRENT_DATE_KEY}-${calendarEvent.id}`}
                removing={removingEvent?.id === calendarEvent.id}
                dropActive={sessionDropId === calendarEvent.id}
                calendarEvent={calendarEvent}
                column={column}
                columnCount={columnCount}
                columnSpan={columnSpan}
                dateKey={dateKey}
                currentMinute={currentMinute}
                onOpenTask={onOpenTask}
                setEvents={setEvents}
                task={tasks.find((task) => task.id === calendarEvent.id)}
                timelineScrollRef={timelineScrollRef}
                positionForMinutes={positionForMinutes}
                heightForMinutes={heightForMinutes}
              />
            ))}
            {calendarDropPreview && calendarDropLayout ? (
              <div
                className="calendar-drop-preview"
                data-calendar-drop-preview="true"
                data-drop-duration={calendarDropPreview.end - calendarDropPreview.start}
                data-drop-end={calendarDropPreview.end}
                data-drop-start={calendarDropPreview.start}
                style={{
                  top: positionForMinutes(calendarDropPreview.start),
                  left: `${(calendarDropLayout.column / calendarDropLayout.columnCount) * 100}%`,
                  width: `calc(${(calendarDropLayout.columnSpan / calendarDropLayout.columnCount) * 100}% - 2px)`,
                  height: `max(${heightForMinutes(calendarDropPreview.end - calendarDropPreview.start)}, 11px)`,
                }}
                aria-hidden="true"
              >
                <strong>
                  {timeLabel(calendarDropPreview.start)}–{timeLabel(calendarDropPreview.end)}
                </strong>
              </div>
            ) : null}
            {draftSelection ? (
              <div
                className="calendar-selection"
                style={{
                  top: positionForMinutes(draftSelection.start),
                  height: heightForMinutes(draftSelection.end - draftSelection.start),
                }}
                role="status"
                aria-label={`Selected ${timeLabel(draftSelection.start)} to ${timeLabel(draftSelection.end)}`}
              >
                <strong>
                  {timeLabel(draftSelection.start)} – {timeLabel(draftSelection.end)}
                </strong>
              </div>
            ) : null}
            {completionGroups.map((completionGroup) => (
              <CompletionMarker
                key={`${completionGroup.startedAtMinute}-${completionGroup.tasks.map((task) => task.completionKey || task.id).join('-')}`}
                completedAtMinute={completionGroup.completedAtMinute}
                tasks={completionGroup.tasks}
                positionForMinutes={positionForMinutes}
              />
            ))}
            {isCurrentDay ? (
              <div
                className="now-line"
                style={{ top: positionForMinutes(currentMinute) }}
                aria-label="Current time"
              />
            ) : null}
            {shutdownEvent ? (
              <ShutdownMarker
                key={shutdownEvent.id}
                event={shutdownEvent}
                setEvents={setEvents}
                timelineScrollRef={timelineScrollRef}
                positionForMinutes={positionForMinutes}
              />
            ) : null}
          </div>
        </div>
      </div>
      {draftSelection && editorPanelRect && !selecting ? (
        <CalendarSessionEditor
          areas={areas}
          draft={draftSelection}
          dateKey={dateKey}
          panelRect={editorPanelRect}
          onChange={(changes) => setDraftSelection((current) => ({ ...current, ...changes }))}
          onCancel={cancelSelection}
          onSave={saveSelection}
        />
      ) : null}
    </>
  )
}

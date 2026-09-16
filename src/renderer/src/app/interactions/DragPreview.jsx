import { useRef, useState, useCallback, useEffect } from 'react'
import { calendarStartAfterMove } from '../utils/calendar'
import { useDragDropMonitor } from '@dnd-kit/react'
import { pointerFromNativeEvent } from './drag-targets.js'
import { timeLabel } from '../utils/time'
import { BacklogTaskRow } from '../components/BacklogTaskRow'
import { TaskCard } from '../components/TaskCard'
import { backlogTaskDetailsAdapter } from '../utils/workspace-presenters.js'
import { Folder, PushPin } from '@phosphor-icons/react'
import { WeeklyObjectiveCard } from '../components/WeeklyObjectiveCard'

export function CalendarDragPreview({ source }) {
  const { start, end, title, color, timelineScrollRef, dragStartScrollTopRef } = source.data
  const deltaYRef = useRef(0)
  const [previewStart, setPreviewStart] = useState(start)
  const duration = end - start
  const refreshTime = useCallback(() => {
    setPreviewStart(
      calendarStartAfterMove({
        start,
        duration,
        deltaY: deltaYRef.current,
        scrollDelta: (timelineScrollRef?.current?.scrollTop || 0) - (dragStartScrollTopRef?.current || 0),
      }),
    )
  }, [start, duration, timelineScrollRef, dragStartScrollTopRef])
  useDragDropMonitor({
    onDragMove({ operation, nativeEvent }) {
      if (operation.source?.id !== source.id) return
      const pointer = pointerFromNativeEvent(nativeEvent) || operation.position.current
      deltaYRef.current = pointer.y - operation.position.initial.y
      refreshTime()
    },
  })
  useEffect(() => {
    const timelineScroll = timelineScrollRef?.current
    timelineScroll?.addEventListener('scroll', refreshTime, { passive: true })
    return () => timelineScroll?.removeEventListener('scroll', refreshTime)
  }, [refreshTime, timelineScrollRef])

  return (
    <div className={`dnd-calendar-preview ${color || 'violet'}`}>
      <strong>{title}</strong>
      <span>
        {timeLabel(previewStart)}–{timeLabel(previewStart + duration)}
      </span>
    </div>
  )
}

export function DndPreview({ areas, presentation, source }) {
  const data = source?.data
  if (data?.sessionTask)
    return (
      <div className="session-task-drag-preview" style={{ width: presentation?.width }}>
        {data.title}
      </div>
    )

  if (!data || data.kind === 'calendar-resize') return null

  const transferableTask = data.backlogTask || data.kind === 'board-task' || data.kind === 'calendar-event'
  if (transferableTask) {
    const task = data.taskSnapshot ||
      data.itemSnapshot || {
        id: data.taskId || data.eventId,
        title: data.title,
        minutes: Math.max((data.end || 0) - (data.start || 0), 30),
        channel: 'Ritua',
        complete: false,
        accent: data.color || 'violet',
      }
    const defaultKind = data.backlogTask ? 'backlog' : data.kind === 'calendar-event' ? 'calendar' : 'board'
    const previewKind = presentation?.kind || defaultKind
    let content

    if (previewKind === 'backlog') {
      content = (
        <BacklogTaskRow
          item={task}
          variant={presentation?.variant || data.preview?.variant || 'main'}
          dragPreview
        />
      )
    } else if (previewKind === 'calendar') {
      content = <CalendarDragPreview source={source} />
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
      )
    }

    const previewStyle = {
      ...(presentation?.width ? { width: `${presentation.width}px` } : {}),
      ...(presentation?.offsetX || presentation?.offsetY
        ? {
            transform: `translate3d(${presentation.offsetX || 0}px, ${presentation.offsetY || 0}px, 0)`,
          }
        : {}),
    }

    return (
      <div
        className={`dnd-transform-preview dnd-transform-preview-${previewKind}`}
        data-preview-presentation={previewKind}
        style={Object.keys(previewStyle).length ? previewStyle : undefined}
      >
        {content}
      </div>
    )
  }

  if (data.kind === 'collection-item') {
    if (data.preview?.type === 'navigation-project') {
      return (
        <div className="area-project-list navigation-project-drag-preview">
          <div className="nav-item project-item">
            <PushPin mirrored size={14} style={{ color: data.preview.color }} />
            <span>{data.itemSnapshot.title}</span>
          </div>
        </div>
      )
    }
    if (data.preview?.type === 'subtask' || data.preview?.type === 'project-task') {
      return <div className="subtask-drag-preview">{data.itemSnapshot.title}</div>
    }
    if (data.preview?.type === 'area') {
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
                  <PushPin mirrored size={14} weight="regular" style={{ color: data.itemSnapshot.color }} />
                  <span>{project.title}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    if (data.preview?.type === 'objective') {
      return (
        <WeeklyObjectiveCard
          objective={data.itemSnapshot}
          dragPreview
          showThisWeekLabel={data.preview.showThisWeekLabel}
          showCompletedHistory={data.preview.showCompletedHistory}
        />
      )
    }
    if (data.preview?.type === 'backlog') {
      return <BacklogTaskRow item={data.itemSnapshot} variant={data.preview.variant} dragPreview />
    }
    if (data.preview?.type === 'task') {
      return (
        <TaskCard
          task={data.itemSnapshot}
          compact={data.preview.options?.compact}
          dragPreview
          showAssignObjective={data.preview.options?.showAssignObjective}
          showSchedule={data.preview.options?.showSchedule}
          showOrderControls={data.preview.options?.showOrderControls}
        />
      )
    }
  }

  if (!data.taskSnapshot) return null

  return (
    <TaskCard
      task={data.taskSnapshot}
      compact={data.previewOptions?.compact}
      dragPreview
      showAssignObjective={data.previewOptions?.showAssignObjective}
      showSchedule={data.previewOptions?.showSchedule}
      showOrderControls={data.previewOptions?.showOrderControls}
    />
  )
}

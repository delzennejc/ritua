import { CALENDAR_SNAP_MINUTES, DAY_MINUTES } from '../../../../domain/calendar-time'
import { useTaskContextMenu } from './TaskContextMenu'
import { SortableCollectionItem, SortableCollectionLane } from './SortableCollection'
import { SessionContext, useCalendarSessions } from './session-context'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { ArrowDown, ArrowUp, Check, Plus, Trash, X } from '@phosphor-icons/react'
import {
  addSessionTask,
  updateCalendarSession,
  moveSessionTask,
  removeCalendarSession,
  restoreCalendarSession,
  unlinkTaskFromSessions,
} from '../../../../domain/calendar-sessions'
import { useAutoSchedule } from './AutoScheduleAnimation'
import {
  getWorkspaceDocument,
  replaceWorkspaceDocument,
  workspaceStore,
  selectWorkspaceFields,
} from '../../desktop/workspace-store'
import { toggleTaskCompletion } from '../../desktop/workspace-actions'
import { reportActionError } from '../../desktop/ActionErrors'
import { timeLabel } from '../utils/time'
import { UndoSnackbar } from './UndoSnackbar'
import { useSessionTaskReorderAnimation } from '../hooks/useSessionTaskReorderAnimation'

const edit = (operation) => {
  try {
    replaceWorkspaceDocument(operation(getWorkspaceDocument()))
  } catch (error) {
    reportActionError(error.message)
  }
}

export function CalendarSessionsProvider({ children, onOpenTask }) {
  const document = useStore(workspaceStore, (state) => state.document)
  const fields = selectWorkspaceFields(document)
  const taskSessions = useMemo(() => {
    const memberships = new Map()
    for (const event of fields.events || []) {
      if (event.kind !== 'session') continue
      for (const taskId of event.taskIds) {
        if (!memberships.has(taskId)) memberships.set(taskId, [])
        memberships.get(taskId).push(event)
      }
    }
    return memberships
  }, [fields.events])
  const taskMap = useMemo(
    () =>
      new Map(
        (document?.entities || [])
          .filter((entity) => entity.kind === 'task')
          .map((entity) => [entity.id, entity.data.content]),
      ),
    [document],
  )
  const [active, setActive] = useState(null)
  const [undo, setUndo] = useState(null)
  const session =
    active && (fields.events || []).find((event) => event.kind === 'session' && event.id === active.id)
  const close = () => setActive(null)
  const openTask = (task, trigger) => {
    const returnFocus = active?.trigger || trigger
    setActive(null)
    onOpenTask(task, returnFocus)
  }
  const update = (id, patch) => edit((fields) => updateCalendarSession(fields, id, patch))
  const remove = (id) => {
    const current = getWorkspaceDocument()
    const events = selectWorkspaceFields(current).events
    const index = events.findIndex((event) => event.kind === 'session' && event.id === id)
    if (index < 0) return
    try {
      replaceWorkspaceDocument(removeCalendarSession(current, id))
      setUndo({ session: events[index], index, id: crypto.randomUUID() })
      close()
    } catch (error) {
      reportActionError(error.message)
    }
  }
  return (
    <SessionContext.Provider
      value={{
        taskMap,
        taskSessions,
        removeTaskFromSessions: (taskId) => edit((document) => unlinkTaskFromSessions(document, taskId)),
        update,
        removeSession: remove,
        openTask,
        openSession: (id, trigger, adding = false) => setActive({ id, trigger, adding }),
      }}
    >
      {children}
      {session ? (
        <SessionDetails
          key={session.id}
          session={session}
          active={active}
          onClose={close}
          onDelete={() => remove(session.id)}
        />
      ) : null}
      {undo ? (
        <UndoSnackbar
          message="Session deleted. Its tasks are still in your lists."
          notificationId={undo.id}
          onDismiss={() => setUndo(null)}
          onUndo={() => {
            edit((document) => restoreCalendarSession(document, undo.session, undo.index))
            setUndo(null)
          }}
        />
      ) : null}
    </SessionContext.Provider>
  )
}

export function SessionChecklist({ session, compact = false }) {
  const { taskMap, update, openTask } = useCalendarSessions()
  const tasks = session.taskIds.map((id) => taskMap.get(id)).filter(Boolean)
  const move = (index, offset) => {
    const ids = [...session.taskIds]
    ;[ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]
    update(session.id, { taskIds: ids })
  }
  if (compact) return <CalendarSessionChecklist session={session} tasks={tasks} />
  return (
    <ul className={`session-checklist ${compact ? 'compact' : ''}`} aria-label="Session tasks">
      {tasks.map((task, index) => (
        <li key={task.id} className={task.complete ? 'complete' : ''}>
          <button
            type="button"
            className="session-task-toggle session-check-only"
            role="checkbox"
            aria-checked={Boolean(task.complete)}
            aria-label={`${task.complete ? 'Reopen' : 'Complete'} ${task.title}`}
            onClick={() => toggleTaskCompletion(task.id)}
          >
            <span className="session-checkbox">
              {task.complete ? <Check size={10} weight="bold" /> : null}
            </span>
          </button>
          <button
            type="button"
            className="session-task-title session-task-open"
            aria-label={`Open details for ${task.title}`}
            onClick={(event) => openTask(task, event.currentTarget)}
          >
            {task.title}
          </button>
          {!compact ? (
            <div className="session-task-actions">
              <button
                type="button"
                disabled={index === 0}
                aria-label={`Move ${task.title} up`}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                disabled={index === tasks.length - 1}
                aria-label={`Move ${task.title} down`}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${task.title} from session`}
                onClick={() =>
                  update(session.id, { taskIds: session.taskIds.filter((id) => id !== task.id) })
                }
              >
                <X size={14} />
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function CalendarSessionTask({ session, task, collectionItem }) {
  const { openTask } = useCalendarSessions()
  const autoSchedule = useAutoSchedule()
  const contextMenuProps = useTaskContextMenu(task)
  const keyboardEdit = (event) => {
    const index = session.taskIds.indexOf(task.id)
    let beforeId
    if (event.altKey && event.key === 'ArrowUp' && index > 0) beforeId = session.taskIds[index - 1]
    else if (event.altKey && event.key === 'ArrowDown' && index < session.taskIds.length - 1)
      beforeId = session.taskIds[index + 2] || null
    else if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    event.stopPropagation()
    const removing = event.key === 'Delete' || event.key === 'Backspace'
    edit((fields) => moveSessionTask(fields, session.id, task.id, removing ? null : session.id, beforeId))
    if (removing)
      event.currentTarget
        .closest('[data-calendar-session]')
        ?.querySelector('.calendar-event-drag-surface')
        ?.focus()
  }
  return (
    <SortableCollectionItem
      as="li"
      {...collectionItem}
      {...contextMenuProps}
      data-session-task-id={task.id}
      data-auto-schedule-pending={
        autoSchedule?.eventId === session.id && autoSchedule?.taskId === task.id ? 'true' : undefined
      }
      className={task.complete ? 'complete' : ''}
      pointerActivationDistance={5}
      pointerActivatorSelector=".session-task-drag-handle"
      externalDropData={{ sessionTask: true, sessionId: session.id, taskId: task.id, title: task.title }}
      aria-label={`Reorder session task: ${task.title}`}
    >
      {({ handleRef, isDragging }) => (
        <>
          <button
            type="button"
            className="session-task-toggle session-check-only"
            role="checkbox"
            aria-checked={Boolean(task.complete)}
            aria-label={`${task.complete ? 'Reopen' : 'Complete'} ${task.title}`}
            onClick={() => toggleTaskCompletion(task.id)}
          >
            <span className="session-checkbox">
              {task.complete ? <Check size={10} weight="bold" /> : null}
            </span>
          </button>
          <button
            ref={handleRef}
            type="button"
            className="session-task-title session-task-drag-handle"
            aria-label={`Open details for ${task.title}, or drag to reorder or remove from session`}
            title="Click to open task details. Drag to reorder or move out. Alt + arrows to reorder; Delete to remove from session."
            onClick={(event) => {
              if (!event.defaultPrevented && !isDragging) openTask(task, event.currentTarget)
            }}
            onKeyDown={keyboardEdit}
          >
            {task.title}
          </button>
        </>
      )}
    </SortableCollectionItem>
  )
}

function CalendarSessionChecklist({ session, tasks }) {
  const [previewIds, setPreviewIds] = useState(null)
  const previewRef = useRef(null)
  const clearPreview = () => {
    previewRef.current = null
    setPreviewIds(null)
  }
  const move = ({ itemId, targetIndex }) => {
    const current = previewRef.current || session.taskIds
    if (!current.includes(itemId)) return
    const taskIds = current.filter((id) => id !== itemId)
    taskIds.splice(Math.max(0, Math.min(targetIndex, taskIds.length)), 0, itemId)
    previewRef.current = taskIds
    setPreviewIds(taskIds)
  }
  const commit = () => {
    const preview = previewRef.current
    if (!preview) return
    edit((fields) => {
      const current = selectWorkspaceFields(fields).events.find((event) => event.id === session.id)
      if (!current) return fields
      const taskIds = [
        ...preview.filter((id) => current.taskIds.includes(id)),
        ...current.taskIds.filter((id) => !preview.includes(id)),
      ]
      return updateCalendarSession(fields, session.id, { taskIds })
    })
    clearPreview()
  }
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const orderedTasks = previewIds ? previewIds.map((id) => tasksById.get(id)).filter(Boolean) : tasks
  const displayedSession = previewIds ? { ...session, taskIds: previewIds } : session
  useSessionTaskReorderAnimation(session.id, displayedSession.taskIds, Boolean(previewIds))
  return (
    <SortableCollectionLane
      as="ul"
      className="session-checklist compact"
      aria-label="Session tasks"
      collectionId={`session-tasks:${session.id}`}
      surfaceId={`calendar-session:${session.id}`}
      laneId={session.id}
      collectionSnapshot={session.taskIds}
      items={orderedTasks}
      onCommit={commit}
      onMove={move}
      onRestore={clearPreview}
    >
      {({ collectionItemProps }) =>
        orderedTasks.map((task, index) => (
          <CalendarSessionTask
            key={task.id}
            session={displayedSession}
            task={task}
            collectionItem={collectionItemProps(task, index)}
          />
        ))
      }
    </SortableCollectionLane>
  )
}

function SessionDetails({ session, active, onClose, onDelete }) {
  const { taskMap, update } = useCalendarSessions()
  const dialogRef = useRef(null)
  const searchRef = useRef(null)
  const titleRef = useRef(null)
  const [title, setTitle] = useState(session.title)
  const [adding, setAdding] = useState(active.adding)
  const [query, setQuery] = useState('')
  const completed = session.taskIds.filter((id) => taskMap.get(id)?.complete).length
  const candidates = [...taskMap.values()].filter(
    (task) =>
      !session.taskIds.includes(task.id) &&
      !task.complete &&
      task.title.toLowerCase().includes(query.trim().toLowerCase()),
  )
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    ;(active.adding ? searchRef : titleRef).current?.focus()
    return () => {
      dialog.close()
      if (active.trigger?.isConnected) active.trigger.focus()
    }
  }, [])
  useEffect(() => {
    if (adding) searchRef.current?.focus()
  }, [adding])
  const saveTitle = () => {
    if (title.trim()) update(session.id, { title })
    else setTitle(session.title)
  }
  const addNew = () => {
    if (!query.trim()) return
    edit((fields) => addSessionTask(fields, session.id, { id: `task-${crypto.randomUUID()}`, title: query }))
    setQuery('')
    searchRef.current?.focus()
  }
  const changeTime = (key, value) => {
    if (!value) return
    const [hours, minutes] = value.split(':').map(Number)
    const minute = key === 'end' && value === '00:00' ? 1440 : hours * 60 + minutes
    update(
      session.id,
      key === 'start'
        ? {
            start: Math.min(minute, DAY_MINUTES - CALENDAR_SNAP_MINUTES),
            end: Math.min(
              1440,
              Math.min(minute, DAY_MINUTES - CALENDAR_SNAP_MINUTES) + session.end - session.start,
            ),
          }
        : { end: Math.max(session.start + CALENDAR_SNAP_MINUTES, minute) },
    )
  }
  return createPortal(
    <dialog
      className="session-details"
      ref={dialogRef}
      aria-label={`Session ${session.title}`}
      onCancel={() => {
        saveTitle()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          saveTitle()
          onClose()
        }
      }}
    >
      <div className="session-details-content">
        <header className="session-details-header">
          <span className="task-composer-eyebrow">Session</span>
          <button
            type="button"
            aria-label="Close session"
            onClick={() => {
              saveTitle()
              onClose()
            }}
          >
            <X size={18} />
          </button>
        </header>
        <input
          ref={titleRef}
          className="session-title-input"
          aria-label="Session title"
          maxLength={500}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <div className="session-schedule-fields">
          <label>
            Date
            <input
              type="date"
              aria-label="Session date"
              value={session.dateKey}
              onChange={(event) => {
                if (event.target.value) update(session.id, { dateKey: event.target.value })
              }}
            />
          </label>
          <label>
            Starts
            <input
              type="time"
              aria-label="Session start time"
              step={300}
              value={timeLabel(session.start)}
              onChange={(event) => changeTime('start', event.target.value)}
            />
          </label>
          <label>
            Ends
            <input
              type="time"
              aria-label="Session end time"
              step={300}
              value={session.end === 1440 ? '00:00' : timeLabel(session.end)}
              onChange={(event) => changeTime('end', event.target.value)}
            />
          </label>
        </div>
        <div className="session-progress-label">
          <span>Tasks</span>
          <span>
            {completed} of {session.taskIds.length} complete
          </span>
        </div>
        <progress
          className="session-progress"
          value={completed}
          max={session.taskIds.length || 1}
          aria-label={`${completed} of ${session.taskIds.length} tasks complete`}
        />
        <SessionChecklist session={session} />
        {!session.taskIds.length ? (
          <p className="session-empty">What would you like to accomplish in this session?</p>
        ) : null}
        {adding ? (
          <div className="session-task-picker">
            <div className="session-search-row">
              <input
                ref={searchRef}
                aria-label="Search or create a task"
                placeholder="Search or create a task…"
                value={query}
                maxLength={500}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addNew()
                  }
                }}
              />
              <button type="button" aria-label="Close task picker" onClick={() => setAdding(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="session-task-options">
              {candidates.slice(0, 30).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    update(session.id, { taskIds: [...session.taskIds, task.id] })
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  <Plus size={14} />
                  <span>
                    {task.title}
                    <small>{task.channel}</small>
                  </span>
                </button>
              ))}
              {!candidates.length && !query.trim() ? (
                <p>No more tasks to add. Type a title to create one.</p>
              ) : null}
            </div>
            {query.trim() ? (
              <button className="session-create-task" type="button" onClick={addNew}>
                <Plus size={14} />
                <span>Create “{query.trim()}”</span>
              </button>
            ) : null}
          </div>
        ) : (
          <button className="session-add-link" type="button" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add tasks
          </button>
        )}
        <footer>
          <button className="session-delete" type="button" onClick={onDelete}>
            <Trash size={15} />
            Delete session
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              saveTitle()
              onClose()
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  )
}

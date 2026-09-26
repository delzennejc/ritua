import { CALENDAR_SNAP_MINUTES, DAY_MINUTES } from '../../../../domain/calendar-time'
import { useTaskContextMenu } from './TaskContextMenu'
import { SortableCollectionItem, SortableCollectionLane } from './SortableCollection'
import { SessionContext, useCalendarSessions } from './session-context'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  CheckCircle,
  Clock,
  DotsThree,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react'
import {
  addSessionTask,
  updateCalendarSession,
  moveSessionTask,
  unlinkTaskFromSessions,
} from '../../../../domain/calendar-sessions'
import {
  changeWorkspaceSessionColor,
  changeWorkspaceSessionRecurrence,
  deleteWorkspaceSession,
  undoWorkspaceSessionDeletion,
} from '../../../../domain/session-recurrence'
import { noRecurrence, recurrenceLabel } from '../../../../domain/recurrence'
import { RecurrenceEditor } from './task-details/RecurrenceEditor.jsx'
import { CURRENT_DATE_KEY } from '../utils/dates'
import { useAutoSchedule } from './AutoScheduleAnimation'
import {
  getWorkspaceDocument,
  replaceWorkspaceDocument,
  workspaceStore,
  selectWorkspaceFields,
} from '../../desktop/workspace-store'
import { toggleTaskCompletion } from '../../desktop/workspace-actions'
import { activityContext } from '../../desktop/activity-context'
import { reportActionError } from '../../desktop/ActionErrors'
import { timeLabel } from '../utils/time'
import { UndoSnackbar } from './UndoSnackbar'
import { Dropdown } from './Dropdown'
import { DetailsTitleInput } from './DetailsTitleInput'
import { ProjectProgressCircle } from './ProjectProgressCircle'
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
  const update = (id, patch) => edit((fields) => updateCalendarSession(fields, id, patch, activityContext()))
  const updateRecurrence = (id, recurrence, repeatTasks) =>
    edit((document) =>
      changeWorkspaceSessionRecurrence(document, id, recurrence, {
        today: CURRENT_DATE_KEY,
        seriesId: `${id}-${crypto.randomUUID()}`,
        repeatTasks,
      }),
    )
  const updateColor = (id, color) => edit((document) => changeWorkspaceSessionColor(document, id, color))
  const sessionRepeatsTasks = (seriesId) => {
    const definition = seriesId ? fields.sessionRecurrenceDefinitions?.[seriesId] : undefined
    if (!definition) return false
    if (definition.repeatTasks !== undefined) return Boolean(definition.repeatTasks)
    return Boolean((definition.tasks || []).length)
  }
  const sessionTaskTemplateCount = (seriesId) => {
    const definition = seriesId ? fields.sessionRecurrenceDefinitions?.[seriesId] : undefined
    return definition ? (definition.tasks || []).length : 0
  }
  const remove = (id, scope = 'single') => {
    const current = getWorkspaceDocument()
    try {
      const result = deleteWorkspaceSession(current, id, scope)
      replaceWorkspaceDocument(result.document)
      setUndo({ undo: result.undo, id: crypto.randomUUID(), following: scope === 'following' })
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
        removeTaskFromSessions: (taskId) =>
          edit((document) => unlinkTaskFromSessions(document, taskId, activityContext())),
        update,
        updateRecurrence,
        updateColor,
        sessionRepeatsTasks,
        sessionTaskTemplateCount,
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
          todayTasks={fields.tasks || []}
          active={active}
          onClose={close}
          onDelete={(scope) => remove(session.id, scope)}
        />
      ) : null}
      {undo ? (
        <UndoSnackbar
          message={
            undo.following
              ? 'Sessions deleted. Their tasks are still in your lists.'
              : 'Session deleted. Its tasks are still in your lists.'
          }
          notificationId={undo.id}
          onDismiss={() => setUndo(null)}
          onUndo={() => {
            edit((document) => undoWorkspaceSessionDeletion(document, undo.undo))
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
  if (compact) return <CalendarSessionChecklist session={session} tasks={tasks} />
  return (
    <ul className="session-checklist objective-details-tasks" aria-label="Session tasks">
      {tasks.map((task) => (
        <li key={task.id} className={task.complete ? 'complete' : ''}>
          <button
            type="button"
            className="objective-details-task-completion"
            role="checkbox"
            aria-checked={Boolean(task.complete)}
            aria-label={`${task.complete ? 'Reopen' : 'Complete'} ${task.title}`}
            onClick={() => toggleTaskCompletion(task.id)}
          >
            <CheckCircle size={19} weight={task.complete ? 'fill' : 'regular'} />
          </button>
          <button
            type="button"
            className="objective-details-task-title"
            aria-label={`Open details for ${task.title}`}
            onClick={(event) => openTask(task, event.currentTarget)}
          >
            {task.title}
          </button>
          {!compact ? (
            <div className="session-task-actions">
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
    edit((fields) =>
      moveSessionTask(fields, session.id, task.id, removing ? null : session.id, beforeId, activityContext()),
    )
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
      return updateCalendarSession(fields, session.id, { taskIds }, activityContext())
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

function SessionDetails({ session, todayTasks, active, onClose, onDelete }) {
  const { taskMap, update, updateRecurrence, sessionRepeatsTasks, sessionTaskTemplateCount } =
    useCalendarSessions()
  const dialogRef = useRef(null)
  const searchRef = useRef(null)
  const titleRef = useRef(null)
  const addTasksRef = useRef(null)
  const recurrenceTriggerRef = useRef(null)
  const [title, setTitle] = useState(session.title)
  const [adding, setAdding] = useState(active.adding)
  const [query, setQuery] = useState('')
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const [recurrenceDraft, setRecurrenceDraft] = useState(() => session.recurrence || noRecurrence())
  const repeatsTasks = sessionRepeatsTasks(session.recurrenceSeriesId)
  const sessionHasTasks =
    session.taskIds.length > 0 || sessionTaskTemplateCount(session.recurrenceSeriesId) > 0
  const [repeatTasksDraft, setRepeatTasksDraft] = useState(() =>
    session.recurrenceSeriesId ? repeatsTasks : sessionHasTasks,
  )
  const recurrenceDateKey = session.recurrenceStartDateKey || session.dateKey
  const tasks = session.taskIds.map((id) => taskMap.get(id)).filter(Boolean)
  const completed = tasks.filter((task) => task.complete).length
  const candidates = todayTasks.filter(
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
      className="objective-details session-details"
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
      <header className="objective-details-header session-details-header">
        <div className="task-details-folder-picker session-time-slot">
          <span className="task-details-eyebrow">Timeslot</span>
          <Dropdown
            label="Session time slot"
            triggerClassName="task-details-folder-value task-details-area-trigger"
            trigger={
              <>
                <Clock size={16} />
                <span>
                  {timeLabel(session.start)}–{timeLabel(session.end)}
                </span>
                <CaretDown size={12} />
              </>
            }
            menuWidth={320}
          >
            <div className="session-schedule-fields">
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
            </div>
          </Dropdown>
        </div>
        <div className="task-details-actions objective-details-actions">
          <Dropdown
            className="task-details-more task-details-repeat"
            triggerClassName={recurrenceOpen ? 'active' : ''}
            triggerRef={recurrenceTriggerRef}
            triggerTitle={recurrenceLabel(session.recurrence, recurrenceDateKey)}
            label="Repeat session"
            trigger={
              <>
                <ArrowsClockwise size={17} /> {session.recurrenceSeriesId ? 'Repeats' : 'Repeat'}
              </>
            }
            align="end"
            menuWidth={420}
            open={recurrenceOpen}
            onOpenChange={(open) => {
              setRecurrenceDraft(session.recurrence || noRecurrence())
              setRepeatTasksDraft(session.recurrenceSeriesId ? repeatsTasks : sessionHasTasks)
              setRecurrenceOpen(open)
            }}
          >
            <RecurrenceEditor
              dateKey={recurrenceDateKey}
              recurrence={recurrenceDraft}
              taskScope={{
                value: repeatTasksDraft,
                onChange: setRepeatTasksDraft,
                disabled: !sessionHasTasks,
              }}
              onCancel={() => {
                setRecurrenceDraft(session.recurrence || noRecurrence())
                setRecurrenceOpen(false)
                recurrenceTriggerRef.current?.focus()
              }}
              onChange={(nextRecurrence, save = true) => {
                if (!save) {
                  setRecurrenceDraft(nextRecurrence)
                  return
                }
                updateRecurrence(session.id, nextRecurrence, sessionHasTasks && repeatTasksDraft)
                setRecurrenceOpen(false)
                recurrenceTriggerRef.current?.focus()
              }}
            />
          </Dropdown>
          <Dropdown
            className="task-details-more"
            triggerClassName="task-details-icon-action"
            label="More session actions"
            trigger={<DotsThree size={21} weight="bold" />}
            align="end"
            items={
              session.recurrenceSeriesId
                ? [
                    {
                      id: 'delete-single',
                      label: 'Delete this session only',
                      icon: <Trash size={16} />,
                      danger: true,
                      onSelect: () => onDelete('single'),
                    },
                    {
                      id: 'delete-following',
                      label: 'Delete this and following sessions',
                      icon: <ArrowsClockwise size={16} />,
                      danger: true,
                      onSelect: () => onDelete('following'),
                    },
                  ]
                : [
                    {
                      id: 'delete',
                      label: 'Delete session',
                      icon: <Trash size={16} />,
                      danger: true,
                      onSelect: () => onDelete('single'),
                    },
                  ]
            }
          />
          <button
            className="task-details-icon-action"
            type="button"
            aria-label="Close session"
            onClick={() => {
              saveTitle()
              onClose()
            }}
          >
            <X size={19} />
          </button>
        </div>
      </header>
      <div className="objective-details-content">
        <section className="objective-details-primary">
          <div className="objective-details-kicker">
            <Clock size={18} weight="duotone" aria-hidden="true" />
            <span>Session</span>
            <small>
              {completed} of {tasks.length} tasks complete
            </small>
          </div>
          <div className="objective-details-title-row">
            <span
              className="session-details-progress"
              role="progressbar"
              aria-label="Session task completion"
              aria-valuemin={0}
              aria-valuemax={tasks.length || 1}
              aria-valuenow={completed}
              aria-valuetext={`${completed} of ${tasks.length} tasks complete`}
            >
              <ProjectProgressCircle tasks={tasks} size={24} />
            </span>
            <DetailsTitleInput
              ref={titleRef}
              className="objective-details-title-input"
              aria-label="Session title"
              maxLength={500}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={saveTitle}
            />
          </div>
          <SessionChecklist session={session} />
          {!session.taskIds.length ? (
            <p className="objective-details-empty">What would you like to accomplish in this session?</p>
          ) : null}
          <Dropdown
            label="Add session tasks"
            triggerRef={addTasksRef}
            triggerClassName="objective-details-add-task"
            trigger={
              <>
                <Plus size={19} aria-hidden="true" />
                Add tasks
              </>
            }
            open={adding}
            onOpenChange={setAdding}
            menuWidth={360}
          >
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
                <button
                  type="button"
                  aria-label="Close task picker"
                  onClick={() => {
                    setAdding(false)
                    addTasksRef.current?.focus()
                  }}
                >
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
                  <p>No more tasks for today. Type a title to create one.</p>
                ) : null}
              </div>
              {query.trim() ? (
                <button className="session-create-task" type="button" onClick={addNew}>
                  <Plus size={14} />
                  <span>Create “{query.trim()}”</span>
                </button>
              ) : null}
            </div>
          </Dropdown>
        </section>
      </div>
    </dialog>,
    document.body,
  )
}

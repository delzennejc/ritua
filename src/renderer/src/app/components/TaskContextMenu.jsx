import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  ArrowsClockwise,
  ArrowSquareOut,
  CalendarCheck,
  CalendarPlus,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Check,
  CircleDashed,
  FolderSimple,
  Palette,
  Prohibit,
  PushPin,
  Plus,
  Stack,
  Trash,
  X,
} from '@phosphor-icons/react'
import { useCalendarSessions } from './session-context'
import { AREA_COLOR_OPTIONS } from '../data/areaColors'
import { taskDateShortcuts } from '../../../../domain/task-date-shortcuts'
import { dateFromKey, localDateKey } from '../../../../domain/calendar-dates'
import {
  noRecurrence,
  recurrenceForPreset,
  recurrenceLabel,
  recurrenceOptions,
  RECURRENCE_PRESETS,
} from '../../../../domain/recurrence'
import { RecurrenceCustomFields } from './RecurrenceCustomFields'

const TaskContextMenuContext = createContext(null)
const MENU_FOCUSABLE_SELECTOR =
  '[role^="menuitem"]:not(:disabled), [data-task-context-focusable="true"]:not(:disabled)'

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum))

function focusFirstItem(menu) {
  menu?.querySelector(MENU_FOCUSABLE_SELECTOR)?.focus({ preventScroll: true })
}

function focusMenuItem(menu, itemId) {
  menu?.querySelector(`[data-task-context-item="${CSS.escape(itemId)}"]`)?.focus({
    preventScroll: true,
  })
}

export function TaskContextMenuOption({
  checked = false,
  danger = false,
  detail,
  disabled = false,
  icon,
  itemId,
  label,
  onSelect,
  panel,
  role = 'menuitem',
}) {
  return (
    <button
      aria-checked={role === 'menuitemradio' ? checked : undefined}
      aria-haspopup={panel ? 'menu' : undefined}
      className={`task-context-menu-option${danger ? ' task-context-menu-option-danger' : ''}`}
      data-task-context-item={itemId}
      data-task-context-panel={panel || undefined}
      disabled={disabled}
      role={role}
      type="button"
      onClick={onSelect}
    >
      <span className="task-context-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="task-context-menu-copy">
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
      {panel ? (
        <CaretRight className="task-context-menu-caret" size={14} aria-hidden="true" />
      ) : checked ? (
        <Check className="task-context-menu-check" size={14} weight="bold" aria-hidden="true" />
      ) : null}
    </button>
  )
}

function TaskContextMenuDivider() {
  return <div className="task-context-menu-divider" role="separator" />
}

function TaskContextMenuConfirmation({ confirmLabel = 'Move', description, onCancel, onConfirm, title }) {
  return (
    <section className="task-context-menu-confirm" aria-label={title} role="dialog">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      <div className="task-context-menu-confirm-actions">
        <button data-task-context-focusable="true" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          data-task-context-focusable="true"
          className="primary-button"
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  )
}

function TaskContextMenu({
  anchor,
  areas,
  backlogGroups,
  onAddToCalendar,
  onAssignProject,
  onDeleteTask,
  onClose,
  onMoveArea,
  onMoveToHorizon,
  onMoveToDate,
  onOpenTask,
  onRemoveFromCalendar,
  point,
  projects,
  task,
  isSession = false,
}) {
  const calendarSessions = useCalendarSessions()
  const menuRef = useRef(null)
  const panelRef = useRef(null)
  const panelReturnItemRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const [panel, setPanel] = useState(null)
  const [position, setPosition] = useState(null)
  const [recurrenceDraft, setRecurrenceDraft] = useState(null)
  const [pendingRepeat, setPendingRepeat] = useState(null)
  const [repeatTasksDraft, setRepeatTasksDraft] = useState(true)
  onCloseRef.current = onClose
  const sessions = calendarSessions?.taskSessions.get(task.id) || []
  const scheduled = Boolean(task.time) || sessions.length > 0
  const sessionOnly = !task.time && sessions.length > 0
  const recurrenceDateKey = isSession
    ? task.recurrenceStartDateKey || task.dateKey || localDateKey()
    : localDateKey()
  const currentRecurrence = task.recurrence?.preset || RECURRENCE_PRESETS.NONE
  const currentRepeatsTasks = task.recurrenceSeriesId
    ? calendarSessions?.sessionRepeatsTasks?.(task.recurrenceSeriesId)
    : undefined
  const sessionTaskTemplates = task.recurrenceSeriesId
    ? (calendarSessions?.sessionTaskTemplateCount?.(task.recurrenceSeriesId) ?? 0)
    : 0
  const sessionHasTasks = (task.taskIds?.length || 0) > 0 || sessionTaskTemplates > 0
  const currentProject = projects.find((project) => project.id === task.objectiveId)
  const currentHorizon = backlogGroups.find((group) => group.items.some((item) => item.id === task.id))
  const currentColor = isSession ? AREA_COLOR_OPTIONS.find((option) => option.id === task.color) : undefined
  const activeProjects = projects.filter((project) => !project.complete && project.channel === task.channel)
  const projectChoices =
    currentProject && !activeProjects.some((project) => project.id === currentProject.id)
      ? [currentProject, ...activeProjects]
      : activeProjects

  const close = useCallback((restoreFocus = false) => onCloseRef.current(restoreFocus), [])
  const openPanel = (nextPanel) => setPanel(nextPanel)
  const closePanel = () => {
    panelReturnItemRef.current = panel?.returnItem || 'project'
    setPanel(null)
  }
  const apply = (operation) => {
    operation?.()
    close()
  }
  /** Choosing a repeat rule always asks how the session's tasks should repeat. */
  const requestRepeat = (recurrence) => {
    if (!recurrence || recurrence.frequency === 'none') {
      apply(() => calendarSessions.updateRecurrence(task.id, recurrence))
      return
    }
    setPendingRepeat(recurrence)
    setRepeatTasksDraft(currentRepeatsTasks ?? sessionHasTasks)
    openPanel({ type: 'repeat-scope', returnItem: 'repeat' })
  }
  const applyRepeatScope = (repeatTasks) => {
    const recurrence = pendingRepeat
    setPendingRepeat(null)
    apply(() => calendarSessions.updateRecurrence(task.id, recurrence, sessionHasTasks && repeatTasks))
  }

  useLayoutEffect(() => {
    const placeMenus = () => {
      const anchorBounds = anchor?.getBoundingClientRect()
      const menuBounds = menuRef.current?.getBoundingClientRect()
      if (!anchorBounds || !menuBounds || !anchor.isConnected) {
        close()
        return
      }

      const viewportPadding = 8
      const pointerGap = 8
      const menuLeft = clamp(
        point?.x ?? anchorBounds.left,
        viewportPadding,
        Math.max(viewportPadding, window.innerWidth - menuBounds.width - viewportPadding),
      )
      const menuTop = clamp(
        (point?.y ?? anchorBounds.bottom) + pointerGap,
        viewportPadding,
        Math.max(viewportPadding, window.innerHeight - menuBounds.height - viewportPadding),
      )
      const nextPosition = { menuLeft, menuTop }

      const panelBounds = panelRef.current?.getBoundingClientRect()
      if (panelBounds) {
        nextPosition.panelLeft =
          menuLeft + menuBounds.width + 6 + panelBounds.width <= window.innerWidth - viewportPadding
            ? menuLeft + menuBounds.width + 6
            : clamp(
                menuLeft - panelBounds.width - 6,
                viewportPadding,
                window.innerWidth - panelBounds.width - viewportPadding,
              )
        nextPosition.panelTop = clamp(
          menuTop,
          viewportPadding,
          Math.max(viewportPadding, window.innerHeight - panelBounds.height - viewportPadding),
        )
      }
      setPosition(nextPosition)
    }

    placeMenus()
    const observer = new ResizeObserver(placeMenus)
    if (menuRef.current) observer.observe(menuRef.current)
    if (panelRef.current) observer.observe(panelRef.current)
    window.addEventListener('resize', placeMenus)
    window.addEventListener('scroll', placeMenus, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', placeMenus)
      window.removeEventListener('scroll', placeMenus, true)
    }
  }, [anchor, panel, point, close])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!panel && panelReturnItemRef.current) {
        focusMenuItem(menuRef.current, panelReturnItemRef.current)
        panelReturnItemRef.current = null
      } else if (panel?.type === 'repeat-custom') {
        panelRef.current?.querySelector('button, input, select')?.focus({ preventScroll: true })
      } else {
        focusFirstItem(panel ? panelRef.current : menuRef.current)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [panel])

  useEffect(() => {
    const dismiss = (event) => {
      // Dropdown menus portal outside the panel; keep the context menu open while they are used.
      if (event.target.closest?.('.dropdown-menu')) return
      if (
        !anchor?.contains(event.target) &&
        !menuRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      ) {
        close()
      }
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
    }
  }, [anchor, close])

  const handleKeyDown = (event) => {
    const container = event.currentTarget
    const controls = [...container.querySelectorAll(MENU_FOCUSABLE_SELECTOR)]
    const index = controls.indexOf(document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      if (panel) closePanel()
      else close(true)
      return
    }
    // Native form controls in the custom repeat panel keep their own arrow-key behavior.
    if (panel?.type === 'repeat-custom' && document.activeElement?.matches?.('input, select, textarea'))
      return
    if (event.key === 'ArrowLeft') {
      if (!panel) return
      event.preventDefault()
      closePanel()
      return
    }
    if (event.key === 'ArrowRight') {
      const nextPanel = document.activeElement?.dataset.taskContextPanel
      if (!nextPanel) return
      event.preventDefault()
      openPanel({ type: nextPanel, returnItem: document.activeElement.dataset.taskContextItem })
      return
    }
    if (event.key === 'Tab') {
      // The custom repeat panel contains form controls; let native focus traversal stay inside it.
      if (panel?.type === 'repeat-custom') return
      close()
      return
    }
    let nextIndex
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % controls.length
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + controls.length) % controls.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = controls.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    controls[nextIndex]?.focus()
  }

  const moveToArea = (area) => {
    if (area.label === task.channel) return close()
    if (currentProject && currentProject.channel !== area.label) {
      openPanel({ type: 'area-confirm', area, returnItem: 'area' })
      return
    }
    apply(() => onMoveArea?.(task.id, area.label))
  }

  const removeFromCalendar = () => {
    if (sessionOnly) calendarSessions?.removeTaskFromSessions(task.id)
    else onRemoveFromCalendar?.(task.id, anchor)
    close()
  }

  const renderPanel = () => {
    if (!panel) return null
    if (panel.type === 'delete' && isSession && task.recurrenceSeriesId) {
      return (
        <>
          <span className="task-context-menu-title">Delete recurring session?</span>
          <p className="task-context-menu-hint">Its tasks will stay in your lists.</p>
          <TaskContextMenuOption
            icon={<X size={15} />}
            itemId="delete-cancel"
            label="Cancel"
            onSelect={closePanel}
          />
          <TaskContextMenuOption
            danger
            icon={<Trash size={15} />}
            itemId="delete-single"
            label="This session only"
            detail="Removes only this occurrence"
            onSelect={() => apply(() => calendarSessions.removeSession(task.id, 'single'))}
          />
          <TaskContextMenuOption
            danger
            icon={<ArrowsClockwise size={15} />}
            itemId="delete-following"
            label="This and following sessions"
            detail="Removes later occurrences"
            onSelect={() => apply(() => calendarSessions.removeSession(task.id, 'following'))}
          />
        </>
      )
    }
    if (panel.type === 'delete' && isSession) {
      return (
        <TaskContextMenuConfirmation
          confirmLabel="Delete session"
          description="Its tasks will stay in your lists."
          title="Delete this session?"
          onCancel={closePanel}
          onConfirm={() => apply(() => calendarSessions.removeSession(task.id, 'single'))}
        />
      )
    }
    if (panel.type === 'delete') {
      return (
        <>
          <span className="task-context-menu-title">
            {task.recurrenceSeriesId ? 'Delete recurring task?' : 'Delete this task?'}
          </span>
          <TaskContextMenuOption
            icon={<X size={15} />}
            itemId="delete-cancel"
            label="Cancel"
            onSelect={closePanel}
          />
          <TaskContextMenuOption
            danger
            icon={<Trash size={15} />}
            itemId="delete-single"
            label={task.recurrenceSeriesId ? 'This task only' : 'Delete task'}
            onSelect={() => apply(() => onDeleteTask(task.id, 'single'))}
          />
          {task.recurrenceSeriesId ? (
            <TaskContextMenuOption
              danger
              icon={<ArrowsClockwise size={15} />}
              itemId="delete-following"
              label="This and following tasks"
              onSelect={() => apply(() => onDeleteTask(task.id, 'following'))}
            />
          ) : null}
        </>
      )
    }
    if (panel.type === 'date') {
      return (
        <>
          <span className="task-context-menu-title">Move to date</span>
          {taskDateShortcuts(localDateKey()).map((choice) => (
            <TaskContextMenuOption
              key={choice.id}
              itemId={`date-${choice.id}`}
              icon={<CalendarBlank size={15} />}
              label={choice.label}
              detail={dateFromKey(choice.dateKey).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
              onSelect={() =>
                apply(() =>
                  isSession
                    ? calendarSessions.update(task.id, { dateKey: choice.dateKey })
                    : onMoveToDate?.(task, choice.dateKey),
                )
              }
            />
          ))}
        </>
      )
    }
    if (panel.type === 'color') {
      return (
        <>
          <span className="task-context-menu-title">Background color</span>
          {task.recurrenceSeriesId ? (
            <p className="task-context-menu-hint">Applies to this session and later occurrences.</p>
          ) : null}
          <TaskContextMenuOption
            checked={!currentColor}
            icon={<CircleDashed size={15} />}
            itemId="color-default"
            label="Default"
            role="menuitemradio"
            onSelect={() => {
              if (!currentColor) return close()
              apply(() => calendarSessions.updateColor(task.id, null))
            }}
          />
          {AREA_COLOR_OPTIONS.length ? <TaskContextMenuDivider /> : null}
          {AREA_COLOR_OPTIONS.map((option) => (
            <TaskContextMenuOption
              checked={option.id === currentColor?.id}
              icon={
                <span
                  className="task-context-menu-swatch"
                  style={{ background: option.color }}
                  aria-hidden="true"
                />
              }
              itemId={`color-${option.id}`}
              key={option.id}
              label={option.label}
              role="menuitemradio"
              onSelect={() => {
                if (option.id === currentColor?.id) return close()
                apply(() => calendarSessions.updateColor(task.id, option.id))
              }}
            />
          ))}
        </>
      )
    }

    if (panel.type === 'repeat') {
      return (
        <>
          <span className="task-context-menu-title">Repeat session</span>
          {recurrenceOptions(recurrenceDateKey).map((option) => (
            <TaskContextMenuOption
              checked={currentRecurrence === option.value}
              icon={
                option.value === RECURRENCE_PRESETS.NONE ? (
                  <Prohibit size={15} />
                ) : (
                  <ArrowsClockwise size={15} />
                )
              }
              itemId={`repeat-${option.value}`}
              key={option.value}
              label={option.label}
              role="menuitemradio"
              onSelect={() => {
                if (option.value === RECURRENCE_PRESETS.CUSTOM) {
                  setRecurrenceDraft(
                    recurrenceForPreset(
                      RECURRENCE_PRESETS.CUSTOM,
                      recurrenceDateKey,
                      task.recurrence || noRecurrence(),
                    ),
                  )
                  openPanel({ type: 'repeat-custom', returnItem: 'repeat' })
                  return
                }
                if (option.value === RECURRENCE_PRESETS.NONE && !task.recurrenceSeriesId) return close()
                requestRepeat(
                  recurrenceForPreset(option.value, recurrenceDateKey, task.recurrence || noRecurrence()),
                )
              }}
            />
          ))}
        </>
      )
    }
    if (panel.type === 'repeat-custom') {
      return (
        <div className="task-context-menu-recurrence">
          <span className="task-context-menu-title">Custom repeat</span>
          {recurrenceDraft ? (
            <RecurrenceCustomFields
              dateKey={recurrenceDateKey}
              recurrence={recurrenceDraft}
              onChange={setRecurrenceDraft}
            />
          ) : null}
          <div className="task-context-menu-confirm-actions">
            <button data-task-context-focusable="true" type="button" onClick={() => closePanel()}>
              Cancel
            </button>
            <button
              data-task-context-focusable="true"
              className="primary-button"
              type="button"
              onClick={() => requestRepeat(recurrenceDraft)}
            >
              Save repeat
            </button>
          </div>
        </div>
      )
    }
    if (panel.type === 'repeat-scope') {
      return (
        <>
          <span className="task-context-menu-title">Repeat session</span>
          <p className="task-context-menu-hint">
            Repeat this session’s tasks with it, or repeat only the time slot?
          </p>
          <TaskContextMenuOption
            checked={sessionHasTasks && repeatTasksDraft}
            detail={
              sessionHasTasks
                ? 'Every occurrence starts with fresh copies'
                : 'Add tasks to this session first'
            }
            disabled={!sessionHasTasks}
            icon={<ArrowsClockwise size={15} />}
            itemId="repeat-scope-tasks"
            label="Repeat tasks with the session"
            role="menuitemradio"
            onSelect={() => applyRepeatScope(true)}
          />
          <TaskContextMenuOption
            checked={!sessionHasTasks || !repeatTasksDraft}
            icon={<Prohibit size={15} />}
            itemId="repeat-scope-session"
            label="Session only"
            detail="Occurrences are empty; this session keeps its tasks"
            role="menuitemradio"
            onSelect={() => applyRepeatScope(false)}
          />
          <TaskContextMenuDivider />
          <TaskContextMenuOption
            icon={<CaretLeft size={15} />}
            itemId="repeat-scope-back"
            label="Back"
            onSelect={closePanel}
          />
        </>
      )
    }

    if (panel.type === 'project') {
      return (
        <>
          <span className="task-context-menu-title">Project</span>
          <TaskContextMenuOption
            checked={!currentProject}
            icon={<PushPin mirrored size={15} />}
            itemId="no-project"
            label="No project"
            role="menuitemradio"
            onSelect={() => {
              if (!currentProject) return close()
              apply(() => onAssignProject?.(task, null))
            }}
          />
          {projectChoices.length ? <TaskContextMenuDivider /> : null}
          {projectChoices.length ? (
            projectChoices.map((project) => (
              <TaskContextMenuOption
                checked={project.id === currentProject?.id}
                detail={project.complete ? 'Completed project' : undefined}
                disabled={project.complete && project.id !== currentProject?.id}
                icon={<PushPin mirrored size={15} />}
                itemId={`project-${project.id}`}
                key={project.id}
                label={project.title}
                role="menuitemradio"
                onSelect={() => {
                  if (project.id === currentProject?.id) return close()
                  apply(() => onAssignProject?.(task, project.id))
                }}
              />
            ))
          ) : (
            <p className="task-context-menu-empty">No active projects in {task.channel}.</p>
          )}
        </>
      )
    }

    if (panel.type === 'horizon') {
      return (
        <>
          <span className="task-context-menu-title">Move to Horizon</span>
          {backlogGroups.map((group) => (
            <TaskContextMenuOption
              checked={group.id === currentHorizon?.id}
              icon={group.label === 'Someday' ? <Archive size={15} /> : <Stack size={15} />}
              itemId={`horizon-${group.id}`}
              key={group.id}
              label={group.label}
              role="menuitemradio"
              onSelect={() => {
                if (group.id === currentHorizon?.id) return close()
                apply(() => onMoveToHorizon?.(task, group.label))
              }}
            />
          ))}
        </>
      )
    }

    if (panel.type === 'area') {
      return (
        <>
          <span className="task-context-menu-title">Move to Area</span>
          {areas.map((area) => (
            <TaskContextMenuOption
              checked={area.label === task.channel}
              icon={<FolderSimple size={15} weight="fill" style={{ color: area.color }} />}
              itemId={`area-${area.id}`}
              key={area.id}
              label={area.label}
              role="menuitemradio"
              onSelect={() => moveToArea(area)}
            />
          ))}
        </>
      )
    }

    if (panel.type === 'area-confirm') {
      return (
        <TaskContextMenuConfirmation
          description={
            <>
              This will remove it from <strong>{currentProject?.title}</strong>.
            </>
          }
          title={`Move to ${panel.area.label}?`}
          onCancel={closePanel}
          onConfirm={() => apply(() => onMoveArea?.(task.id, panel.area.label, { unlinkFromProject: true }))}
        />
      )
    }

    if (panel.type === 'calendar-confirm') {
      return (
        <TaskContextMenuConfirmation
          confirmLabel="Remove"
          description={sessionOnly ? 'The task will be removed from its calendar session.' : undefined}
          title="Remove from calendar?"
          onCancel={closePanel}
          onConfirm={removeFromCalendar}
        />
      )
    }

    return null
  }

  const currentProjectLabel = currentProject?.title || 'No project'
  return createPortal(
    <>
      <div
        ref={menuRef}
        aria-label={`Actions for ${task.title}`}
        className="task-context-menu"
        role="menu"
        style={
          position
            ? { left: position.menuLeft, top: position.menuTop }
            : { left: 0, top: 0, visibility: 'hidden' }
        }
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="task-context-menu-title">{task.title}</span>
        {isSession ? (
          <>
            <TaskContextMenuOption
              icon={<ArrowSquareOut size={16} />}
              itemId="open"
              label="Open session details"
              onSelect={() => apply(() => calendarSessions.openSession(task.id, anchor))}
            />
            <TaskContextMenuOption
              icon={<Plus size={16} />}
              itemId="add-tasks"
              label="Add tasks"
              onSelect={() => apply(() => calendarSessions.openSession(task.id, anchor, true))}
            />
            <TaskContextMenuOption
              detail={
                task.recurrence ? recurrenceLabel(task.recurrence, recurrenceDateKey) : 'Does not repeat'
              }
              icon={<ArrowsClockwise size={16} />}
              itemId="repeat"
              label={task.recurrenceSeriesId ? 'Change repeat' : 'Repeat'}
              panel="repeat"
              onSelect={() => openPanel({ type: 'repeat', returnItem: 'repeat' })}
            />
            <TaskContextMenuOption
              icon={<CalendarBlank size={16} />}
              itemId="date"
              label="Move to date"
              panel="date"
              onSelect={() => openPanel({ type: 'date', returnItem: 'date' })}
            />
            <TaskContextMenuOption
              detail={currentColor?.label || 'Default'}
              icon={<Palette size={16} />}
              itemId="color"
              label="Background color"
              panel="color"
              onSelect={() => openPanel({ type: 'color', returnItem: 'color' })}
            />
            <TaskContextMenuDivider />
            <TaskContextMenuOption
              danger
              icon={<Trash size={16} />}
              itemId="delete"
              label="Delete session"
              panel="delete"
              onSelect={() => openPanel({ type: 'delete', returnItem: 'delete' })}
            />
          </>
        ) : (
          <>
            <TaskContextMenuOption
              disabled={!scheduled && task.complete}
              icon={scheduled ? <CalendarCheck size={16} /> : <CalendarPlus size={16} />}
              itemId="calendar"
              label={scheduled ? 'Remove from calendar' : 'Add to calendar'}
              onSelect={() => {
                if (scheduled) openPanel({ type: 'calendar-confirm', returnItem: 'calendar' })
                else apply(() => onAddToCalendar?.(task, anchor))
              }}
            />
            <TaskContextMenuDivider />
            <TaskContextMenuOption
              icon={<CalendarBlank size={16} />}
              itemId="date"
              label="Move to date"
              panel="date"
              onSelect={() => openPanel({ type: 'date', returnItem: 'date' })}
            />
            <TaskContextMenuOption
              detail={currentProjectLabel}
              icon={<PushPin mirrored size={16} />}
              itemId="project"
              label={currentProject ? 'Change project' : 'Assign to project'}
              panel="project"
              onSelect={() => openPanel({ type: 'project', returnItem: 'project' })}
            />
            <TaskContextMenuOption
              detail={currentHorizon?.label || (scheduled ? 'On calendar' : 'On board')}
              icon={<Stack size={16} />}
              itemId="horizon"
              label="Move to Horizon"
              panel="horizon"
              onSelect={() => openPanel({ type: 'horizon', returnItem: 'horizon' })}
            />
            <TaskContextMenuOption
              detail={task.channel}
              icon={<FolderSimple size={16} weight="fill" />}
              itemId="area"
              label="Move to Area"
              panel="area"
              onSelect={() => openPanel({ type: 'area', returnItem: 'area' })}
            />
            <TaskContextMenuDivider />
            <TaskContextMenuOption
              icon={<ArrowSquareOut size={16} />}
              itemId="open"
              label="Open task details"
              onSelect={() => apply(() => onOpenTask?.(task, anchor))}
            />
            <TaskContextMenuDivider />
            <TaskContextMenuOption
              danger
              icon={<Trash size={16} />}
              itemId="delete"
              label="Delete task"
              panel="delete"
              onSelect={() => openPanel({ type: 'delete', returnItem: 'delete' })}
            />
          </>
        )}
      </div>
      {panel ? (
        <div
          ref={panelRef}
          aria-label={`${panel.type} options for ${task.title}`}
          className="task-context-menu task-context-menu-panel"
          role="menu"
          style={
            position?.panelLeft !== undefined
              ? { left: position.panelLeft, top: position.panelTop }
              : { left: 0, top: 0, visibility: 'hidden' }
          }
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {renderPanel()}
        </div>
      ) : null}
    </>,
    document.body,
  )
}

export function TaskContextMenuProvider({
  areas,
  backlogGroups,
  children,
  onAddToCalendar,
  onAssignProject,
  onDeleteTask,
  onMoveArea,
  onMoveToHorizon,
  onMoveToDate,
  onOpenTask,
  onRemoveFromCalendar,
  projects,
}) {
  const [menu, setMenu] = useState(null)
  const close = (restoreFocus = false) => {
    const anchor = menu?.anchor
    setMenu(null)
    if (restoreFocus) requestAnimationFrame(() => anchor?.focus?.({ preventScroll: true }))
  }
  const open = (task, anchor, point, isSession = false) => {
    if (!task || !anchor) return
    setMenu({ task, anchor, point, isSession })
  }

  return (
    <TaskContextMenuContext.Provider value={{ open }}>
      {children}
      {menu ? (
        <TaskContextMenu
          key={`${menu.isSession ? 'session' : 'task'}:${menu.task.id}`}
          isSession={menu.isSession}
          anchor={menu.anchor}
          areas={areas}
          backlogGroups={backlogGroups}
          point={menu.point}
          projects={projects}
          task={menu.task}
          onAddToCalendar={onAddToCalendar}
          onAssignProject={onAssignProject}
          onDeleteTask={onDeleteTask}
          onClose={close}
          onMoveArea={onMoveArea}
          onMoveToHorizon={onMoveToHorizon}
          onMoveToDate={onMoveToDate}
          onOpenTask={onOpenTask}
          onRemoveFromCalendar={onRemoveFromCalendar}
        />
      ) : null}
    </TaskContextMenuContext.Provider>
  )
}

export function useTaskContextMenu(task, { disabled = false, isSession = false } = {}) {
  const context = useContext(TaskContextMenuContext)
  if (!context || !task || disabled) return {}

  const openMenu = (event, point) => {
    event.preventDefault()
    event.stopPropagation()
    const anchor = event.currentTarget.matches('.calendar-event')
      ? event.currentTarget.querySelector('.calendar-event-drag-surface')
      : event.currentTarget.matches('[data-session-task-id]')
        ? event.currentTarget.querySelector('.session-task-drag-handle')
        : event.currentTarget
    context.open(task, anchor, point, isSession)
  }

  return {
    onContextMenu: (event) => openMenu(event, { x: event.clientX, y: event.clientY }),
    onKeyDown: (event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      const bounds = event.currentTarget.getBoundingClientRect()
      openMenu(event, { x: bounds.left, y: bounds.bottom })
    },
  }
}

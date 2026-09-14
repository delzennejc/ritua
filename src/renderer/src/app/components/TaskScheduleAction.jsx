import { useEffect, useId, useRef, useState } from 'react'
import { CalendarCheck, CalendarPlus } from '@phosphor-icons/react'
import { TaskActionConfirmation } from './TaskActionConfirmation'
import { useAutoSchedule } from './AutoScheduleAnimation'
import { useCalendarSessions } from './session-context'

export function TaskScheduleAction({ task, onSchedule, onUnschedule }) {
  const autoSchedule = useAutoSchedule()
  const calendarSessions = useCalendarSessions()
  const sessions = calendarSessions?.taskSessions.get(task.id) || []
  const sessionOnly = !task.time && sessions.length > 0
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const id = useId()
  const scheduled = Boolean(task.time) || sessionOnly
  const showConfirmation = open && scheduled
  const Icon = scheduled ? CalendarCheck : CalendarPlus

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!scheduled) setOpen(false)
  }, [scheduled])

  return (
    <>
      <button
        ref={triggerRef}
        className={`icon-button small task-auto-schedule${scheduled ? ' scheduled' : ''}`}
        type="button"
        aria-label={scheduled ? `Unschedule ${task.title}` : `Auto schedule ${task.title}`}
        title={sessionOnly ? 'Remove from session' : scheduled ? 'Unschedule task' : 'Auto schedule'}
        aria-haspopup={scheduled ? 'dialog' : undefined}
        aria-expanded={scheduled ? showConfirmation : undefined}
        aria-controls={showConfirmation ? id : undefined}
        disabled={Boolean(autoSchedule)}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (scheduled) {
            setOpen((current) => !current)
          } else {
            onSchedule?.(event.currentTarget.closest('.task-card'))
          }
        }}
      >
        <Icon size={14} aria-hidden="true" />
      </button>
      {showConfirmation ? (
        <TaskActionConfirmation
          id={id}
          triggerRef={triggerRef}
          title={
            sessionOnly
              ? `Remove this task from ${sessions.length > 1 ? 'its sessions' : 'the session'}?`
              : 'Unschedule this task?'
          }
          confirmLabel="Unschedule"
          onClose={close}
          onConfirm={() => {
            if (sessionOnly) calendarSessions.removeTaskFromSessions(task.id)
            else onUnschedule?.(task.id, triggerRef.current?.closest('.task-card'))
          }}
        />
      ) : null}
    </>
  )
}

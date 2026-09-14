import { useEffect, useRef, useState } from 'react'
import { CalendarBlank, X } from '@phosphor-icons/react'
import { CURRENT_DATE_KEY } from '../utils/dates'

export function ScheduleTaskDialog({ initialDateKey = CURRENT_DATE_KEY, onCancel, onSchedule, taskTitle }) {
  const dialogRef = useRef(null)
  const dateInputRef = useRef(null)
  const [dateKey, setDateKey] = useState(initialDateKey)

  useEffect(() => {
    dateInputRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll('input, button'))
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
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div
      className="modal-backdrop schedule-task-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form
        ref={dialogRef}
        aria-label={`Schedule ${taskTitle}`}
        className="schedule-task-dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => {
          event.preventDefault()
          const selectedDateKey = event.currentTarget.elements.namedItem('dateKey')?.value
          if (selectedDateKey) onSchedule(selectedDateKey)
        }}
      >
        <header>
          <span className="schedule-task-dialog-icon">
            <CalendarBlank size={19} />
          </span>
          <span>
            <small>Move to Scheduled</small>
            <h2>{taskTitle}</h2>
          </span>
          <button aria-label="Cancel scheduling" type="button" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <label>
          <span>Choose a date</span>
          <input
            ref={dateInputRef}
            min={CURRENT_DATE_KEY}
            name="dateKey"
            type="date"
            value={dateKey}
            onChange={(event) => setDateKey(event.target.value)}
          />
        </label>
        <footer>
          <span>The Task keeps its Area and selected Project.</span>
          <div>
            <button className="secondary-button" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              Schedule
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}

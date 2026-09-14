import { useEffect, useRef, useState } from 'react'
import { DEFAULT_AREAS } from '../../../../domain/workspace-defaults'
import { CURRENT_DATE_KEY } from '../utils/dates'
import { noRecurrence, recurrenceForPreset } from '../../../../domain/recurrence'
import { TaskComposer } from './TaskComposer'

export function AddTaskForm({
  areas = DEFAULT_AREAS,
  dateKey = CURRENT_DATE_KEY,
  initialArea,
  initialRecurrencePreset,
  objectiveId,
  onAdd,
  onClose,
}) {
  const formRef = useRef(null)
  const titleInputRef = useRef(null)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [taskDateKey, setTaskDateKey] = useState(dateKey)
  const [area, setArea] = useState(() => initialArea || areas[0]?.label || 'Ritua')
  const [recurrence, setRecurrence] = useState(() =>
    initialRecurrencePreset ? recurrenceForPreset(initialRecurrencePreset, dateKey) : noRecurrence(),
  )

  useEffect(() => {
    titleInputRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !formRef.current) return

      const focusable = Array.from(formRef.current.querySelectorAll('input, select, button'))
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
  }, [onClose])

  const submit = (event) => {
    event.preventDefault()
    if (!title.trim()) return
    onAdd({
      area,
      dateKey: taskDateKey,
      minutes,
      objectiveId,
      recurrence,
      title: title.trim(),
    })
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <TaskComposer
        area={area}
        areas={areas}
        ariaLabel="Create a task"
        className="home-task-composer"
        dateKey={taskDateKey}
        formRef={formRef}
        helper="Enter to add · Esc to close"
        minutes={minutes}
        onAreaChange={setArea}
        onCancel={onClose}
        onDateChange={setTaskDateKey}
        onMinutesChange={setMinutes}
        onRecurrenceChange={setRecurrence}
        onSubmit={submit}
        onTitleChange={setTitle}
        submitLabel="Add task"
        title={title}
        titleInputRef={titleInputRef}
        recurrence={recurrence}
      />
    </div>
  )
}

import { useRef, useId, useState, useEffect } from 'react'
import { durationDraftFrom, durationMinutesFrom } from './editor-values.js'
import { minutesLabel } from '../../utils/time'

export function InlineDurationEditor({
  allowEmpty = false,
  label,
  maxMinutes,
  minMinutes = 1,
  onCommit,
  value,
}) {
  const inputRef = useRef(null)
  const triggerRef = useRef(null)
  const hintId = useId()
  const [draft, setDraft] = useState(() => durationDraftFrom(value))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const displayValue = minutesLabel(value)

  useEffect(() => {
    if (!editing) setDraft(durationDraftFrom(value))
  }, [editing, value])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const returnFocusToTrigger = () => {
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const commitDraft = ({ revertInvalid = false } = {}) => {
    const nextMinutes = durationMinutesFrom(draft)
    const validEmpty = nextMinutes === null && allowEmpty
    const validDuration =
      Number.isFinite(nextMinutes) &&
      nextMinutes >= minMinutes &&
      (maxMinutes === undefined || nextMinutes <= maxMinutes)

    if (!validEmpty && !validDuration) {
      if (revertInvalid) {
        setDraft(durationDraftFrom(value))
        setError('')
        setEditing(false)
        return true
      }
      if (nextMinutes === null) {
        setError('Enter a duration in minutes or H:MM.')
      } else if (!Number.isFinite(nextMinutes)) {
        setError('Use minutes or H:MM.')
      } else if (nextMinutes < minMinutes) {
        setError(`Enter at least ${minutesLabel(minMinutes)}.`)
      } else {
        setError(`Enter no more than ${minutesLabel(maxMinutes)} so this task ends by midnight.`)
      }
      return false
    }

    onCommit(validEmpty ? null : nextMinutes)
    setError('')
    setEditing(false)
    return true
  }

  const startEditing = () => {
    setDraft(durationDraftFrom(value))
    setError('')
    setEditing(true)
  }

  if (!editing) {
    return (
      <button
        ref={triggerRef}
        className="task-details-duration-trigger"
        type="button"
        aria-label={`Edit ${label}, currently ${displayValue}`}
        title="Click to edit"
        onClick={startEditing}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
          keyboardEvent.preventDefault()
          startEditing()
        }}
      >
        {displayValue}
      </button>
    )
  }

  return (
    <span className="task-details-duration-editor">
      <input
        ref={inputRef}
        className="task-details-duration-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={hintId}
        aria-invalid={Boolean(error)}
        aria-label={label}
        placeholder="--:--"
        title={error || 'Use minutes or H:MM'}
        value={draft}
        onBlur={() => commitDraft({ revertInvalid: true })}
        onChange={(changeEvent) => {
          setDraft(changeEvent.target.value)
          setError('')
        }}
        onKeyDown={(keyboardEvent) => {
          if (keyboardEvent.key === 'Enter') {
            keyboardEvent.preventDefault()
            if (commitDraft()) returnFocusToTrigger()
            return
          }
          if (keyboardEvent.key !== 'Escape') return
          keyboardEvent.preventDefault()
          keyboardEvent.stopPropagation()
          setDraft(durationDraftFrom(value))
          setError('')
          setEditing(false)
          returnFocusToTrigger()
        }}
      />
      {error ? (
        <span className="task-details-duration-error" id={hintId} role="alert">
          {error}
        </span>
      ) : (
        <span className="sr-only" id={hintId}>
          Enter minutes or a duration in H:MM format.
        </span>
      )}
    </span>
  )
}

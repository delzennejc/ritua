import { useRef, useState, useEffect } from 'react'

export function InlineSubtaskTitleEditor({ onCommit, value }) {
  const inputRef = useRef(null)
  const triggerRef = useRef(null)
  const editingRef = useRef(false)
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const returnFocusToTrigger = () => {
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const finishEditing = ({ cancel = false, returnFocus = false } = {}) => {
    if (!editingRef.current) return
    editingRef.current = false
    const nextTitle = draft.trim()
    const addSubtaskButton = inputRef.current
      ?.closest('.task-details')
      ?.querySelector('.task-details-add-subtask')
    if (!cancel && (!nextTitle || nextTitle !== value)) onCommit(nextTitle)
    setDraft(cancel ? value : nextTitle)
    setEditing(false)
    if (returnFocus) {
      if (!cancel && !nextTitle) requestAnimationFrame(() => addSubtaskButton?.focus())
      else returnFocusToTrigger()
    }
  }

  const startEditing = () => {
    editingRef.current = true
    setDraft(value)
    setEditing(true)
  }

  return (
    <span className="task-details-subtask-title">
      {editing ? (
        <input
          ref={inputRef}
          className="task-details-subtask-title-input"
          type="text"
          autoComplete="off"
          aria-label={`Subtask title for ${value}`}
          value={draft}
          onBlur={() => finishEditing()}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key === 'Enter') {
              if (keyboardEvent.nativeEvent.isComposing) return
              keyboardEvent.preventDefault()
              finishEditing({ returnFocus: true })
              return
            }
            if (keyboardEvent.key !== 'Escape') return
            keyboardEvent.preventDefault()
            keyboardEvent.stopPropagation()
            finishEditing({ cancel: true, returnFocus: true })
          }}
        />
      ) : (
        <button
          ref={triggerRef}
          className="task-details-subtask-title-trigger"
          type="button"
          aria-label={`Edit subtask title: ${value}`}
          title="Click to edit"
          onClick={startEditing}
          onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
            keyboardEvent.preventDefault()
            startEditing()
          }}
        >
          {value}
        </button>
      )}
    </span>
  )
}

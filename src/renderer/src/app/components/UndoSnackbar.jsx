import { useEffect, useRef } from 'react'
import { registerUndoHandler } from '../utils/undo-shortcut'

export function UndoSnackbar({ duration = 5000, message, notificationId, onDismiss, onUndo }) {
  const onDismissRef = useRef(onDismiss)
  const onUndoRef = useRef(onUndo)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    onUndoRef.current = onUndo
  }, [onUndo])

  // Cmd/Ctrl+Z activates the snackbar while it is visible.
  useEffect(() => registerUndoHandler(() => onUndoRef.current?.()), [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onDismissRef.current?.()
    }, duration)

    return () => window.clearTimeout(timeoutId)
  }, [duration, notificationId])

  return (
    <div
      className="undo-snackbar"
      role="status"
      aria-atomic="true"
      data-duration-ms={duration}
      style={{ '--undo-snackbar-duration': `${duration}ms` }}
    >
      <span className="undo-snackbar-message">{message}</span>
      <button
        className="undo-snackbar-action"
        type="button"
        aria-keyshortcuts="Meta+Z Control+Z"
        onClick={onUndo}
      >
        Undo
      </button>
      <span className="undo-snackbar-progress" aria-hidden="true">
        <span className="undo-snackbar-progress-fill" />
      </span>
    </div>
  )
}

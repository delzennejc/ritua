const handlers = []
let listening = false

/** True for Cmd+Z on macOS or Ctrl+Z elsewhere, but not Redo or modified keys. */
export function isUndoShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false
  if (event.altKey || event.shiftKey) return false
  if (!event.metaKey && !event.ctrlKey) return false
  return typeof event.key === 'string' && event.key.toLowerCase() === 'z'
}

/** Focused fields and editors keep their own native Undo instead of the app one. */
export function isEditableTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
}

function handleKeyDown(event) {
  if (!isUndoShortcut(event) || isEditableTarget(event.target)) return
  const handler = handlers[handlers.length - 1]
  if (!handler) return
  event.preventDefault()
  handler()
}

/**
 * The most recently shown Undo affordance answers Cmd/Ctrl+Z until it unmounts.
 * Returns the registration cleanup.
 */
export function registerUndoHandler(handler) {
  handlers.push(handler)
  if (!listening && typeof document !== 'undefined') {
    // Capture so focused boards and dialogs that stop key propagation cannot hide the shortcut.
    document.addEventListener('keydown', handleKeyDown, true)
    listening = true
  }
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
    if (listening && !handlers.length) {
      document.removeEventListener('keydown', handleKeyDown, true)
      listening = false
    }
  }
}

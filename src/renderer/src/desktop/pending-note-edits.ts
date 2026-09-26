// Note edits debounce their store commits; the native close handshake still flushes them.
type NoteFlush = () => void
const registered = new Set<NoteFlush>()
export function registerNoteFlush(flush: NoteFlush) {
  registered.add(flush)
  return () => registered.delete(flush)
}
export function flushNoteEdits() {
  for (const flush of [...registered]) flush()
}

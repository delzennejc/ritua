import { useState, useRef, useEffect } from 'react'
import { Paperclip } from '@phosphor-icons/react'
import type { AttachmentInfo } from '../../../shared/desktop-api'
export const previewFiles = new Map<string, File>()
const discard = (file: AttachmentInfo) => {
  previewFiles.delete(file.id)
  void window.ritua?.discardAttachment(file.id).catch(() => {})
}
export function useAttachmentDraft() {
  const [file, setFile] = useState<AttachmentInfo | ''>('')
  const current = useRef<AttachmentInfo | ''>('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (current.current) discard(current.current) } }, [])
  const select = (next: AttachmentInfo | '') => {
    if (!mounted.current) { if (next) discard(next); return }
    // An empty value is the successful submission acknowledgement from the composer.
    if (next && current.current && current.current.id !== next.id) discard(current.current)
    current.current = next; setFile(next)
  }
  return [file, select] as const
}
export function AttachmentPicker({ onChange }: { onChange: (file: AttachmentInfo) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const choose = async () => {
    setError(''); setBusy(true)
    try { const file = await window.ritua!.chooseAttachment(); if (file) onChange(file) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <><label className="task-details-attachment">
    <Paperclip size={19} /><span className="sr-only">Attach a file</span>
    {window.ritua ? <button type="button" aria-label="Attach a file" disabled={busy} onClick={() => void choose()} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} /> : <input type="file" onChange={event => {
      const file = event.target.files?.[0]; if (!file) return
      if (file.size > 25 * 1024 * 1024) { setError('Choose a file no larger than 25 MB.'); return }
      const id = crypto.randomUUID(); previewFiles.set(id, file); onChange({ id, name: file.name, size: file.size }); setError('')
    }} />}
  </label>{error && <span role="alert">{error}</span>}</>
}
export function AttachmentLink({ attachment }: { attachment: AttachmentInfo }) {
  const [error, setError] = useState('')
  const save = async () => {
    setError('')
    try {
      if (window.ritua) await window.ritua.exportAttachment(attachment.id)
      else {
        const file = previewFiles.get(attachment.id); if (!file) throw new Error('This preview file is no longer available.')
        const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = attachment.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (cause) { setError(String(cause)) }
  }
  return <><button type="button" onClick={() => void save()} style={{ background: 'none', border: 0, color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer' }}><Paperclip size={13} /> {attachment.name}</button>{error && <span role="alert">{error}</span>}</>
}

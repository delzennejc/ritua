import { createPortal } from 'react-dom'
import { trackMediaImport } from './pending-media'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Images, Plus, X, Copy, Check } from '@phosphor-icons/react'
import type { AttachmentInfo } from '../../../shared/desktop-api'
import { imageMime } from '../../../domain/task-media'
import { AttachmentLink, previewFiles } from './Attachments'

type Media = { attachment: AttachmentInfo }
const readDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('Unable to read image.'))
  reader.readAsDataURL(file)
})
function ImageViewer({ url, name, onClose, onCopy, copying, copied, error }: {
  url: string; name: string; onClose: () => void; onCopy: () => void
  copying: boolean; copied: boolean; error: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<dialog ref={dialog} className="task-image-viewer" aria-label={`Image viewer: ${name}`}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}>
    <header className="task-image-viewer-toolbar">
      <span>{name}</span>
      <button type="button" onClick={onCopy} disabled={copying} aria-label="Copy image" title={copied ? 'Copied!' : 'Copy image'}>{copied ? <Check size={20} /> : <Copy size={20} />}</button>
      <button type="button" onClick={onClose} aria-label="Close image viewer" autoFocus><X size={22} /></button>
    </header>
    <div className="task-image-viewer-stage" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
      <img src={url} alt={name} />
    </div>
    <span className="sr-only" role="status">{copied ? 'Image copied to clipboard' : ''}</span>
    {error ? <p className="task-image-viewer-error" role="alert">{error}</p> : null}
  </dialog>, document.body)
}
function MediaTile({ attachment, onRemove }: { attachment: AttachmentInfo; onRemove: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle')
  const [copyError, setCopyError] = useState('')
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copyState])
  const copyImage = async () => {
    setCopyState('copying'); setCopyError('')
    try {
      if (window.ritua) await window.ritua.copyTaskImage(attachment.id)
      else {
        const file = previewFiles.get(attachment.id)
        if (!file) throw new Error('This image is unavailable.')
        // Clipboard image support uses PNG; convert the preview file without changing the saved original.
        const png = (async () => {
          const bitmap = await createImageBitmap(file)
          try {
            const canvas = document.createElement('canvas')
            canvas.width = bitmap.width; canvas.height = bitmap.height
            const context = canvas.getContext('2d')
            if (!context) throw new Error('This image could not be copied.')
            context.drawImage(bitmap, 0, 0)
            return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This image could not be copied.')), 'image/png'))
          } finally { bitmap.close() }
        })()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      }
      setCopyState('copied')
    } catch (cause) {
      setCopyState('idle'); setCopyError(cause instanceof Error ? cause.message : 'This image could not be copied.')
    }
  }
  useEffect(() => {
    let active = true
    const file = previewFiles.get(attachment.id)
    const promise = window.ritua ? window.ritua.readTaskImage(attachment.id) : file ? readDataUrl(file) : Promise.reject(new Error('Image unavailable.'))
    void promise.then(value => { if (active) setUrl(value) }).catch(() => { if (active) setError('Image unavailable') })
    return () => { active = false }
  }, [attachment.id])
  return <li className="task-media-tile">
    <button className="task-media-preview" type="button" aria-label={`View image ${attachment.name}`} aria-haspopup="dialog" disabled={!url || Boolean(error)} onClick={() => setViewerOpen(true)}>
      {url && !error ? <img src={url} alt={attachment.name} onError={() => setError('Image unavailable')} /> : <span>{error || 'Loading image…'}</span>}
    </button>
    <div className="task-media-caption"><AttachmentLink attachment={attachment} /><span className="task-media-actions"><button type="button" aria-label={`Copy image ${attachment.name}`} title={copyState === 'copied' ? 'Copied!' : 'Copy image'} disabled={copyState === 'copying' || !url || Boolean(error)} onClick={() => void copyImage()}>{copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}</button><button type="button" aria-label={`Remove ${attachment.name}`} onClick={onRemove}><X size={15} /></button></span></div>
    {viewerOpen ? <ImageViewer url={url} name={attachment.name} onClose={() => setViewerOpen(false)} onCopy={() => void copyImage()} copying={copyState === 'copying'} copied={copyState === 'copied'} error={copyError} /> : null}
    <span className="sr-only" role="status">{copyState === 'copied' ? 'Image copied to clipboard' : ''}</span>
    {copyError ? <p className="task-media-error" role="alert">{copyError}</p> : null}
  </li>
}
export function TaskMedia({ media = [], onChange, dialogRef }: { media?: Media[]; onChange: (media: Media[]) => void; dialogRef: RefObject<HTMLElement | null> }) {
  const latest = useRef({ media, onChange }); latest.current = { media, onChange }
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const importing = useRef(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const importFiles = async (files: File[]) => {
    if (importing.current) { setError('Wait for the current images to finish importing.'); return }
    importing.current = true; setBusy(true); setError('')
    try {
      for (const file of files) {
        if (!mounted.current) break
        if (latest.current.media.length >= 100) throw new Error('A task can contain up to 100 images.')
        if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose images no larger than 25 MB each.')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const mime = imageMime(bytes)
        if (!mime) throw new Error('Use PNG, JPEG, GIF or WebP images.')
        if (!mounted.current) break
        const attachment = window.ritua
          ? await window.ritua.importTaskImage({ name: file.name || 'Pasted image.png', bytes })
          : { id: crypto.randomUUID(), name: file.name || 'Pasted image.png', size: file.size }
        if (!mounted.current) { await window.ritua?.discardAttachment(attachment.id); break }
        if (!window.ritua) previewFiles.set(attachment.id, new File([file], attachment.name, { type: mime }))
        const next = [...latest.current.media, { attachment }]
        latest.current.onChange(next)
        latest.current.media = next
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { importing.current = false; if (mounted.current) setBusy(false) }
  }
  const add = (files: File[]) => trackMediaImport(importFiles(files))
  const addRef = useRef(add); addRef.current = add
  useEffect(() => {
    mounted.current = true
    const dialog = dialogRef.current
    if (!dialog) return
    let depth = 0
    const isFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files')
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file)
      if (!files.length) return
      event.preventDefault(); event.stopPropagation(); void addRef.current(files)
    }
    const enter = (event: DragEvent) => { if (isFiles(event)) { event.preventDefault(); depth++; setDragging(true) } }
    const over = (event: DragEvent) => { if (isFiles(event)) { event.preventDefault(); event.dataTransfer!.dropEffect = 'copy' } }
    const leave = (event: DragEvent) => { if (isFiles(event) && --depth <= 0) { depth = 0; setDragging(false) } }
    const drop = (event: DragEvent) => {
      if (!isFiles(event)) return
      event.preventDefault(); event.stopPropagation(); depth = 0; setDragging(false)
      void addRef.current(Array.from(event.dataTransfer!.files))
    }
    dialog.addEventListener('paste', paste); dialog.addEventListener('dragenter', enter); dialog.addEventListener('dragover', over); dialog.addEventListener('dragleave', leave); dialog.addEventListener('drop', drop)
    return () => {
      mounted.current = false
      dialog.removeEventListener('paste', paste); dialog.removeEventListener('dragenter', enter); dialog.removeEventListener('dragover', over); dialog.removeEventListener('dragleave', leave); dialog.removeEventListener('drop', drop)
    }
  }, [dialogRef])
  return <section className={`task-media ${dragging ? 'dragging' : ''}`} aria-label="Media library" aria-busy={busy}>
    <header><span><Images size={17} /> Media {media.length ? <small>{media.length}</small> : null}</span><button type="button" disabled={busy} onClick={() => input.current?.click()}><Plus size={15} /> Add images</button></header>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void add(files) }} />
    {media.length ? <ul className="task-media-grid">{media.map(item => <MediaTile key={item.attachment.id} attachment={item.attachment} onRemove={() => latest.current.onChange(latest.current.media.filter(value => value.attachment.id !== item.attachment.id))} />)}</ul> : null}
    <p className="task-media-hint" role="status">{dragging ? 'Drop images to add them to this task' : busy ? 'Adding images…' : 'Paste or drop images anywhere in Task details'}</p>
    {error ? <p className="task-media-error" role="alert">{error}</p> : null}
  </section>
}

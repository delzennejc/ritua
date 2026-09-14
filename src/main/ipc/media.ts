import type { NativeIpcContext } from './context'
import { channels } from '../../shared/desktop-api'

import { attachmentIds } from '../../domain/attachment-references'
import { imageMime } from '../../domain/task-media'
import { nativeImage, clipboard, ClipboardItem } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { MAX_ATTACHMENT_BYTES } from '../recovery-files'

export function registerMediaIpc({
  register,
  database,
  recovery,
  isRestoring,
  attachmentLeases,
  chooseAttachment,
  exportAttachment,
}: NativeIpcContext) {
  register(channels.importTaskImage, (_event, input: unknown) => {
    if (isRestoring()) throw new Error('A backup is being restored')
    const file = input as { name?: unknown; bytes?: unknown } | null
    if (
      !file ||
      typeof file.name !== 'string' ||
      !file.name.trim() ||
      file.name.length > 255 ||
      /[\\/\x00-\x1f]/.test(file.name) ||
      !(file.bytes instanceof Uint8Array) ||
      !file.bytes.length ||
      file.bytes.length > MAX_ATTACHMENT_BYTES
    )
      throw new Error('Choose an image no larger than 25 MB.')
    const content = Buffer.from(file.bytes)
    if (!imageMime(content)) throw new Error('Use a PNG, JPEG, GIF or WebP image.')
    const stored = {
      id: randomUUID(),
      name: file.name,
      size: content.length,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
    database!.addAttachment(stored)
    attachmentLeases.add(stored.id)
    return { id: stored.id, name: stored.name, size: stored.size }
  })
  register(channels.copyTaskImage, (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid image')
    const file = database!.readAttachment(id)
    if (!file || !imageMime(file.content)) throw new Error('This image is unavailable.')
    const image = nativeImage.createFromBuffer(file.content)
    if (image.isEmpty()) throw new Error('This image could not be copied.')
    return clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(image.toPNG())], { type: 'image/png' }) }),
    ])
  })
  register(channels.readTaskImage, (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid image')
    const file = database!.readAttachment(id)
    const mime = file && imageMime(file.content)
    if (!file || !mime) throw new Error('This image is unavailable.')
    return `data:${mime};base64,${file.content.toString('base64')}`
  })
  register(channels.chooseAttachment, async (_event) => {
    const file = await chooseAttachment()
    if (file) attachmentLeases.add(file.id)
    return file
  })
  register(channels.exportAttachment, (_event, id) => {
    return exportAttachment(id)
  })
  register(channels.discardAttachment, async (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid attachment')
    if (isRestoring()) throw new Error('A backup is being restored')
    const pending = await recovery!.readRecovery()
    attachmentLeases.delete(id)
    database!.discardAttachment(id, attachmentIds(pending))
  })
  register(channels.attachmentStorage, (_event) => {
    return database!.attachmentStorage()
  })
}

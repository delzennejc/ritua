import type { Entity } from '../domain/workspace'
import type { WorkspaceDocument } from '../domain/workspace'
import type { openDatabase } from './db/database'
import type { BackupInfo } from '../shared/desktop-api'
import { attachmentIds } from '../domain/attachment-references'
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink, readdir, stat, chmod } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { durableFields, validateJson, validateDocument, validateSnapshot } from '../domain/workspace'
import type { RecoveryDraft } from '../domain/workspace-recovery'

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export interface StoredAttachment {
  id: string
  name: string
  size: number
  sha256: string
  content: Buffer
}
export function validateRecovery(value: unknown): asserts value is RecoveryDraft {
  validateJson(value, 0, 1_000_000)
  const draft = value as unknown as RecoveryDraft
  if (
    !draft?.base ||
    !draft.local ||
    typeof draft.savedAt !== 'string' ||
    JSON.stringify(value).length > 32_000_000
  )
    throw new Error('Invalid recovery draft')
  for (const doc of [draft.base, draft.local]) {
    validateDocument(doc)
    if (!Number.isSafeInteger(doc.revision) || doc.revision < 0) throw new Error('Invalid recovery revision')
    for (const key of Object.keys(doc.fields))
      if (![...durableFields, 'dateKeys'].includes(key as (typeof durableFields)[number]))
        throw new Error('Invalid recovery field')
  }
}
export function readBackup(filename: string) {
  const source = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    source.pragma('trusted_schema = OFF')
    if (source.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('This backup is damaged')
    for (const table of ['workspace_state', 'workspace_entities']) {
      if (
        !source
          .prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table' AND sql NOT LIKE '%VIRTUAL%'")
          .get(table)
      )
        throw new Error('This is not a Ritua workspace backup')
    }
    const state = source.prepare('SELECT revision, fields FROM workspace_state WHERE id=1').get() as
      | { revision: number; fields: string }
      | undefined
    if (!state || state.fields.length > 12_000_000) throw new Error('Invalid backup state')
    const rows = source
      .prepare('SELECT kind, entity_id, data FROM workspace_entities LIMIT 100001')
      .all() as { kind: Entity['kind']; entity_id: string; data: string }[]
    const document: WorkspaceDocument = {
      revision: state.revision,
      fields: JSON.parse(state.fields),
      entities: rows.map((row) => ({ kind: row.kind, id: row.entity_id, data: JSON.parse(row.data) })),
    }
    validateSnapshot(document)
    validateDocument(document)
    let attachments: StoredAttachment[] = []
    if (source.prepare("SELECT 1 FROM sqlite_master WHERE name='attachments' AND type='table'").get()) {
      const total = source.prepare('SELECT COALESCE(SUM(size),0) AS size FROM attachments').get() as {
        size: number
      }
      if (total.size > 512 * 1024 * 1024) throw new Error('Backup attachments exceed the restore limit')
      attachments = source
        .prepare('SELECT id,name,size,sha256,content FROM attachments')
        .all() as StoredAttachment[]
      for (const file of attachments) {
        if (
          !/^[a-zA-Z0-9-]{1,100}$/.test(file.id) ||
          typeof file.name !== 'string' ||
          file.name.length > 255 ||
          !Buffer.isBuffer(file.content) ||
          file.size !== file.content.length ||
          file.size > MAX_ATTACHMENT_BYTES ||
          createHash('sha256').update(file.content).digest('hex') !== file.sha256
        )
          throw new Error('Backup contains an invalid attachment')
      }
    }
    const ids = new Set(attachments.map((file) => file.id))
    for (const id of attachmentIds(document))
      if (!ids.has(id)) throw new Error('Backup is missing an attached file')
    return { document, attachments }
  } finally {
    source.close()
  }
}

export function recoveryFiles(directory: string, database: ReturnType<typeof openDatabase>) {
  const folder = join(directory, 'backups')
  const journal = join(directory, 'pending-edits.json')
  let journalQueue = Promise.resolve()
  let backupQueue = Promise.resolve()
  const writeRecovery = (draft: unknown) => {
    if (draft !== null) validateRecovery(draft)
    const next = journalQueue
      .catch(() => {})
      .then(async () => {
        if (!draft) {
          await unlink(journal).catch((error) => {
            if (error.code !== 'ENOENT') throw error
          })
          return
        }
        const temp = `${journal}.${randomUUID()}.tmp`
        await writeFile(temp, JSON.stringify(draft), { mode: 0o600, flush: true })
        await rename(temp, journal)
      })
    journalQueue = next
    return next
  }
  const readRecovery = async () => {
    await journalQueue.catch(() => {})
    try {
      const value: unknown = JSON.parse(await readFile(journal, 'utf8'))
      validateRecovery(value)
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      const preserved = `${journal}.preserved-${Date.now()}`
      await rename(journal, preserved)
      throw new Error(
        `The unreadable recovery copy was preserved at ${preserved}. Your saved workspace is intact.`,
      )
    }
  }
  const listBackups = async (): Promise<BackupInfo[]> => {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    const entries = await readdir(folder)
    return (
      await Promise.all(
        entries
          .filter((name) => /^ritua-[0-9T-]+-[a-z-]+\.sqlite$/.test(name))
          .map(async (id) => {
            const info = await stat(join(folder, id))
            return { id, createdAt: info.mtime.toISOString(), size: info.size }
          }),
      )
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const backupPath = (id: string) => {
    if (!/^ritua-[0-9T-]+-[a-z-]+\.sqlite$/.test(id) || basename(id) !== id)
      throw new Error('Invalid backup selection')
    return join(folder, id)
  }
  const createBackup = async (reason = 'manual') => {
    let result: BackupInfo | undefined
    const next = backupQueue
      .catch(() => {})
      .then(async () => {
        await mkdir(folder, { recursive: true, mode: 0o700 })
        const id = `ritua-${new Date().toISOString().replace(/[:.Z]/g, '-')}-${reason}.sqlite`
        const destination = backupPath(id)
        const temporary = `${destination}.tmp`
        await database.backup(temporary)
        await chmod(temporary, 0o600)
        // Verify every backup before publishing it as a restore point.
        readBackup(temporary)
        await rename(temporary, destination)
        const info = await stat(destination)
        result = { id, createdAt: info.mtime.toISOString(), size: info.size }
        const automated = (await listBackups()).filter((item) => item.id.endsWith('-auto.sqlite'))
        for (const obsolete of automated.slice(14)) await unlink(backupPath(obsolete.id))
      })
    backupQueue = next
    await next
    return result!
  }
  const exportBackup = async (destination: string) => {
    const backup = await createBackup('export')
    // Backups are standalone SQLite files, including attached file bytes.
    const contents = await readFile(backupPath(backup.id))
    await writeFile(destination, contents, { mode: 0o600, flush: true })
  }
  const restoreBackup = async (filename: string) => {
    const selected = readBackup(filename)
    await createBackup('before-restore')
    database.replaceWorkspace(selected.document, selected.attachments)
    await writeRecovery(null)
  }
  return { writeRecovery, readRecovery, createBackup, listBackups, backupPath, exportBackup, restoreBackup }
}

import { attachmentIds } from '../../domain/attachment-references'
import Database from 'better-sqlite3'
import { eq, lt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { initializeSchema } from './initialize-schema'
import { createHash } from 'node:crypto'
import { appMetadata, workspaceEntities, workspaceState, workspaceReceipts, attachments } from './schema'
import { applyChanges, validateCommit, validateDocument, WorkspaceValidationError, type WorkspaceDocument, type Entity } from '../../domain/workspace'
import { emptyWorkspace } from '../../domain/production-workspace'
import { rollWorkspaceDate, localDateKey } from '../../domain/live-calendar'
import { validateSnapshot } from '../../domain/workspace'

export function openDatabase(filename: string) {
  const sqlite = new Database(filename)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    const db = drizzle(sqlite)
    initializeSchema(sqlite)
    db.insert(appMetadata).values({ key: 'initializedAt', value: new Date().toISOString() }).onConflictDoNothing().run()
    if (!db.select().from(workspaceState).get()) {
      const initial = emptyWorkspace()
      validateDocument(initial)
      db.transaction(tx => {
        if(initial.entities.length) tx.insert(workspaceEntities).values(initial.entities.map(e=>({key:`${e.kind}:${e.id}`,kind:e.kind,entityId:e.id,data:e.data}))).run()
        tx.insert(workspaceState).values({id:1,revision:0,fields:initial.fields}).run()
      })
    }
    const loadWorkspace = (): WorkspaceDocument => {
      const state = db.select().from(workspaceState).get()!
      return {revision:state.revision,fields:state.fields,entities:db.select().from(workspaceEntities).all().map(e=>({kind:e.kind as Entity['kind'],id:e.entityId,data:e.data}))}
    }
    {
      const before = loadWorkspace()
      const next = rollWorkspaceDate(before, localDateKey())
      if (JSON.stringify(before) !== JSON.stringify(next)) db.transaction(tx => {
        tx.delete(workspaceEntities).run()
        if (next.entities.length) tx.insert(workspaceEntities).values(next.entities.map(e => ({ key: `${e.kind}:${e.id}`, kind: e.kind, entityId: e.id, data: e.data }))).run()
        tx.update(workspaceState).set({ revision: before.revision + 1, fields: next.fields }).where(eq(workspaceState.id, 1)).run()
      })
    }
    const reconcileAttachments = (protectedIds = new Set<string>(), now = Date.now()) => {
      const live = attachmentIds(loadWorkspace()); for (const id of protectedIds) live.add(id)
      const rows = sqlite.prepare('SELECT id,unreferenced_since FROM attachments').all() as { id: string; unreferenced_since: number }[]
      for (const row of rows) {
        if (live.has(row.id)) sqlite.prepare('UPDATE attachments SET unreferenced_since=0 WHERE id=?').run(row.id)
        else if (!row.unreferenced_since) sqlite.prepare('UPDATE attachments SET unreferenced_since=? WHERE id=?').run(now, row.id)
      }
      return live
    }
    reconcileAttachments()
    return {
      loadWorkspace,
      attachmentStorage() { const row = sqlite.prepare('SELECT COALESCE(SUM(size),0) AS used, COUNT(*) AS files FROM attachments').get() as { used: number; files: number }; return { ...row, limit: 512 * 1024 * 1024 } },
      discardAttachment(id: string, protectedIds = new Set<string>()) {
        const live = reconcileAttachments(protectedIds)
        if (!live.has(id)) db.delete(attachments).where(eq(attachments.id, id)).run()
      },
      collectAttachments(protectedIds = new Set<string>(), now = Date.now()) {
        reconcileAttachments(protectedIds, now)
        sqlite.prepare('DELETE FROM attachments WHERE unreferenced_since>0 AND unreferenced_since<?').run(now - 24 * 60 * 60 * 1000)
      },
      commitWorkspace(raw: unknown): {revision:number} {
        const command=validateCommit(raw)
        const digest=createHash('sha256').update(JSON.stringify(command)).digest('hex')
        return db.transaction(tx=>{
          const receipt=tx.select().from(workspaceReceipts).where(eq(workspaceReceipts.id,command.requestId)).get()
          if(receipt) {
            if(receipt.digest!==digest) throw new WorkspaceValidationError('Request ID was reused for a different change')
            return {revision:receipt.revision}
          }
          const result=applyChanges(loadWorkspace(),command)
          for(const e of command.remove) tx.delete(workspaceEntities).where(eq(workspaceEntities.key,`${e.kind}:${e.id}`)).run()
          for(const e of command.put) {
            const row={key:`${e.kind}:${e.id}`,kind:e.kind,entityId:e.id,data:e.data}
            tx.insert(workspaceEntities).values(row).onConflictDoUpdate({target:workspaceEntities.key,set:row}).run()
          }
          tx.update(workspaceState).set({revision:result.revision,fields:result.fields}).where(eq(workspaceState.id,1)).run()
          reconcileAttachments()
          tx.insert(workspaceReceipts).values({id:command.requestId,revision:result.revision,digest}).run()
          tx.delete(workspaceReceipts).where(lt(workspaceReceipts.revision,result.revision-256)).run()
          return {revision:result.revision}
        })
      },
      async backup(filename: string) { await sqlite.backup(filename) },
      readAttachment(id: string) { return db.select().from(attachments).where(eq(attachments.id, id)).get() },
      addAttachment(value: typeof attachments.$inferInsert) {
        const total = sqlite.prepare('SELECT COALESCE(SUM(size),0) AS size FROM attachments').get() as { size: number }
        if (total.size + value.size > 512 * 1024 * 1024) throw new WorkspaceValidationError('The workspace attachment limit is 512 MB.')
        db.insert(attachments).values({ ...value, unreferencedSince: Date.now() }).run()
      },
      replaceWorkspace(document: WorkspaceDocument, files: (typeof attachments.$inferInsert)[]) {
        validateSnapshot(document)
        validateDocument(document)
        db.transaction(tx => {
          const revision = loadWorkspace().revision + 1
          tx.delete(workspaceEntities).run()
          if (document.entities.length) tx.insert(workspaceEntities).values(document.entities.map(e => ({ key: `${e.kind}:${e.id}`, kind: e.kind, entityId: e.id, data: e.data }))).run()
          tx.update(workspaceState).set({ revision, fields: document.fields }).where(eq(workspaceState.id, 1)).run()
          tx.delete(workspaceReceipts).run()
          tx.delete(attachments).run()
          if (files.length) tx.insert(attachments).values(files).run()
        })
      },
      getInitializedAt(): string {
        const row = db.select().from(appMetadata).where(eq(appMetadata.key, 'initializedAt')).get()
        if (!row) throw new Error('Database initialization record is missing')
        return row.value
      },
      close: () => sqlite.close(),
    }
  } catch (error) { sqlite.close(); throw error }
}

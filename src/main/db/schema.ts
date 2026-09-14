import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'
import type { Data, Fields } from '../../domain/workspace'
export const appMetadata = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
export const workspaceEntities = sqliteTable('workspace_entities', {
  key: text('key').primaryKey(),
  kind: text('kind').notNull(),
  entityId: text('entity_id').notNull(),
  data: text('data', { mode: 'json' }).$type<Data>().notNull(),
})
export const workspaceState = sqliteTable('workspace_state', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  fields: text('fields', { mode: 'json' }).$type<Fields>().notNull(),
})
export const workspaceReceipts = sqliteTable('workspace_receipts', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  digest: text('digest').notNull(),
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  content: blob('content', { mode: 'buffer' }).notNull(),
  unreferencedSince: integer('unreferenced_since').notNull().default(0),
})

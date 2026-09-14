// Canonical desktop workspace records. No renderer, Electron or SQL imports.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Data = { [key: string]: Json }
export type Fields = Record<string, Json>
export interface Entity {
  kind: 'task' | 'project' | 'area' | 'event'
  id: string
  data: Data
}
export interface WorkspaceDocument {
  revision: number
  entities: Entity[]
  fields: Fields
}
export interface WorkspaceCommit {
  revision: number
  requestId: string
  put: Entity[]
  remove: { kind: Entity['kind']; id: string }[]
  fields: Fields
}

import { type Json, type WorkspaceDocument, type Entity } from './workspace'
export interface RecoveryDraft {
  base: WorkspaceDocument
  local: WorkspaceDocument
  savedAt: string
}
export type SaveResult =
  | { ok: true; revision: number }
  | { ok: false; kind: 'validation' | 'conflict' | 'storage'; message: string }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Merge independent edits automatically. Conflicting values require an explicit choice.
export function mergeWorkspace(
  base: WorkspaceDocument,
  local: WorkspaceDocument,
  remote: WorkspaceDocument,
  prefer: 'local' | 'remote' = 'local',
) {
  let conflicts = 0
  const merge = (
    before: Json | undefined,
    ours: Json | undefined,
    theirs: Json | undefined,
  ): Json | undefined => {
    if (equal(ours, before)) return theirs
    if (equal(theirs, before) || equal(ours, theirs)) return ours
    if (
      before &&
      ours &&
      theirs &&
      !Array.isArray(before) &&
      !Array.isArray(ours) &&
      !Array.isArray(theirs) &&
      typeof before === 'object' &&
      typeof ours === 'object' &&
      typeof theirs === 'object'
    ) {
      const result: Record<string, Json> = {}
      for (const key of new Set([...Object.keys(before), ...Object.keys(ours), ...Object.keys(theirs)])) {
        const value = merge(before[key], ours[key], theirs[key])
        if (value !== undefined) result[key] = value
      }
      return result
    }
    conflicts++
    return prefer === 'local' ? ours : theirs
  }
  const index = (doc: WorkspaceDocument) => new Map(doc.entities.map((e) => [`${e.kind}:${e.id}`, e]))
  const old = index(base),
    ours = index(local),
    theirs = index(remote)
  const entities: Entity[] = []
  for (const key of new Set([...old.keys(), ...ours.keys(), ...theirs.keys()])) {
    const result = merge(
      old.get(key) as unknown as Json,
      ours.get(key) as unknown as Json,
      theirs.get(key) as unknown as Json,
    )
    if (result) entities.push(result as unknown as Entity)
  }
  const fields = merge(base.fields, local.fields, remote.fields) as WorkspaceDocument['fields']
  return { document: { revision: remote.revision, fields, entities }, conflicts }
}

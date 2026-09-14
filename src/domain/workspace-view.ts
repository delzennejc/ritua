import { freeze } from 'immer'
import { editDocument } from './workspace-immutable'
import { project, normalize } from './workspace-projection'
import type { Fields, WorkspaceDocument } from './workspace-types'

/** Reuse equal branches without serializing them; canonical task content is already shared. */
function reuse(previous: unknown, next: unknown): unknown {
  if (previous === next) return previous
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(previous) !== Array.isArray(next)
  )
    return next
  const a = previous as Record<string, unknown>,
    b = next as Record<string, unknown>
  const keys = Object.keys(b)
  let same = keys.length === Object.keys(a).length
  const result: Record<string, unknown> = Array.isArray(next)
    ? ([] as unknown as Record<string, unknown>)
    : {}
  for (const key of keys) {
    result[key] = reuse(a[key], b[key])
    if (result[key] !== a[key] || !Object.hasOwn(a, key)) same = false
  }
  return same ? previous : result
}
export function createWorkspaceView() {
  const cache = new WeakMap<WorkspaceDocument, Fields>()
  let previous: Fields = {}
  let previousDocument: WorkspaceDocument | undefined
  return (document: WorkspaceDocument): Fields => {
    const cached = cache.get(document)
    if (cached) return cached
    let projected: Fields
    if (
      previousDocument?.entities === document.entities &&
      previousDocument.fields.dateKeys === document.fields.dateKeys &&
      previousDocument.fields.backlogGroups === document.fields.backlogGroups
    ) {
      projected = { ...document.fields }
      for (const key of [
        'tasks',
        'datedTasksByDate',
        'backlogGroups',
        'areas',
        'weeklyObjectives',
        'archivedObjectives',
        'weekly.accomplishedObjectives',
        'events',
      ])
        projected[key] = previous[key]!
      delete projected.dateKeys
    } else projected = project(document, false)
    const next = reuse(previous, projected) as Fields
    freeze(next, true)
    cache.set(document, next)
    previous = next
    previousDocument = document
    return next
  }
}

/** Collection commands reconcile a derived ordering with canonical records, without JSON round-trips. */
export function applyWorkspaceView(document: WorkspaceDocument, fields: Fields): WorkspaceDocument {
  const next = normalize(fields, document.revision, false)
  const before = new Map(document.entities.map((e) => [`${e.kind}:${e.id}`, e]))
  const records = new Map(
    next.entities.map((e) => [`${e.kind}:${e.id}`, reuse(before.get(`${e.kind}:${e.id}`), e) as typeof e]),
  )
  next.entities = [
    ...document.entities.flatMap((e) => {
      const value = records.get(`${e.kind}:${e.id}`)
      return value ? [value] : []
    }),
    ...next.entities.filter((e) => !before.has(`${e.kind}:${e.id}`)),
  ]
  next.fields = reuse(document.fields, next.fields) as Fields
  if (
    next.entities.length === document.entities.length &&
    next.entities.every((e, i) => e === document.entities[i])
  )
    next.entities = document.entities
  return next.entities === document.entities && next.fields === document.fields
    ? document
    : editDocument(document, (draft) => {
        draft.entities = next.entities
        draft.fields = next.fields
      })
}

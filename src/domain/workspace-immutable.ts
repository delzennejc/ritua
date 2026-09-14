import { freeze, produce } from 'immer'
import type { WorkspaceDocument } from './workspace-types'

/** Commands share untouched records. Frozen snapshots make reference-based caches safe. */
export function editDocument(document: WorkspaceDocument, edit: (draft: WorkspaceDocument) => void) {
  const next = produce(document, edit)
  return produce(next, (draft) => {
    // Original references avoid walking unchanged records through draft proxies.
    const cleanBranch = (value: unknown, prior: unknown, draftValue: unknown) => {
      if (value === prior || !value || typeof value !== 'object') return
      const record = value as Record<string, unknown>,
        before = prior as Record<string, unknown> | undefined,
        target = draftValue as Record<string, unknown>
      for (const key of Object.keys(record)) {
        if (record[key] === undefined && !Array.isArray(value)) delete target[key]
        else if (record[key] !== before?.[key]) cleanBranch(record[key], before?.[key], target[key])
      }
    }
    cleanBranch(next, document, draft)
  })
}
export function immutableDocument(document: WorkspaceDocument) {
  return freeze(document, true)
}
/** Undo records must be plain values, never live Immer drafts. */
export function copyRecord<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => copyRecord(item)) as T
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyRecord(item)])) as T
}

const serialized = new WeakMap<object, string>()
export function jsonText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return JSON.stringify(value)
  let text = serialized.get(value)
  if (text === undefined) {
    text = JSON.stringify(value)
    serialized.set(value, text!)
  }
  return text
}
export const equalJson = (a: unknown, b: unknown) => a === b || jsonText(a) === jsonText(b)

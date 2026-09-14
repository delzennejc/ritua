import { produce } from 'immer'
import type { Fields, WorkspaceDocument } from './workspace-types'
import { applyWorkspaceView, createWorkspaceView } from './workspace-view'

const selectView = createWorkspaceView()
type ViewResult = Fields | { fields: Fields; [key: string]: unknown } | null
export type DocumentResult<T> = T extends null
  ? null
  : T extends { fields: Fields }
    ? Omit<T, 'fields'> & { document: WorkspaceDocument }
    : WorkspaceDocument

/** Collection rules use ordered views; only changed records are reconciled back into the document. */
export function collectionCommand<R extends ViewResult>(
  document: WorkspaceDocument,
  operation: (fields: Fields) => R,
): DocumentResult<R> {
  let result!: R
  const state = produce({ fields: selectView(document), result: null as R | null }, (draft) => {
    result = operation(draft.fields)
    // Attaching the result to the draft finalizes every nested reference, including Undo metadata.
    draft.result = result as typeof draft.result
  })
  const value = state.result as R
  if (value === null) return null as DocumentResult<R>
  if (
    typeof value === 'object' &&
    'fields' in value &&
    value.fields &&
    typeof value.fields === 'object' &&
    !Array.isArray(value.fields)
  ) {
    const { fields, ...rest } = value
    return { ...rest, document: applyWorkspaceView(document, fields as Fields) } as DocumentResult<R>
  }
  return applyWorkspaceView(document, value as Fields) as DocumentResult<R>
}

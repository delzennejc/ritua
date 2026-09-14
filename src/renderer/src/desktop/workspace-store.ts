import type { EditableWorkspaceField } from '../../../domain/workspace-commands'
import { useCallback, useEffect, useState, type SetStateAction, type Dispatch } from 'react'
import { useStore } from 'zustand'
import type { Json } from '../../../domain/workspace'
import { createWorkspaceSession } from './workspace-session'
import { waitForMediaImports } from './pending-media'
import { refreshDateClock } from '../app/utils/dates'

const session = createWorkspaceSession(window.ritua, {
  async prepareClose() {
    await waitForMediaImports()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await Promise.resolve()
  },
  canRefreshDay: () =>
    !document.activeElement?.matches('input,textarea,[contenteditable="true"]') &&
    !document.querySelector('[role="dialog"],dialog[open]'),
  refreshDateClock,
})
export const {
  workspaceStore,
  initializeWorkspace,
  checkpointRecovery,
  beginWorkspaceGesture,
  endWorkspaceGesture,
  resolveWorkspaceConflict,
  flushWorkspace,
  flushBeforeClose,
  refreshWorkspaceDay,
  replaceWorkspaceDocument,
  getDocument: getWorkspaceDocument,
  getFields: getWorkspaceFields,
  selectFields: selectWorkspaceFields,
} = session
const { setField } = session

export function useWorkspaceState<T>(
  key: EditableWorkspaceField,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [fallback] = useState<T>(() => {
    const fields = getWorkspaceFields()
    return Object.hasOwn(fields, key)
      ? (fields[key] as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial
  })
  const value = useStore(workspaceStore, (state) =>
    Object.hasOwn(selectWorkspaceFields(state.document), key)
      ? (selectWorkspaceFields(state.document)[key] as T)
      : fallback,
  )
  useEffect(() => {
    if (!Object.hasOwn(getWorkspaceFields(), key)) setField(key, fallback as Json)
  }, [key, fallback])
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (update) => {
      const fields = getWorkspaceFields()
      const current = Object.hasOwn(fields, key) ? (fields[key] as T) : fallback
      setField(key, (typeof update === 'function' ? (update as (value: T) => T)(current) : update) as Json)
    },
    [key, fallback],
  )
  return [value, set]
}
if (import.meta.hot)
  import.meta.hot.accept(async () => {
    try {
      await flushBeforeClose()
      session.dispose()
      window.location.reload()
    } catch {
      /* Keep unsaved edits open. */
    }
  })

/** Task collections are read-only; a command changes their canonical entities. */
export function useWorkspaceProjection<T>(key: string, fallback: T): T {
  return useStore(workspaceStore, (state) => (selectWorkspaceFields(state.document)[key] as T) ?? fallback)
}

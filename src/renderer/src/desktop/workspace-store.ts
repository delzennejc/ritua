import { setProfileActor } from '../../../domain/local-profile'
import { rememberRecurrenceProgress } from '../../../domain/recurring-workspace'
import { useCallback, useEffect, useState, type SetStateAction, type Dispatch } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { changes, normalize, project, type Fields, type Json, type WorkspaceCommit, type WorkspaceDocument } from '../../../domain/workspace'
import { emptyWorkspace } from '../../../domain/production-workspace'
import { localDateKey, rollWorkspaceDate } from '../../../domain/live-calendar'
import { mergeWorkspace } from '../../../domain/workspace-recovery'
import { refreshDateClock } from '../app/utils/dates'

type ErrorKind = 'validation' | 'conflict' | 'storage' | null
export const workspaceStore = createStore<{
  fields: Fields; ready: boolean; error: string | null; errorKind: ErrorKind;
  saving: boolean; dayVersion: number; recoveryWarning: string | null; frozen: boolean;
}>(() => ({ fields: {}, ready: false, error: null, errorKind: null, saving: false, dayVersion: 0, recoveryWarning: null, frozen: false }))
let committed: WorkspaceDocument
let loading: Promise<void> | undefined
let saving: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let journalTimer: ReturnType<typeof setTimeout> | undefined
let attempt: { command: WorkspaceCommit; document: WorkspaceDocument } | undefined
let gesture: Fields | undefined
let preservedRecoveryWarning: string | null = null
let conflict: { base: WorkspaceDocument; remote: WorkspaceDocument } | undefined
const clone = <T>(value: T): T => structuredClone(value)
const hasChanges = (before: WorkspaceDocument, after: WorkspaceDocument) => {
  const change = changes(before, after, 'compare')
  return change.put.length || change.remove.length || JSON.stringify(change.fields) !== JSON.stringify(before.fields)
}
export function initializeWorkspace() {
  return loading ??= (async () => {
    committed = window.ritua ? await window.ritua.loadWorkspace() : emptyWorkspace()
    let fields = project(committed)
    let error: string | null = null
    let errorKind: ErrorKind = null
    if (window.ritua) {
      try {
        const draft = await window.ritua.readRecovery()
        if (draft) {
          const merged = mergeWorkspace(draft.base, draft.local, committed)
          fields = project(merged.document)
          if (merged.conflicts) {
            conflict = { base: draft.base, remote: committed }
            error = 'Recovered edits conflict with saved changes. Choose which conflicting values to keep.'
            errorKind = 'conflict'
          }
        }
      } catch (cause) { preservedRecoveryWarning = String(cause); workspaceStore.setState({ recoveryWarning: preservedRecoveryWarning }) }
    }
    workspaceStore.setState({ fields, ready: true, error, errorKind })
    if (!error) scheduleSave()
  })().catch(error => {
    loading = undefined
    workspaceStore.setState({ error: String(error), errorKind: 'storage' })
    throw error
  })
}
export async function checkpointRecovery() {
  clearTimeout(journalTimer)
  if (!window.ritua || !workspaceStore.getState().ready) return
  const local = normalize(gesture ?? workspaceStore.getState().fields, committed.revision)
  try {
    await window.ritua.writeRecovery(hasChanges(committed, local) ? { base: conflict?.base ?? committed, local, savedAt: new Date().toISOString() } : null)
    workspaceStore.setState({ recoveryWarning: preservedRecoveryWarning })
  } catch (cause) {
    workspaceStore.setState({ recoveryWarning: `A recovery copy could not be saved: ${String(cause)}` })
    throw cause
  }
}
function scheduleSave() {
  clearTimeout(timer)
  clearTimeout(journalTimer)
  const state = workspaceStore.getState()
  if (gesture || !state.ready || state.frozen) return
  journalTimer = setTimeout(() => { void checkpointRecovery().catch(() => {}) }, 15)
  if (state.error) return
  timer = setTimeout(() => { void flushWorkspace().catch(() => {}) }, 60)
}
function setField(key: string, value: Json) {
  const state = workspaceStore.getState()
  if (state.frozen || Object.is(state.fields[key], value)) return
  // Definite validation rejection was not committed; a corrected edit replaces it.
  workspaceStore.setState({ fields: { ...state.fields, [key]: value }, ...(state.errorKind === 'validation' ? { error: null, errorKind: null } : {}) })
  scheduleSave()
}
export function useWorkspaceState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [fallback] = useState<T>(() => {
    const fields = workspaceStore.getState().fields
    return Object.hasOwn(fields, key) ? fields[key] as T : typeof initial === 'function' ? (initial as () => T)() : initial
  })
  const value = useStore(workspaceStore, state => Object.hasOwn(state.fields, key) ? state.fields[key] as T : fallback)
  useEffect(() => { if (!Object.hasOwn(workspaceStore.getState().fields, key)) setField(key, fallback as Json) }, [key, fallback])
  const set = useCallback<Dispatch<SetStateAction<T>>>(update => {
    const fields = workspaceStore.getState().fields
    const current = Object.hasOwn(fields, key) ? fields[key] as T : fallback
    setField(key, (typeof update === 'function' ? (update as (value: T) => T)(current) : update) as Json)
  }, [key, fallback])
  return [value, set]
}
export function beginWorkspaceGesture() { gesture = clone(workspaceStore.getState().fields); clearTimeout(timer); clearTimeout(journalTimer) }
export function endWorkspaceGesture() { gesture = undefined; scheduleSave() }
export async function resolveWorkspaceConflict(prefer: 'local' | 'remote') {
  if (!conflict) return
  const local = normalize(workspaceStore.getState().fields, committed.revision)
  const merged = mergeWorkspace(conflict.base, local, conflict.remote, prefer)
  committed = conflict.remote
  conflict = undefined
  attempt = undefined
  workspaceStore.setState({ fields: project(merged.document), error: null, errorKind: null })
  await flushWorkspace()
}
export async function flushWorkspace(): Promise<void> {
  clearTimeout(timer)
  if (saving) { await saving; return flushWorkspace() }
  if (gesture || !workspaceStore.getState().ready) return
  if (conflict) throw new Error('Resolve conflicting edits before saving')
  saving = (async () => {
    workspaceStore.setState({ saving: true })
    try {
      await checkpointRecovery().catch(() => {})
      while (true) {
        if (!attempt) {
          const next = rememberRecurrenceProgress(normalize(workspaceStore.getState().fields, committed.revision), committed)
          workspaceStore.setState({ fields: project(next) })
          const command = changes(committed, next, crypto.randomUUID())
          if (!hasChanges(committed, next)) break
          attempt = { command, document: next }
        }
        const response = window.ritua ? await window.ritua.saveWorkspace(attempt.command) : { ok: true as const, revision: committed.revision + 1 }
        if (!response.ok) {
          if (response.kind === 'validation') attempt = undefined
          if (response.kind === 'conflict') {
            const remote = await window.ritua!.loadWorkspace()
            const local = normalize(workspaceStore.getState().fields, committed.revision)
            const merged = mergeWorkspace(committed, local, remote)
            attempt = undefined
            if (!merged.conflicts) {
              committed = remote
              workspaceStore.setState({ fields: project(merged.document) })
              continue
            }
            conflict = { base: committed, remote }
          }
          workspaceStore.setState({ error: response.message, errorKind: response.kind })
          throw new Error(response.message)
        }
        committed = { ...attempt.document, revision: response.revision }
        attempt = undefined
        workspaceStore.setState({ error: null, errorKind: null })
        if (gesture) break
      }
      await checkpointRecovery().catch(() => {})
    } catch (error) {
      if (!workspaceStore.getState().error) workspaceStore.setState({ error: error instanceof Error ? error.message : 'Could not save workspace', errorKind: 'storage' })
      throw error
    } finally { workspaceStore.setState({ saving: false }) }
  })()
  try { await saving } finally { saving = undefined }
}
export async function flushBeforeClose() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await Promise.resolve()
  if (gesture) { workspaceStore.setState({ fields: gesture }); gesture = undefined }
  await checkpointRecovery().catch(() => {})
  await flushWorkspace()
}
let rollingDay = false
export async function refreshWorkspaceDay() {
  if (rollingDay || gesture || !workspaceStore.getState().ready || workspaceStore.getState().fields.workspaceDate === localDateKey()) return
  if (document.activeElement?.matches('input,textarea,[contenteditable="true"]') || document.querySelector('[role="dialog"],dialog[open]')) return
  rollingDay = true
  try {
    await flushWorkspace()
    const next = rollWorkspaceDate(committed)
    refreshDateClock()
    workspaceStore.setState(state => ({ fields: project(next), dayVersion: state.dayVersion + 1 }))
    await flushWorkspace()
  } finally { rollingDay = false }
}
if (import.meta.hot) import.meta.hot.accept(async () => {
  try { await flushBeforeClose(); window.location.reload() } catch { /* Keep unsaved edits open. */ }
})

export function replaceWorkspaceFields(fields: Fields) {
  if (workspaceStore.getState().frozen) return
  workspaceStore.setState({ fields }); scheduleSave()
}

workspaceStore.subscribe(state => { const profile = state.fields.profile as { displayName?: string } | undefined; setProfileActor(profile?.displayName || "You") })

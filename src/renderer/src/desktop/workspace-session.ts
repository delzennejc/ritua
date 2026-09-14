import { changeWorkspaceField, type EditableWorkspaceField } from '../../../domain/workspace-commands'
import { validateImmutableSnapshot } from '../../../domain/workspace-validation'
import { immutableDocument, equalJson } from '../../../domain/workspace-immutable'
import { createWorkspaceView } from '../../../domain/workspace-view'
import type { WorkspaceDocument } from '../../../domain/workspace-types'
import type { Fields } from '../../../domain/workspace-types'
import type { WorkspaceCommit } from '../../../domain/workspace-types'
import type { Json } from '../../../domain/workspace-types'
import { rememberRecurrenceProgress } from '../../../domain/recurring-workspace'
import { createStore } from 'zustand/vanilla'
import { changes } from '../../../domain/workspace'
import { emptyWorkspace } from '../../../domain/production-workspace'
import { localDateKey, rollWorkspaceDate } from '../../../domain/live-calendar'
import { mergeWorkspace } from '../../../domain/workspace-recovery'
import { openPendingPlanning } from '../../../domain/planning-entry'

import type { DesktopApi } from '../../../shared/desktop-api'

export interface WorkspaceEnvironment {
  prepareClose?(): Promise<void>
  canRefreshDay?(): boolean
  refreshDateClock?(): void
}

/** One renderer session owns pending edits, save attempts, gestures and recovery. */
export type WorkspaceBridge = Pick<
  DesktopApi,
  'loadWorkspace' | 'saveWorkspace' | 'readRecovery' | 'writeRecovery'
>
export function createWorkspaceSession(bridge?: WorkspaceBridge, environment: WorkspaceEnvironment = {}) {
  type ErrorKind = 'validation' | 'conflict' | 'storage' | null
  const workspaceStore = createStore<{
    document: WorkspaceDocument | null
    ready: boolean
    error: string | null
    errorKind: ErrorKind
    saving: boolean
    dayVersion: number
    recoveryWarning: string | null
    frozen: boolean
  }>(() => ({
    document: null,
    ready: false,
    error: null,
    errorKind: null,
    saving: false,
    dayVersion: 0,
    recoveryWarning: null,
    frozen: false,
  }))
  let committed: WorkspaceDocument
  let loading: Promise<void> | undefined
  let saving: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let journalTimer: ReturnType<typeof setTimeout> | undefined
  let attempt: { command: WorkspaceCommit; document: WorkspaceDocument } | undefined
  let gesture: WorkspaceDocument | undefined
  let preservedRecoveryWarning: string | null = null
  let conflict: { base: WorkspaceDocument; remote: WorkspaceDocument } | undefined
  const hasChanges = (before: WorkspaceDocument, after: WorkspaceDocument) => {
    const change = changes(before, after, 'compare')
    return change.put.length || change.remove.length || !equalJson(change.fields, before.fields)
  }
  function initializeWorkspace() {
    return (loading ??= (async () => {
      committed = canonicalDocument(bridge ? await bridge.loadWorkspace() : emptyWorkspace())
      let document = committed
      let error: string | null = null
      let errorKind: ErrorKind = null
      if (bridge) {
        try {
          const draft = await bridge.readRecovery()
          if (draft) {
            const merged = mergeWorkspace(draft.base, draft.local, committed)
            document = merged.document
            if (merged.conflicts) {
              conflict = { base: draft.base, remote: committed }
              error = 'Recovered edits conflict with saved changes. Choose which conflicting values to keep.'
              errorKind = 'conflict'
            }
          }
        } catch (cause) {
          preservedRecoveryWarning = String(cause)
          workspaceStore.setState({ recoveryWarning: preservedRecoveryWarning })
        }
      }
      document = openPendingPlanning(document)
      publish({ document, ready: true, error, errorKind })
      if (!error) scheduleSave()
    })().catch((error) => {
      loading = undefined
      workspaceStore.setState({ error: String(error), errorKind: 'storage' })
      throw error
    }))
  }
  let journalWrites: Promise<void> = Promise.resolve()
  let lastJournal: { base: WorkspaceDocument; local: WorkspaceDocument } | null | undefined
  const sameSnapshot = (a: WorkspaceDocument, b: WorkspaceDocument) =>
    a.revision === b.revision && a.entities === b.entities && a.fields === b.fields
  async function checkpointRecovery() {
    applyPendingEdits()
    clearTimeout(journalTimer)
    if (!bridge || !workspaceStore.getState().ready) return
    const local = gesture ?? getDocument(),
      base = conflict?.base ?? committed
    const snapshot = hasChanges(committed, local) ? { base, local } : null
    // Recovery writes are ordered so a slower old checkpoint cannot replace a newer one.
    const write = journalWrites
      .catch(() => {})
      .then(async () => {
        if (
          (snapshot === null && lastJournal === null) ||
          (snapshot &&
            lastJournal &&
            sameSnapshot(snapshot.base, lastJournal.base) &&
            sameSnapshot(snapshot.local, lastJournal.local))
        )
          return
        try {
          await bridge.writeRecovery(snapshot ? { ...snapshot, savedAt: new Date().toISOString() } : null)
          lastJournal = snapshot
          workspaceStore.setState({ recoveryWarning: preservedRecoveryWarning })
        } catch (cause) {
          workspaceStore.setState({ recoveryWarning: `A recovery copy could not be saved: ${String(cause)}` })
          throw cause
        }
      })
    journalWrites = write
    return write
  }
  function scheduleSave() {
    clearTimeout(timer)
    clearTimeout(journalTimer)
    const state = workspaceStore.getState()
    if (gesture || !state.ready || state.frozen) return
    journalTimer = setTimeout(() => {
      void checkpointRecovery().catch(() => {})
    }, 15)
    if (state.error) return
    timer = setTimeout(() => {
      void flushWorkspace().catch(() => {})
    }, 60)
  }
  // Only canonical documents are staged or published. Projections are memoized reads.
  let pendingDocument: WorkspaceDocument | undefined
  let projectionQueued = false
  const projectView = createWorkspaceView()
  const emptyFields: Fields = Object.freeze({})
  function selectFields(document: WorkspaceDocument | null): Fields {
    return document ? projectView(document) : emptyFields
  }
  function getDocument(): WorkspaceDocument {
    const document = pendingDocument ?? workspaceStore.getState().document
    if (!document) throw new Error('Workspace is not ready')
    return document
  }
  function getFields(): Fields {
    return selectFields(pendingDocument ?? workspaceStore.getState().document)
  }
  function canonicalDocument(document: WorkspaceDocument) {
    const snapshot = immutableDocument(document)
    validateImmutableSnapshot(snapshot)
    return snapshot
  }
  function publish(
    update: Partial<ReturnType<typeof workspaceStore.getState>> & { document: WorkspaceDocument },
  ) {
    const document = canonicalDocument(update.document)
    pendingDocument = undefined
    workspaceStore.setState({ ...update, document })
  }
  function applyPendingEdits() {
    projectionQueued = false
    if (!pendingDocument) return
    const document = pendingDocument
    pendingDocument = undefined
    const state = workspaceStore.getState()
    workspaceStore.setState({
      document,
      ...(state.errorKind === 'validation' ? { error: null, errorKind: null } : {}),
    })
    scheduleSave()
  }
  function replaceWorkspaceDocument(next: WorkspaceDocument) {
    if (workspaceStore.getState().frozen) return
    // A rejected command leaves the last valid document and every projection intact.
    let document: WorkspaceDocument
    try {
      document = canonicalDocument(next)
    } catch (cause) {
      workspaceStore.setState({
        error: cause instanceof Error ? cause.message : String(cause),
        errorKind: 'validation',
      })
      throw cause
    }
    pendingDocument = document
    if (!projectionQueued) {
      projectionQueued = true
      queueMicrotask(applyPendingEdits)
    }
  }
  function setField(key: EditableWorkspaceField, value: Json) {
    const fields = getFields()
    if (Object.is(fields[key], value)) return
    replaceWorkspaceDocument(changeWorkspaceField(getDocument(), key, value))
  }
  function beginWorkspaceGesture() {
    applyPendingEdits()
    gesture = getDocument()
    clearTimeout(timer)
    clearTimeout(journalTimer)
  }
  function endWorkspaceGesture() {
    gesture = undefined
    scheduleSave()
  }
  async function resolveWorkspaceConflict(prefer: 'local' | 'remote') {
    if (!conflict) return
    const local = getDocument()
    const merged = mergeWorkspace(conflict.base, local, conflict.remote, prefer)
    committed = conflict.remote
    conflict = undefined
    attempt = undefined
    publish({ document: merged.document, error: null, errorKind: null })
    await flushWorkspace()
  }
  async function flushWorkspace(): Promise<void> {
    applyPendingEdits()
    clearTimeout(timer)
    if (saving) {
      await saving
      return flushWorkspace()
    }
    if (gesture || !workspaceStore.getState().ready) return
    if (conflict) throw new Error('Resolve conflicting edits before saving')
    saving = (async () => {
      workspaceStore.setState({ saving: true })
      try {
        await checkpointRecovery().catch(() => {})
        while (true) {
          if (!attempt) {
            const next = rememberRecurrenceProgress(
              { ...getDocument(), revision: committed.revision },
              committed,
            )
            publish({ document: next })
            const command = changes(committed, next, crypto.randomUUID())
            if (!hasChanges(committed, next)) break
            attempt = { command, document: next }
          }
          const response = bridge
            ? await bridge.saveWorkspace(attempt.command)
            : { ok: true as const, revision: committed.revision + 1 }
          if (!response.ok) {
            if (response.kind === 'validation') attempt = undefined
            if (response.kind === 'conflict') {
              const remote = await bridge!.loadWorkspace()
              const local = getDocument()
              const merged = mergeWorkspace(committed, local, remote)
              attempt = undefined
              if (!merged.conflicts) {
                committed = remote
                publish({ document: merged.document })
                continue
              }
              conflict = { base: committed, remote }
            }
            workspaceStore.setState({ error: response.message, errorKind: response.kind })
            throw new Error(response.message)
          }
          committed = immutableDocument({ ...attempt.document, revision: response.revision })
          attempt = undefined
          workspaceStore.setState({ error: null, errorKind: null })
          if (gesture) break
        }
        await checkpointRecovery().catch(() => {})
      } catch (error) {
        if (!workspaceStore.getState().error)
          workspaceStore.setState({
            error: error instanceof Error ? error.message : 'Could not save workspace',
            errorKind: 'storage',
          })
        throw error
      } finally {
        workspaceStore.setState({ saving: false })
      }
    })()
    try {
      await saving
    } finally {
      saving = undefined
    }
  }
  async function flushBeforeClose() {
    await environment.prepareClose?.()
    applyPendingEdits()
    if (gesture) {
      publish({ document: gesture })
      gesture = undefined
    }
    await checkpointRecovery().catch(() => {})
    await flushWorkspace()
  }
  let rollingDay = false
  async function refreshWorkspaceDay() {
    if (
      rollingDay ||
      gesture ||
      !workspaceStore.getState().ready ||
      getFields().workspaceDate === localDateKey()
    )
      return
    if (environment.canRefreshDay?.() === false) return
    rollingDay = true
    try {
      await flushWorkspace()
      const next = rollWorkspaceDate(committed)
      environment.refreshDateClock?.()
      publish({
        document: openPendingPlanning(next),
        dayVersion: workspaceStore.getState().dayVersion + 1,
      })
      await flushWorkspace()
    } finally {
      rollingDay = false
    }
  }
  return {
    workspaceStore,
    getFields,
    selectFields,
    setField,
    initializeWorkspace,
    checkpointRecovery,
    beginWorkspaceGesture,
    endWorkspaceGesture,
    resolveWorkspaceConflict,
    flushWorkspace,
    flushBeforeClose,
    refreshWorkspaceDay,
    replaceWorkspaceDocument,
    getDocument,
    dispose() {
      clearTimeout(timer)
      clearTimeout(journalTimer)
    },
  }
}

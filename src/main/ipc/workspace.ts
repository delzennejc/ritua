import type { NativeIpcContext } from './context'
import type { DesktopStatus } from '../../shared/desktop-api'
import type { SaveResult } from '../../domain/workspace-recovery'
import { channels } from '../../shared/desktop-api'

import { WorkspaceValidationError, WorkspaceConflictError } from '../../domain/workspace'
import { attachmentIds } from '../../domain/attachment-references'
import { app } from 'electron'

export function registerWorkspaceIpc({
  register,
  database,
  recovery,
  isRestoring,
  smoke,
  attachmentLeases,
  flush,
}: NativeIpcContext) {
  register(channels.getStatus, (_event): DesktopStatus => {
    return { appVersion: app.getVersion(), initializedAt: database!.getInitializedAt() }
  })
  register(channels.loadWorkspace, (_event) => {
    return database!.loadWorkspace()
  })
  register(channels.commitWorkspace, (_event, command: unknown) => {
    if (isRestoring()) throw new WorkspaceConflictError('Workspace changed during restore')
    return database!.commitWorkspace(command)
  })
  register(channels.saveWorkspace, (_event, command: unknown): SaveResult => {
    try {
      if (isRestoring())
        throw new WorkspaceConflictError('A backup is being restored. Wait for the workspace to reopen.')
      return { ok: true, ...database!.commitWorkspace(command) }
    } catch (cause) {
      return {
        ok: false,
        kind:
          cause instanceof WorkspaceValidationError
            ? 'validation'
            : cause instanceof WorkspaceConflictError
              ? 'conflict'
              : 'storage',
        message: cause instanceof Error ? cause.message : 'Could not save workspace',
      }
    }
  })
  register(channels.writeRecovery, (_event, draft) => {
    if (isRestoring()) throw new Error('A backup is being restored')
    return recovery!.writeRecovery(draft).then(() => {
      if (!smoke) database!.collectAttachments(attachmentIds(draft, new Set(attachmentLeases)))
    })
  })
  register(channels.readRecovery, (_event) => {
    return recovery!.readRecovery()
  })
  register(channels.flushReady, (_event, id: unknown, success: unknown) => {
    if (typeof id !== 'string' || typeof success !== 'boolean')
      throw new Error('Invalid close acknowledgement')
    flush.acknowledge(id, success)
  })
}

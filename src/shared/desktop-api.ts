import type { UpdateStatus } from './update-status'
import type { WorkspaceDocument, WorkspaceCommit } from '../domain/workspace'
import type { RecoveryDraft, SaveResult } from '../domain/workspace-recovery'
export interface AttachmentInfo { id: string; name: string; size: number }
export interface BackupInfo { id: string; createdAt: string; size: number }
export interface DesktopStatus { appVersion: string; initializedAt: string }
export interface DesktopApi {
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  installToApplications(): Promise<boolean>
  getStatus(): Promise<DesktopStatus>
  loadWorkspace(): Promise<WorkspaceDocument>
  commitWorkspace(command: WorkspaceCommit): Promise<{revision:number}>
  saveWorkspace(command: WorkspaceCommit): Promise<SaveResult>
  writeRecovery(draft: RecoveryDraft | null): Promise<void>
  readRecovery(): Promise<RecoveryDraft | null>
  discardAttachment(id: string): Promise<void>
  attachmentStorage(): Promise<{ used: number; files: number; limit: number }>
  chooseAttachment(): Promise<AttachmentInfo | null>
  exportAttachment(id: string): Promise<boolean>
  createBackup(): Promise<BackupInfo>
  listBackups(): Promise<BackupInfo[]>
  exportBackup(): Promise<boolean>
  restoreBackup(id?: string): Promise<boolean>
  onFlushRequested(callback:(requestId:string, freeze:boolean)=>void):()=>void
  confirmWorkspaceFlushed(requestId:string,success:boolean):Promise<void>
}
export const channels = { updateStatus:'ritua:update-status',checkUpdates:'ritua:check-updates',downloadUpdate:'ritua:download-update',installUpdate:'ritua:install-update',installApp:'ritua:install-app', discardAttachment:'ritua:discard-attachment',attachmentStorage:'ritua:attachment-storage', getStatus:'ritua:get-status',loadWorkspace:'ritua:load-workspace',commitWorkspace:'ritua:commit-workspace',flushRequest:'ritua:flush-request',flushReady:'ritua:flush-ready',saveWorkspace:'ritua:save-workspace',writeRecovery:'ritua:write-recovery',readRecovery:'ritua:read-recovery',chooseAttachment:'ritua:choose-attachment',exportAttachment:'ritua:export-attachment',createBackup:'ritua:create-backup',listBackups:'ritua:list-backups',exportBackup:'ritua:export-backup',restoreBackup:'ritua:restore-backup' } as const

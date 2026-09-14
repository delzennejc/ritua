import type { RegisterIpc } from './register'
import type { openDatabase } from '../db/database'
import type { recoveryFiles } from '../recovery-files'
import type { FlushCoordinator } from '../flush-coordinator'
import type { AttachmentInfo } from '../../shared/desktop-api'

export interface NativeIpcContext {
  register: RegisterIpc
  database: ReturnType<typeof openDatabase>
  recovery: ReturnType<typeof recoveryFiles>
  isRestoring(): boolean
  smoke: boolean
  attachmentLeases: Set<string>
  flush: FlushCoordinator
  chooseAttachment(): Promise<AttachmentInfo | null>
  exportAttachment(id: unknown): Promise<boolean>
  requireSaved(): Promise<void>
  exportBackup(): Promise<boolean>
  restoreBackup(id?: unknown): Promise<boolean>
}

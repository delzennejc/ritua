import type { WorkspaceDocument } from '../../../domain/workspace-types'
import { applyBulkWorkspaceAction, type BulkWorkspaceAction } from './bulk-workspace-actions'

type Request = { id: number; document: WorkspaceDocument; action: BulkWorkspaceAction }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, document, action } = event.data
  try {
    self.postMessage({ id, result: applyBulkWorkspaceAction(document, action) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

import type { WorkspaceDocument } from './workspace'
import { localDateKey } from './live-calendar'
import { normalize } from './workspace'
import { workspaceDefaults } from './workspace-defaults'

export function emptyWorkspace(today = localDateKey()): WorkspaceDocument {
  return normalize({ ...workspaceDefaults(), workspaceDate: today, view: 'today' })
}

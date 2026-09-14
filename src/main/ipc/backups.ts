import type { NativeIpcContext } from './context'
import { channels } from '../../shared/desktop-api'

export function registerBackupsIpc({
  register,
  recovery,
  requireSaved,
  exportBackup,
  restoreBackup,
}: NativeIpcContext) {
  register(channels.createBackup, async (_event) => {
    await requireSaved()
    return recovery!.createBackup()
  })
  register(channels.listBackups, (_event) => {
    return recovery!.listBackups()
  })
  register(channels.exportBackup, (_event) => {
    return exportBackup()
  })
  register(channels.restoreBackup, (_event, id) => {
    return restoreBackup(id)
  })
}

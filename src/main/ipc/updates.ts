import type { RegisterIpc } from './register'
import type { releaseUpdates } from '../updates'
import { channels } from '../../shared/desktop-api'

export function registerUpdatesIpc(register: RegisterIpc, updates: ReturnType<typeof releaseUpdates>) {
  register(channels.updateStatus, (_event) => {
    return updates.status()
  })
  register(channels.checkUpdates, (_event) => {
    return updates.check()
  })
  register(channels.downloadUpdate, (_event) => {
    return updates.download()
  })
  register(channels.installUpdate, (_event) => {
    return updates.install()
  })
  register(channels.installApp, (_event) => {
    return updates.installToApplications()
  })
}

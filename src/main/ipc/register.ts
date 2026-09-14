import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { channels } from '../../shared/desktop-api'

type Channel = (typeof channels)[keyof typeof channels]
export type RegisterIpc = (
  channel: Channel,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void

/** Every incoming command is authenticated before its handler receives any data. */
export function createIpcRegistrar(validateSender: (event: IpcMainInvokeEvent) => void): RegisterIpc {
  return (channel, handler) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      validateSender(event)
      return handler(event, ...args)
    })
  }
}

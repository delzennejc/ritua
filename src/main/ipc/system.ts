import type { RegisterIpc } from './register'
import { channels } from '../../shared/desktop-api'
import { openExternalUrl } from '../external-opener'

const OPENABLE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Note links leave the app through the OS handler; only web and mail targets are allowed. */
export function registerSystemIpc(register: RegisterIpc) {
  register(channels.openExternal, (_event, input: unknown) => {
    if (typeof input !== 'string' || input.length > 2048) throw new Error('Invalid link')
    let url: URL
    try {
      url = new URL(input)
    } catch {
      throw new Error('Invalid link')
    }
    if (!OPENABLE_PROTOCOLS.has(url.protocol)) throw new Error('Only web and email links can be opened')
    return Promise.resolve(openExternalUrl(url.toString())).then(() => true)
  })
}

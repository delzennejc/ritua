import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '../shared/update-status'
export function releaseUpdates(prepareInstall: () => Promise<void>, cancelInstall: () => void) {
  let feed = ''
  let installRequested = false
  if (app.isPackaged) {
    try { const config = JSON.parse(readFileSync(join(process.resourcesPath, 'release-channel.json'), 'utf8')) as { url?: string }; if (config.url) { const url = new URL(config.url); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid release channel'); feed = url.href } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Release channel unavailable', error) }
  }
  let state: UpdateStatus = { phase: feed ? 'idle' : 'unconfigured', currentVersion: app.getVersion(), message: feed ? 'Check for a newer version of Ritua.' : 'This local build has no published update channel. To update, quit Ritua and replace the app with a newer release. Your workspace stays in Application Support.', canInstallToApplications: app.isPackaged && process.platform === 'darwin' && !app.isInApplicationsFolder() }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed })
  autoUpdater.on('error', error => { if (installRequested) { installRequested = false; cancelInstall() }; state = { ...state, phase: 'error', message: error.message } })
  autoUpdater.on('update-available', info => { state = { ...state, phase: 'available', version: info.version, message: `Ritua ${info.version} is available.` } })
  autoUpdater.on('update-not-available', () => { state = { ...state, phase: 'current', message: 'You have the latest published version.' } })
  autoUpdater.on('download-progress', progress => { state = { ...state, phase: 'downloading', progress: progress.percent, message: 'Downloading update…' } })
  autoUpdater.on('update-downloaded', info => { state = { ...state, phase: 'downloaded', version: info.version, message: `Ritua ${info.version} is ready to install. Your work will be saved and backed up before restarting.` } })
  return {
    status: () => ({ ...state }),
    async check() {
      if (!feed) return { ...state }
      if (['checking', 'downloading', 'downloaded'].includes(state.phase)) return { ...state }
      state = { ...state, phase: 'checking', message: 'Checking for updates…' }
      try { await autoUpdater.checkForUpdates() } catch (cause) { state = { ...state, phase: 'error', message: String(cause) } }
      return { ...state }
    },
    async download() {
      if (!feed || state.phase !== 'available') throw new Error('Check for an available update first.')
      state = { ...state, phase: 'downloading', progress: 0, message: 'Downloading update…' }
      try { await autoUpdater.downloadUpdate() } catch (cause) { state = { ...state, phase: 'error', message: String(cause) }; throw cause }
    },
    async install() {
      if (state.phase !== 'downloaded') throw new Error('Download an update before installing it.')
      try { await prepareInstall(); installRequested = true; autoUpdater.quitAndInstall(false, true) } catch (cause) { cancelInstall(); throw cause }
    },
    async installToApplications() {
      if (!state.canInstallToApplications) return false
      try { await prepareInstall(); const moved = app.moveToApplicationsFolder(); if (!moved) cancelInstall(); return moved } catch (cause) { cancelInstall(); throw cause }
    },
  }
}

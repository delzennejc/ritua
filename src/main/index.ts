import type { IpcMainInvokeEvent } from 'electron'
import type { NativeIpcContext } from './ipc/context'
import { createIpcRegistrar } from './ipc/register'

import { registerWorkspaceIpc } from './ipc/workspace'
import { registerMediaIpc } from './ipc/media'
import { registerBackupsIpc } from './ipc/backups'
import { registerUpdatesIpc } from './ipc/updates'

import { releaseUpdates } from './updates'

import { app, BrowserWindow, dialog, Menu, screen } from 'electron'
import { mkdirSync, existsSync } from 'node:fs'
import { readFile, writeFile, stat, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { openDatabase } from './db/database'
import { databasePath } from './db/database-path'
import { FlushCoordinator } from './flush-coordinator'
import { recoveryFiles, readBackup, MAX_ATTACHMENT_BYTES } from './recovery-files'

import { channels } from '../shared/desktop-api'

app.setName('Ritua')
const explicitTest = process.env.RITUA_TEST_MODE === '1' && Boolean(process.env.RITUA_DATA_DIR)
const sessionSmoke = explicitTest && process.argv.includes('--session-smoke-test')
const liveSmoke = explicitTest && process.argv.includes('--live-smoke-test')
const smoke = explicitTest && (process.argv.includes('--smoke-test') || liveSmoke || sessionSmoke)
// An explicit process environment can isolate packaged QA without using the real profile.
const dataDirectory =
  process.env.RITUA_DATA_DIR || join(app.getPath('appData'), app.isPackaged ? 'Ritua' : 'Ritua Development')
mkdirSync(dataDirectory, { recursive: true })
app.setPath('userData', dataDirectory)
let database: ReturnType<typeof openDatabase> | undefined
let recovery: ReturnType<typeof recoveryFiles> | undefined
let window: BrowserWindow | null = null
let allowClose = false
let quitAfterClose = false
let closing = false
let recoveryDialog = false
let restoring = false
let installing = false
const attachmentLeases = new Set<string>()
let freezing = false
let backupTimer: ReturnType<typeof setInterval> | undefined
const flush = new FlushCoordinator((id) => {
  if (!window || window.webContents.isDestroyed() || window.webContents.isCrashed())
    throw new Error('Renderer unavailable')
  window.webContents.send(channels.flushRequest, id, freezing)
})
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  window?.show()
  window?.focus()
})
const rendererFile = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const DEFAULT_WINDOW_WIDTH = 1366
const DEFAULT_WINDOW_HEIGHT = 768
function validateSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame
  if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame)
    throw new Error('Untrusted sender')
  const actual = frame?.url
  if (
    devUrl
      ? new URL(actual ?? '').origin !== new URL(devUrl).origin
      : actual !== pathToFileURL(rendererFile).href
  )
    throw new Error('Untrusted origin')
}
async function reportError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (smoke) {
    console.error(message)
    return
  }
  await dialog.showMessageBox({
    type: 'error',
    message: 'Ritua could not complete this action',
    detail: message,
    buttons: ['OK'],
  })
}
async function recoveryDetail() {
  const draft = await recovery?.readRecovery().catch(() => null)
  return draft
    ? `Pending edits were copied for recovery at ${new Date(draft.savedAt).toLocaleTimeString()}. They will be offered again when Ritua opens. Changes made after that copy may be lost.`
    : 'Your last saved workspace is intact. Edits that have not reached storage may be lost.'
}
async function closeSafely() {
  if (closing) return
  closing = true
  try {
    const saved = await flush.request()
    if (!saved) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        message: 'Ritua could not finish saving',
        detail: await recoveryDetail(),
        buttons: ['Keep open', 'Quit and recover on next launch'],
        defaultId: 0,
        cancelId: 0,
      })
      if (result.response !== 1) {
        quitAfterClose = false
        return
      }
    }
    allowClose = true
    // destroy does not require a response from a crashed webContents.
    window?.destroy()
  } finally {
    closing = false
  }
}
async function rendererFailed() {
  flush.rendererGone()
  if (closing || recoveryDialog || smoke || !window) return
  recoveryDialog = true
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      message: 'The Ritua window stopped responding',
      detail: await recoveryDetail(),
      buttons: ['Wait', 'Reopen workspace', 'Quit'],
      defaultId: 0,
      cancelId: 0,
    })
    if (result.response === 1) window?.webContents.reload()
    if (result.response === 2) {
      allowClose = true
      quitAfterClose = true
      window?.destroy()
    }
  } finally {
    recoveryDialog = false
  }
}
async function requireSaved() {
  if (!(await flush.request()))
    throw new Error('Resolve the save error in the workspace before backing up or restoring.')
}
async function chooseAttachment() {
  const result = await dialog.showOpenDialog(window!, { title: 'Attach a file', properties: ['openFile'] })
  if (result.canceled || !result.filePaths[0]) return null
  const filename = result.filePaths[0]
  const info = await stat(filename)
  if (!info.isFile() || info.size > MAX_ATTACHMENT_BYTES)
    throw new Error('Choose a file no larger than 25 MB.')
  const content = await readFile(filename)
  if (content.length > MAX_ATTACHMENT_BYTES) throw new Error('Choose a file no larger than 25 MB.')
  const file = {
    id: randomUUID(),
    name: basename(filename),
    size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    content,
  }
  database!.addAttachment(file)
  return { id: file.id, name: file.name, size: file.size }
}
async function exportAttachment(id: unknown) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid attachment')
  const file = database!.readAttachment(id)
  if (!file) throw new Error('This attachment is unavailable in the saved workspace.')
  const result = await dialog.showSaveDialog(window!, { title: 'Save attached file', defaultPath: file.name })
  if (result.canceled || !result.filePath) return false
  await writeFile(result.filePath, file.content, { mode: 0o600, flush: true })
  return true
}
async function exportBackup() {
  await requireSaved()
  const result = await dialog.showSaveDialog(window!, {
    title: 'Export Ritua backup',
    defaultPath: `Ritua-${new Date().toISOString().slice(0, 10)}.sqlite`,
    filters: [{ name: 'Ritua backup', extensions: ['sqlite'] }],
  })
  if (result.canceled || !result.filePath) return false
  await recovery!.exportBackup(result.filePath)
  return true
}
async function restoreBackup(id?: unknown) {
  if (installing || restoring) throw new Error('Wait for the current installation or restore to finish.')
  await requireSaved()
  let filename: string | undefined
  if (id !== undefined) {
    if (typeof id !== 'string') throw new Error('Invalid backup')
    filename = recovery!.backupPath(id)
  } else {
    const selected = await dialog.showOpenDialog(window!, {
      title: 'Restore Ritua backup',
      properties: ['openFile'],
      filters: [{ name: 'Ritua backup', extensions: ['sqlite'] }],
    })
    if (selected.canceled) return false
    filename = selected.filePaths[0]
  }
  if (!filename) return false
  const preview = readBackup(filename)
  const result = await dialog.showMessageBox(window!, {
    type: 'warning',
    message: 'Restore this workspace?',
    detail: `${basename(filename)} contains ${preview.document.entities.filter((e) => e.kind === 'task').length} tasks and ${preview.attachments.length} attachments. A separate backup of your current workspace will be saved first.`,
    buttons: ['Cancel', 'Restore backup'],
    defaultId: 0,
    cancelId: 0,
  })
  if (result.response !== 1) return false
  if (installing || restoring) throw new Error('Wait for the current installation or restore to finish.')
  freezing = true
  try {
    await requireSaved()
  } catch (cause) {
    window?.webContents.send(channels.flushRequest, randomUUID(), false)
    throw cause
  } finally {
    freezing = false
  }
  restoring = true
  window!.destroy()
  try {
    await recovery!.restoreBackup(filename)
    return true
  } finally {
    restoring = false
    await createWindow()
    if (quitAfterClose) app.quit()
  }
}
function nativeMenu() {
  const run = (action: () => Promise<unknown>) => () => {
    void action().catch(reportError)
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Ritua',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'Back Up Now',
            click: run(async () => {
              await requireSaved()
              const backup = await recovery!.createBackup()
              await dialog.showMessageBox(window!, {
                message: 'Backup saved',
                detail: backup.id,
                buttons: ['OK'],
              })
            }),
          },
          { label: 'Export Backup…', click: run(exportBackup) },
          { label: 'Restore Backup…', click: run(() => restoreBackup()) },
          {
            label: 'Restore Automatic Backup…',
            click: run(async () => {
              const backups = await recovery!.listBackups()
              if (!backups.length) throw new Error('No saved backups are available yet.')
              const options = backups.slice(0, 14)
              const selected = await dialog.showMessageBox(window!, {
                message: 'Choose a restore point',
                buttons: ['Cancel', ...options.map((item) => new Date(item.createdAt).toLocaleString())],
                defaultId: 0,
                cancelId: 0,
              })
              if (selected.response > 0) await restoreBackup(options[selected.response - 1]!.id)
            }),
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload Workspace',
            accelerator: 'CmdOrCtrl+R',
            click: run(async () => {
              await requireSaved()
              window?.webContents.reload()
            }),
          },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
}
async function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const maximizeForSmallDisplay =
    workArea.width < DEFAULT_WINDOW_WIDTH || workArea.height < DEFAULT_WINDOW_HEIGHT
  const nextWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: 640,
    minHeight: 668,
    show: false,
    title: 'Ritua',
    backgroundColor: '#eeeff0',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window = nextWindow
  allowClose = false
  nextWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  nextWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  nextWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  nextWindow.webContents.on('render-process-gone', () => {
    void rendererFailed()
  })
  nextWindow.on('unresponsive', () => {
    void rendererFailed()
  })
  nextWindow.on('close', (event) => {
    if (!allowClose) {
      event.preventDefault()
      void closeSafely().catch(reportError)
    }
  })
  nextWindow.on('closed', () => {
    window = null
    flush.rendererGone()
    if (quitAfterClose) app.quit()
  })
  if (devUrl) await nextWindow.loadURL(devUrl)
  else await nextWindow.loadFile(rendererFile)
  if (maximizeForSmallDisplay) nextWindow.maximize()
  if (smoke) {
    const result = await (sessionSmoke
      ? (await import('../tests/calendar-sessions-smoke')).runCalendarSessionsSmoke(nextWindow)
      : liveSmoke
        ? (await import('../tests/live-smoke')).runLiveSmoke(nextWindow)
        : (await import('../tests/smoke')).runSmoke(nextWindow))
    console.log('RITUA_SMOKE ' + JSON.stringify(result))
    app.quit()
  } else nextWindow.show()
}
app
  .whenReady()
  .then(async () => {
    const filename = databasePath(dataDirectory)
    database = openDatabase(filename)
    if (smoke && !liveSmoke && !sessionSmoke && database.loadWorkspace().revision === 0)
      (await import('../tests/fixtures/workspace')).seedTestWorkspace(database)
    recovery = recoveryFiles(dataDirectory, database)
    const register = createIpcRegistrar(validateSender)
    const context: NativeIpcContext = {
      register,
      database,
      recovery,
      isRestoring: () => restoring,
      smoke,
      attachmentLeases,
      flush,
      chooseAttachment,
      exportAttachment,
      requireSaved,
      exportBackup,
      restoreBackup,
    }
    registerWorkspaceIpc(context)
    registerMediaIpc(context)
    registerBackupsIpc(context)

    const cancelInstall = () => {
      installing = false
      allowClose = false
      freezing = false
      window?.webContents.send(channels.flushRequest, randomUUID(), false)
    }
    const updates = releaseUpdates(async () => {
      if (installing || restoring || freezing)
        throw new Error('Wait for the current installation or restore to finish.')
      installing = true
      freezing = true
      try {
        await requireSaved()
        await recovery!.createBackup('before-update')
        allowClose = true
      } catch (cause) {
        cancelInstall()
        throw cause
      } finally {
        freezing = false
      }
    }, cancelInstall)
    registerUpdatesIpc(register, updates)

    app.setAboutPanelOptions({
      applicationName: 'Ritua',
      applicationVersion: app.getVersion(),
      copyright: 'Ritua — Your work, at your pace.',
    })
    nativeMenu()
    if (!smoke) {
      await recovery.createBackup('auto').catch(reportError)
      backupTimer = setInterval(
        () => {
          void recovery!.createBackup('auto').catch(reportError)
        },
        30 * 60 * 1000,
      )
    }
    await createWindow()
    app.on('activate', () => {
      if (!window) void createWindow().catch(failStartup)
    })
  })
  .catch(failStartup)
async function failStartup(error: unknown) {
  console.error(error)
  if (smoke) {
    app.exit(1)
    return
  }
  const choice = await dialog.showMessageBox({
    type: 'error',
    message: 'Ritua could not open the workspace',
    detail: 'Your existing files have been kept. You can restore a separate backup.',
    buttons: ['Quit', 'Restore a backup…'],
    defaultId: 0,
    cancelId: 0,
  })
  if (choice.response === 1) {
    try {
      const selected = await dialog.showOpenDialog({
        title: 'Restore Ritua backup',
        defaultPath: join(dataDirectory, 'backups'),
        properties: ['openFile'],
        filters: [{ name: 'Ritua backup', extensions: ['sqlite'] }],
      })
      if (!selected.canceled && selected.filePaths[0]) {
        const recovered = readBackup(selected.filePaths[0])
        database?.close()
        database = undefined
        const destination = join(dataDirectory, 'ritua-desktop.sqlite')
        const temporary = join(dataDirectory, `restore-${randomUUID()}.sqlite`)
        const restored = openDatabase(temporary)
        try {
          restored.replaceWorkspace(recovered.document, recovered.attachments)
        } finally {
          restored.close()
        }
        for (const suffix of ['', '-wal', '-shm'])
          if (existsSync(destination + suffix))
            await rename(destination + suffix, `${destination}.preserved-${Date.now()}${suffix}`)
        const journal = join(dataDirectory, 'pending-edits.json')
        if (existsSync(journal)) await rename(journal, `${journal}.preserved-${Date.now()}`)
        await rename(temporary, destination)
        app.relaunch()
      }
    } catch (cause) {
      await reportError(cause)
    }
  }
  app.exit(1)
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !restoring) app.quit()
})
app.on('before-quit', (event) => {
  if (restoring) {
    event.preventDefault()
    quitAfterClose = true
    return
  }
  if (window && !allowClose) {
    event.preventDefault()
    quitAfterClose = true
    window.close()
  }
})
app.on('will-quit', () => {
  clearInterval(backupTimer)
  database?.close()
})

import { contextBridge, ipcRenderer } from 'electron'
import { channels, type DesktopApi } from '../shared/desktop-api'
const api: DesktopApi = {
  getUpdateStatus: () => ipcRenderer.invoke(channels.updateStatus),
  checkForUpdates: () => ipcRenderer.invoke(channels.checkUpdates),
  downloadUpdate: () => ipcRenderer.invoke(channels.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(channels.installUpdate),
  installToApplications: () => ipcRenderer.invoke(channels.installApp),
  getStatus: () => ipcRenderer.invoke(channels.getStatus),
  loadWorkspace: () => ipcRenderer.invoke(channels.loadWorkspace),
  commitWorkspace: command => ipcRenderer.invoke(channels.commitWorkspace, command),
  saveWorkspace: command => ipcRenderer.invoke(channels.saveWorkspace, command),
  writeRecovery: draft => ipcRenderer.invoke(channels.writeRecovery, draft),
  readRecovery: () => ipcRenderer.invoke(channels.readRecovery),
  discardAttachment: id => ipcRenderer.invoke(channels.discardAttachment, id),
  attachmentStorage: () => ipcRenderer.invoke(channels.attachmentStorage),
  importTaskImage: file => ipcRenderer.invoke(channels.importTaskImage, file),
  copyTaskImage: id => ipcRenderer.invoke(channels.copyTaskImage, id),
  readTaskImage: id => ipcRenderer.invoke(channels.readTaskImage, id),
  chooseAttachment: () => ipcRenderer.invoke(channels.chooseAttachment),
  exportAttachment: id => ipcRenderer.invoke(channels.exportAttachment, id),
  createBackup: () => ipcRenderer.invoke(channels.createBackup),
  listBackups: () => ipcRenderer.invoke(channels.listBackups),
  exportBackup: () => ipcRenderer.invoke(channels.exportBackup),
  restoreBackup: id => ipcRenderer.invoke(channels.restoreBackup, id),
  onFlushRequested: callback => {
    const listener=(_event:Electron.IpcRendererEvent,id:string,freeze:boolean)=>callback(id,freeze)
    ipcRenderer.on(channels.flushRequest,listener)
    return ()=>ipcRenderer.removeListener(channels.flushRequest,listener)
  },
  confirmWorkspaceFlushed:(id,success)=>ipcRenderer.invoke(channels.flushReady,id,success),
}
contextBridge.exposeInMainWorld('ritua', api)

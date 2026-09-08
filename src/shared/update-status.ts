export interface UpdateStatus {
  phase: 'unconfigured' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  version?: string
  progress?: number
  message: string
  canInstallToApplications: boolean
}

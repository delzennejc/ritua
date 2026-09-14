import type { ReactNode } from 'react'
import { ActionErrors } from './ActionErrors'
import { Fragment, useEffect } from 'react'
import { useStore } from 'zustand'
import {
  flushBeforeClose,
  flushWorkspace,
  initializeWorkspace,
  refreshWorkspaceDay,
  resolveWorkspaceConflict,
  workspaceStore,
} from './workspace-store'

export function DesktopWorkspace({ children }: { children: ReactNode }) {
  const { ready, error, errorKind, dayVersion, recoveryWarning } = useStore(workspaceStore)
  useEffect(() => {
    void initializeWorkspace().catch(() => {})
    return window.ritua?.onFlushRequested(async (id, freeze) => {
      try {
        if (!freeze) {
          workspaceStore.setState({ frozen: false })
          document.body.inert = false
        }
        await flushBeforeClose()
        if (freeze) {
          workspaceStore.setState({ frozen: true })
          document.body.inert = true
        }
        await window.ritua!.confirmWorkspaceFlushed(id, true)
      } catch {
        await window.ritua!.confirmWorkspaceFlushed(id, false)
      }
    })
  }, [initializeWorkspace])
  useEffect(() => {
    const refresh = () => {
      void refreshWorkspaceDay().catch(() => {})
    }
    const timer = setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return (
    <>
      <ActionErrors />
      {ready ? (
        <Fragment key={dayVersion}>{children}</Fragment>
      ) : (
        <div role="status">{error ? 'Could not open your workspace.' : 'Opening your workspace…'}</div>
      )}
      {recoveryWarning && !error && (
        <div role="alert" className="undo-snackbar">
          <span>{recoveryWarning}</span>
          <button type="button" onClick={() => void flushWorkspace().catch(() => {})}>
            Retry recovery copy
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="undo-snackbar">
          <span>
            {ready
              ? 'Changes could not be saved. Your edits are still open.'
              : 'Your saved workspace could not be opened.'}{' '}
            {error}
          </span>
          {errorKind === 'conflict' ? (
            <>
              <button type="button" onClick={() => void resolveWorkspaceConflict('local').catch(() => {})}>
                Keep my conflicting edits
              </button>
              <button type="button" onClick={() => void resolveWorkspaceConflict('remote').catch(() => {})}>
                Use saved conflicting edits
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void (ready ? flushWorkspace() : initializeWorkspace()).catch(() => {})}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </>
  )
}

import { createContext, useContext } from 'react'

export const WorkspaceTaskActionsContext = createContext(null)
/** Shared task interactions are connected once in App; each surface declares what it uses. */
export function useWorkspaceTaskActions() {
  const actions = useContext(WorkspaceTaskActionsContext)
  if (!actions) throw new Error('Workspace task actions are unavailable')
  return actions
}

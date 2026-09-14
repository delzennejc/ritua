import { profileName } from '../../../domain/local-profile'
import { getWorkspaceFields } from './workspace-store'

export function profileActor(): string {
  const profile = getWorkspaceFields().profile as { displayName?: string } | undefined
  return profileName(profile)
}

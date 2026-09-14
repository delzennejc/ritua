import { useStore } from 'zustand'
import { workspaceStore, selectWorkspaceFields } from './workspace-store'
import { defaultProfile, type LocalProfile } from '../../../domain/local-profile'
export function useProfile(): LocalProfile {
  return useStore(
    workspaceStore,
    (state) => (selectWorkspaceFields(state.document).profile as unknown as LocalProfile) || defaultProfile,
  )
}
export function ProfileAvatar({ decorative = false }: { decorative?: boolean }) {
  const profile = useProfile()
  const initials = profile.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .replace(/[<>&"']/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#8d6ae8"/><text x="32" y="41" text-anchor="middle" font-family="sans-serif" font-size="26" fill="white">${initials}</text></svg>`
  return (
    <img
      src={profile.avatar || `data:image/svg+xml,${encodeURIComponent(svg)}`}
      alt={decorative ? '' : profile.displayName}
    />
  )
}

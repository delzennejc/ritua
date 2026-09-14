export interface LocalProfile {
  displayName: string
  avatar: string
}
export const defaultProfile: LocalProfile = { displayName: 'You', avatar: '' }
export const profileName = (profile?: Pick<Partial<LocalProfile>, 'displayName'>): string =>
  profile?.displayName?.trim() || defaultProfile.displayName

export interface LocalProfile { displayName: string; avatar: string }
export const defaultProfile: LocalProfile = { displayName: 'You', avatar: '' }
let actor = defaultProfile.displayName
export const profileActor = () => actor
export function setProfileActor(name: string) { actor = name.trim() || 'You' }

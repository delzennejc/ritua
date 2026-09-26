import type { ActivityContext } from '../../../domain/task-activity'
import { profileActor } from './profile-actor'

/** Actor and clock for domain commands that record task history. */
export function activityContext(): ActivityContext {
  return { now: new Date(), actor: profileActor() }
}

import type { RecurrenceDefinition, SessionRecurrenceDefinition } from './models'
import type { ArchivedArea } from './models'
import type { TaskCollections, WorkspacePreferences } from './models'
import type { Fields } from './workspace-types'

export type WorkspaceFields = Fields &
  TaskCollections &
  WorkspacePreferences & {
    recurrenceDefinitions: Record<string, RecurrenceDefinition>
    recurrenceStops: Record<string, boolean>
    recurrenceProgress: Record<string, string>
    sessionRecurrenceDefinitions: Record<string, SessionRecurrenceDefinition>
    sessionRecurrenceStops: Record<string, boolean>
    sessionRecurrenceProgress: Record<string, string>
    archivedAreas: ArchivedArea[]
    weeklyObjectiveOrder: string[]
  }

/** Typed access for operations on a validated projection; defaults match empty installations. */
export function workspaceCollections(fields: Fields): WorkspaceFields {
  return {
    ...fields,
    recurrenceDefinitions: fields.recurrenceDefinitions ?? {},
    recurrenceStops: fields.recurrenceStops ?? {},
    recurrenceProgress: fields.recurrenceProgress ?? {},
    sessionRecurrenceDefinitions: fields.sessionRecurrenceDefinitions ?? {},
    sessionRecurrenceStops: fields.sessionRecurrenceStops ?? {},
    sessionRecurrenceProgress: fields.sessionRecurrenceProgress ?? {},
  } as WorkspaceFields
}

import type { Fields } from './workspace'

export const DEFAULT_AREAS = [
  { id: 'work', label: 'Work', color: '#8d6ae8' },
  { id: 'personal', label: 'Personal', color: '#69b984' },
]
export const DEFAULT_AREA_LOOKUP = Object.fromEntries(DEFAULT_AREAS.map((area) => [area.label, area]))
export const DEFAULT_BACKLOG_GROUPS = [
  { id: 'anytime', label: 'Anytime', marker: 'A', tone: 'green', items: [] },
  { id: 'someday', label: 'Someday', marker: 'S', tone: 'blue', items: [] },
]
export const DEFAULT_TASKS = []
export const DEFAULT_DATED_TASKS = {}
export const DEFAULT_PROJECTS = []
export const DEFAULT_EVENTS = []
export function workspaceDefaults(): Fields {
  return structuredClone({
    areas: DEFAULT_AREAS,
    tasks: DEFAULT_TASKS,
    datedTasksByDate: DEFAULT_DATED_TASKS,
    weeklyObjectives: DEFAULT_PROJECTS,
    archivedObjectives: [],
    archivedAreas: [],
    weeklyObjectiveOrder: [],
    recurrenceDefinitions: {},
    recurrenceProgress: {},
    recurrenceStops: {},
    events: DEFAULT_EVENTS,
    'weekly.accomplishedObjectives': [],
    backlogGroups: DEFAULT_BACKLOG_GROUPS,
  })
}

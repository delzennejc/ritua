/** Business shapes. Persistence JSON is decoded at the workspace boundary. */
export type Recurrence = {
  preset: 'none' | 'daily' | 'weekly' | 'monthly' | 'annually' | 'weekdays' | 'custom'
  frequency: 'none' | 'day' | 'week' | 'month' | 'year'
  interval: number
  weekDays: number[]
  monthMode: 'day' | 'weekday'
  end: { type: 'never' | 'on' | 'after'; date: string; count: number }
}
export type IncompletePosition = { index: number; previousTaskId: string | null; nextTaskId: string | null }
export type Subtask = {
  id: string
  title: string
  complete: boolean
  minutes?: number | null
  actualMinutes?: number | null
  completedAtMinute?: number | null
}
export type Attachment = { id: string; name: string; size: number }
export type Activity = { id: string; label: string; kind?: string; time?: string; timestamp?: number }
export type Comment = {
  id: string
  text: string
  attachment?: Attachment | null
  author?: string
  authorName?: string
  time?: string
}
export type Task = {
  id: string
  title: string
  complete?: boolean
  taskId?: string
  minutes?: number | null
  actualMinutes?: number | null
  time?: string | null
  channel?: string
  accent?: string
  objectiveId?: string | null
  subtasks?: Subtask[]
  notes?: string
  media?: { attachment: Attachment }[]
  comments?: Comment[]
  activity?: Activity[]
  createdAt?: string
  completedAtMinute?: number | null
  completedDateKey?: string | null
  incompletePosition?: IncompletePosition
  recurrence?: Recurrence
  recurrenceSeriesId?: string
  recurrenceIndex?: number
  recurrenceStartDateKey?: string
  recurrenceEdited?: boolean
  durationLabel?: string
  /** Today workflow is stored only for active board states; absence means Todo. */
  todayStatus?: 'todo' | 'in-progress' | 'to-review'
}
export type ProjectTask = Task & { taskId?: string }
export type Project = {
  id: string
  title: string
  channel?: string
  tasks?: ProjectTask[]
  taskOrder?: string[]
  complete?: boolean
  focusedThisWeek?: boolean
  notes?: string
  comments?: Comment[]
}
export type Area = { id: string; label: string; color: string; accent?: string }
export type BacklogGroup = { id: string; label: string; items: Task[]; marker?: string; tone?: string }
export type ScheduledTaskEvent = {
  id: string
  taskId?: string
  kind?: 'task'
  title?: string
  start: number
  end: number
  dateKey?: string
  complete?: boolean
  color?: string
}
export type CalendarSession = {
  id: string
  kind: 'session'
  title: string
  start: number
  end: number
  dateKey: string
  taskIds: string[]
}
export type ShutdownEvent = {
  id: string
  kind: 'shutdown'
  title?: string
  start: number
  end: number
  dateKey?: string
}
export type CalendarEvent = ScheduledTaskEvent | CalendarSession | ShutdownEvent
export type TaskLocation = 'today' | `date:${string}` | `backlog:${string}` | `project:${string}`
export type TaskCollections = {
  tasks: Task[]
  datedTasksByDate: Record<string, Task[]>
  backlogGroups: BacklogGroup[]
  weeklyObjectives: Project[]
  archivedObjectives: Project[]
  'weekly.accomplishedObjectives': Project[]
  events: CalendarEvent[]
  areas: Area[]
}
export type RecurrenceDefinition = { task: Task; event: ScheduledTaskEvent | null }
export type ArchivedArea = { area: Area; position: number; archivedAt: string }
export type WorkspacePreferences = {
  view?: string
  planningStep?: number
  weeklyStep?: number
  taskScope?: string
  navigationOpen?: boolean
  rightPanelOpenByPage?: Record<string, boolean>
  rightPanes?: Record<string, string>
}

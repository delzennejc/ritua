import type { Activity, Task } from './models'

/** Actor and clock shared by every command that records task history. */
export type ActivityContext = { now: Date; actor: string }

const taskCreatedActivity = (task: Task, context: ActivityContext): Activity => ({
  id: `${task.id}-created`,
  kind: 'task-created',
  label: `${context.actor} created this`,
  time: task.createdAt ? new Date(task.createdAt).toLocaleDateString() : 'Earlier',
})

/** The created entry appears once, however a task first gains history. */
export function activityWithCreation(task: Task, context: ActivityContext): Activity[] {
  const activity = task.activity ?? []
  return activity.some((entry) => entry.kind === 'task-created')
    ? activity
    : [taskCreatedActivity(task, context), ...activity]
}

export function taskActivity(context: ActivityContext, suffix: string, label: string): Activity {
  return {
    id: `activity-${context.now.getTime()}-${suffix}`,
    label: `${context.actor} ${label}`,
    time: 'now',
  }
}

/** Appends one history entry to a task inside an edit draft. */
export function pushTaskActivity(task: Task, context: ActivityContext, suffix: string, label: string): void {
  task.activity = [...activityWithCreation(task, context), taskActivity(context, suffix, label)]
}

/** Immutable variant for callers assembling a replacement task. */
export function appendTaskActivity(task: Task, entry: Activity, context: ActivityContext): Task {
  return { ...task, activity: [...activityWithCreation(task, context), entry] }
}

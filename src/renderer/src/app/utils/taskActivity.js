import { profileActor } from '../../desktop/profile-actor'

const taskCreatedActivity = (task) => ({
  id: `${task.id}-created`,
  kind: 'task-created',
  label: `${profileActor()} created this`,
  time: task.createdAt ? new Date(task.createdAt).toLocaleDateString() : 'Earlier',
})

const isTaskCreatedActivity = (activity) => activity?.kind === 'task-created'

export const isNoteEditedActivity = (activity) => activity?.kind === 'note-edited'

export const taskActivityWithCreation = (task) => {
  const activity = task.activity || []
  return activity.some(isTaskCreatedActivity) ? activity : [taskCreatedActivity(task), ...activity]
}

export const appendTaskActivity = (task, activity) => [...taskActivityWithCreation(task), activity]

export const noteEditedActivity = () => ({
  id: `activity-${Date.now()}-note`,
  kind: 'note-edited',
  label: `${profileActor()} edited the note`,
  time: 'now',
})

import type { Data, Json } from './workspace-types'
import { WorkspaceValidationError } from './workspace-errors'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkspaceValidationError(message)
}
function record(value: Json | undefined, label: string): Data {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`)
  return value
}
function optionalString(value: Json | undefined, label: string) {
  if (value !== undefined && value !== null) check(typeof value === 'string', `Invalid ${label}`)
}
/** Optional task data is checked before selectors expose concrete business types. */
export function validateTaskDetails(task: Data) {
  for (const key of [
    'time',
    'channel',
    'accent',
    'objectiveId',
    'notes',
    'createdAt',
    'durationLabel',
    'recurrenceSeriesId',
    'recurrenceStartDateKey',
  ])
    optionalString(task[key], key)
  if (task.recurrenceIndex !== undefined)
    check(
      Number.isSafeInteger(task.recurrenceIndex) && Number(task.recurrenceIndex) >= 0,
      'Invalid recurrence index',
    )
  if (task.recurrenceEdited !== undefined)
    check(typeof task.recurrenceEdited === 'boolean', 'Invalid recurrence edit state')
  if (Array.isArray(task.subtasks)) {
    const ids = task.subtasks.map((item) => record(item, 'subtask').id)
    check(new Set(ids).size === ids.length, 'Duplicate subtask')
  }
  for (const key of ['comments', 'activity']) {
    if (task[key] === undefined) continue
    check(Array.isArray(task[key]), `Invalid ${key}`)
    for (const value of task[key]) {
      const item = record(value, key)
      check(typeof item.id === 'string' && item.id.length > 0, `Invalid ${key} identity`)
      const text = key === 'comments' ? item.text : item.label
      check(typeof text === 'string', `Invalid ${key} text`)
      for (const field of ['time', 'kind', 'authorName', 'author']) optionalString(item[field], field)
      if (item.timestamp !== undefined)
        check(
          typeof item.timestamp === 'number' && Number.isFinite(item.timestamp),
          'Invalid activity timestamp',
        )
    }
  }
  if (task.recurrence !== undefined) {
    const rule = record(task.recurrence, 'recurrence')
    check(
      ['none', 'daily', 'weekly', 'monthly', 'annually', 'weekdays', 'custom'].includes(String(rule.preset)),
      'Invalid recurrence preset',
    )
    check(
      ['none', 'day', 'week', 'month', 'year'].includes(String(rule.frequency)),
      'Invalid recurrence frequency',
    )
    check(Number.isSafeInteger(rule.interval) && Number(rule.interval) >= 1, 'Invalid recurrence interval')
    check(
      Array.isArray(rule.weekDays) &&
        rule.weekDays.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6),
      'Invalid recurrence weekdays',
    )
    check(['day', 'weekday'].includes(String(rule.monthMode)), 'Invalid recurrence month mode')
    const end = record(rule.end, 'recurrence end')
    check(['never', 'on', 'after'].includes(String(end.type)), 'Invalid recurrence end')
    check(
      typeof end.date === 'string' && Number.isSafeInteger(end.count) && Number(end.count) >= 1,
      'Invalid recurrence end values',
    )
  }
}

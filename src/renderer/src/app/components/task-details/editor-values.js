import { timeLabel, minutesLabel } from '../../utils/time'
import { nextAvailableCalendarStart } from '../../utils/calendar'
import { dateFromKey } from '../../utils/dates'
import { calendarClockLabel } from '../../../../../domain/calendar-time'

export const EMPTY_CALENDAR_EVENTS = []

export const minuteValue = (value) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return Number.NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export const scheduleTimeLabel = calendarClockLabel

export const durationDraftFrom = (minutes) =>
  Number.isFinite(minutes) && minutes > 0 ? minutesLabel(minutes) : ''

export const durationMinutesFrom = (value) => {
  const normalized = value.trim()
  if (!normalized || normalized === '--:--') return null
  if (/^\d+$/.test(normalized)) return Number(normalized)

  const match = /^(\d+):([0-5]\d)$/.exec(normalized)
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2])
}

export const scheduleDraftFrom = (task, event, taskDateKey, calendarEvents) => {
  const dateKey = event?.dateKey || taskDateKey
  const duration = task.minutes > 0 ? task.minutes : 30
  const start =
    event?.start ??
    (task.time ? minuteValue(task.time) : nextAvailableCalendarStart(calendarEvents, duration, dateKey))
  const end = event?.end ?? (start === null ? null : start + Math.min(24 * 60, duration))

  return {
    dateKey,
    start: start === null ? '' : timeLabel(start),
    end: end === null ? '' : scheduleTimeLabel(end),
    error:
      start === null
        ? `No ${minutesLabel(duration)} opening is available on this day. Choose another date or enter a time.`
        : '',
  }
}

export const formatDate = (dateKey, options) => dateFromKey(dateKey).toLocaleDateString('en-US', options)

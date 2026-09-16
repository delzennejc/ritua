import { addDays } from './calendar-dates'
import type { CalendarEvent } from './models'
import { timeLabel } from './time-format'

export const DAY_MINUTES = 1440

/** End minutes are relative to the start date, including the following morning. */
export function validTaskSchedule(start: number, end: number): boolean {
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    start < DAY_MINUTES &&
    end > start &&
    end - start <= DAY_MINUTES
  )
}

export const taskScheduleEnd = (start: number, end: number) => (end <= start ? end + DAY_MINUTES : end)

export const calendarClockLabel = (minutes: number) => timeLabel(minutes % DAY_MINUTES)
export const calendarEndLabel = (minutes: number) =>
  `${calendarClockLabel(minutes)}${minutes >= DAY_MINUTES ? ' (+1 day)' : ''}`

/** Clip for layout only. The original block remains the sole editable, durable event. */
export function calendarEventOnDate<T extends Pick<CalendarEvent, 'start' | 'end' | 'dateKey'>>(
  event: T,
  dateKey: string,
  defaultDateKey: string,
) {
  const sourceDate = event.dateKey || defaultDateKey
  const dayOffset = dateKey === sourceDate ? 0 : dateKey === addDays(sourceDate, 1) ? 1 : -1
  if (dayOffset < 0) return null
  const start = Math.max(0, event.start - dayOffset * DAY_MINUTES)
  const end = Math.min(DAY_MINUTES, event.end - dayOffset * DAY_MINUTES)
  return end > start ? { ...event, start, end, sourceEvent: event, dayOffset } : null
}

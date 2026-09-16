import { addDays, dateFromKey, localDateKey, mondayOf } from './calendar-dates'
import type { Task } from './models'
import { taskWorkedMinutes } from './task-time'

export type AreaTimePeriod = 'week' | 'month' | 'quarter' | 'semester' | 'year'
type TaskEntry = { task: Task; dateKey: string | null }

export function areaTimeRange(period: AreaTimePeriod, today: string) {
  const date = dateFromKey(today)
  const year = date.getFullYear()
  const month = date.getMonth()
  if (period === 'week') {
    const start = mondayOf(today)
    return { start, end: addDays(start, 7) }
  }
  const months = { month: 1, quarter: 3, semester: 6, year: 12 }[period]
  const firstMonth = Math.floor(month / months) * months
  return {
    start: localDateKey(new Date(year, firstMonth, 1)),
    end: localDateKey(new Date(year, firstMonth + months, 1)),
  }
}

/** Completed work is counted once, within the selected calendar period. */
export function areaTimeSummary(entries: readonly TaskEntry[], period: AreaTimePeriod, today: string) {
  const { start, end } = areaTimeRange(period, today)
  const daily = period === 'week' || period === 'month'
  const totals = new Map<string, number>()
  const seen = new Set<string>()
  for (const { task, dateKey } of entries) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    const completedDate = task.completedDateKey || dateKey
    if (!task.complete || !completedDate || completedDate < start || completedDate >= end) continue
    const key = daily ? completedDate : completedDate.slice(0, 7)
    totals.set(key, (totals.get(key) ?? 0) + taskWorkedMinutes(task))
  }
  const buckets = []
  for (let key = start; key < end; ) {
    const date = dateFromKey(key)
    buckets.push({
      key,
      label: date.toLocaleDateString(
        'en-US',
        period === 'week'
          ? { weekday: 'short' }
          : daily
            ? { month: 'short', day: 'numeric' }
            : { month: 'short' },
      ),
      description: date.toLocaleDateString(
        'en-US',
        daily
          ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
          : { month: 'long', year: 'numeric' },
      ),
      minutes: totals.get(daily ? key : key.slice(0, 7)) ?? 0,
    })
    key = daily ? addDays(key, 1) : localDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 1))
  }
  return {
    start,
    end: addDays(end, -1),
    buckets,
    total: buckets.reduce((sum, bucket) => sum + bucket.minutes, 0),
  }
}

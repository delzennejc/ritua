import { localDateKey, mondayOf } from './calendar-dates'
import type { Fields } from './workspace'

// Completion belongs to the local day/week; reopening keeps an unfinished draft's step.
export function openPendingPlanning(fields: Fields, today = localDateKey()): Fields {
  if (today === mondayOf(today) && fields['weekly.completedWeek'] !== today) {
    return { ...fields, view: 'weekly-planning' }
  }
  if (fields['daily.completedDate'] !== today) return { ...fields, view: 'planning' }
  return fields
}

export function completeWeeklyPlanning(fields: Fields, today = localDateKey()): Fields {
  const completed = { ...fields, 'weekly.completedWeek': mondayOf(today), view: 'home' }
  return today === mondayOf(today) ? openPendingPlanning(completed, today) : completed
}

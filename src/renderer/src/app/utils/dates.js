import {
  localDateKey,
  addDays,
  mondayOf,
  calendarDaysAround,
  previousWeekDays,
} from '../../../../domain/calendar-dates'
export { addDays, mondayOf, calendarDaysAround, previousWeekDays }
export let CURRENT_DATE_KEY = localDateKey()
export const refreshDateClock = () => {
  CURRENT_DATE_KEY = localDateKey()
}

const toDateKey = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const dateFromKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const backlogDateLabel = (dateKey, currentDateKey = CURRENT_DATE_KEY) => {
  const date = dateFromKey(dateKey)
  const currentDate = dateFromKey(currentDateKey)
  const nextDate = new Date(currentDate)
  nextDate.setDate(nextDate.getDate() + 1)
  const shortDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== currentDate.getFullYear() ? { year: 'numeric' } : {}),
  })

  if (dateKey === currentDateKey) return `Today, ${shortDate}`
  if (date.getTime() === nextDate.getTime()) return `Tomorrow, ${shortDate}`
  return shortDate
}

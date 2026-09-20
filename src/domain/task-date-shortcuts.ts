import { addDays, dateFromKey, localDateKey, mondayOf } from './calendar-dates'

export type TaskDateShortcut = { id: string; label: string; dateKey: string }

export function taskDateShortcuts(today: string): TaskDateShortcut[] {
  const tomorrow = addDays(today, 1)
  const choices: TaskDateShortcut[] = [{ id: 'tomorrow', label: 'Tomorrow', dateKey: tomorrow }]
  const monday = mondayOf(today)
  for (let offset = 0; offset < 5; offset += 1) {
    const dateKey = addDays(monday, offset)
    if (dateKey <= tomorrow) continue
    choices.push({
      id: dateKey,
      label: dateFromKey(dateKey).toLocaleDateString('en-US', { weekday: 'long' }),
      dateKey,
    })
  }
  const nextMonth = dateFromKey(today)
  nextMonth.setDate(1)
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  while (nextMonth.getDay() === 0 || nextMonth.getDay() === 6) {
    nextMonth.setDate(nextMonth.getDate() + 1)
  }
  choices.push(
    { id: 'next-week', label: 'Next Week', dateKey: addDays(monday, 7) },
    { id: 'next-month', label: 'Next Month', dateKey: localDateKey(nextMonth) },
  )
  return choices
}

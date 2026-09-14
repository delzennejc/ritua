import { dateFromKey } from './dates'

const dateKeyFromDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const weekDaysFrom = (dateKey) => {
  const anchor = dateFromKey(dateKey)
  const mondayOffset = (anchor.getDay() + 6) % 7
  const monday = new Date(anchor)
  monday.setDate(anchor.getDate() - mondayOffset)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return {
      dateKey: dateKeyFromDate(date),
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
    }
  })
}

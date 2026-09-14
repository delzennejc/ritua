export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function addDays(key: string, count: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return localDateKey(new Date(year, month - 1, day + count))
}
export function mondayOf(key: string): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return addDays(key, -((new Date(year, month - 1, day).getDay() + 6) % 7))
}
export function calendarDay(key: string) {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  const date = new Date(year, month - 1, day)
  return {
    id: key,
    dateKey: key,
    day: date.toLocaleDateString('en-US', { weekday: 'long' }),
    date: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
  }
}
export function calendarDaysAround(key: string) {
  const [year, month] = key.split('-').map(Number) as [number, number]
  const start = new Date(year, month - 2, 1)
  const end = new Date(year, month + 1, 1)
  const days = []
  for (const date = new Date(start); date < end; date.setDate(date.getDate() + 1))
    days.push(calendarDay(localDateKey(date)))
  return days
}
export const previousWeekDays = (key: string) =>
  Array.from({ length: 7 }, (_, i) => calendarDay(addDays(mondayOf(key), i - 7)))

export function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

import type { Area, CalendarSession, Task } from './models'

/** Count canonical session members, including completed tasks. Area order breaks ties. */
export function majoritySessionArea(
  session: Pick<CalendarSession, 'taskIds'>,
  tasks: ReadonlyMap<string, Pick<Task, 'channel'>>,
  areas: readonly Area[],
): Area | undefined {
  const counts = new Map<string, number>()
  for (const id of session.taskIds) {
    const channel = tasks.get(id)?.channel
    if (channel) counts.set(channel, (counts.get(channel) ?? 0) + 1)
  }
  let majority: Area | undefined
  let highestCount = 0
  for (const area of areas) {
    const count = counts.get(area.label) ?? 0
    if (count > highestCount) {
      majority = area
      highestCount = count
    }
  }
  return majority
}

import { reorderedItems } from './backlog-organization'

/** Order references only; task content and scheduling remain canonical. */
export function orderedProjectTasks<T extends { id: string }>(tasks: T[], order: string[] = []): T[] {
  const positions = new Map(order.map((id, index) => [id, index]))
  return [...tasks].sort(
    (a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length),
  )
}

export function reorderProjectTaskOrder(
  tasks: { id: string }[],
  visibleIds: string[],
  move: { itemId: string; targetIndex: number },
): string[] {
  const visible = new Set(visibleIds)
  const reordered = reorderedItems(
    tasks.filter((task) => visible.has(task.id)),
    move,
  )
  let index = 0
  return tasks.map((task) => (visible.has(task.id) ? reordered[index++]!.id : task.id))
}

export function isPreviousWeekCompletedTask(
  task: { complete?: boolean; completedDateKey?: string | null; dateKey?: string | null },
  weekStart: string,
): boolean {
  // Backdated work belongs to its assigned week even when checked off today.
  const workDate = task.dateKey || task.completedDateKey
  return Boolean(task.complete && workDate && workDate < weekStart)
}

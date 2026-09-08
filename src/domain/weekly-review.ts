import type { Data } from './workspace'
export function syncAccomplishedObjectiveTasks(objectives: Data[], days: { tasks: Data[] }[]): Data[] {
  const byId = new Map(days.flatMap(day => day.tasks).filter(task => task.complete).map(task => [String(task.taskId ?? task.id), task]))
  return objectives.map(objective => ({ ...objective, tasks: ((objective.tasks ?? []) as Data[]).map(task => {
    const canonical = byId.get(String(task.taskId ?? task.id))
    return canonical ? { ...task, title: canonical.title, minutes: canonical.minutes, complete: canonical.complete } : task
  }) }))
}

import type { Data, Fields } from './workspace'
const clone = <T>(value: T): T => structuredClone(value)
const inactive = ['archivedObjectives', 'weekly.accomplishedObjectives'] as const
export interface RemovedReference { field: string; projectId: string; index: number; member: Data }
export function detachInactiveReferences(fields: Fields, ids: string[]) {
  const next = clone(fields), removed: RemovedReference[] = [], selected = new Set(ids)
  for (const field of inactive) for (const project of (next[field] ?? []) as Data[]) {
    project.tasks = ((project.tasks ?? []) as Data[]).filter((member, index) => {
      if (!selected.has(String(member.taskId ?? member.id))) return true
      removed.push({ field, projectId: String(project.id), index, member }); return false
    })
  }
  return { fields: next, removed }
}
export function restoreInactiveReferences(fields: Fields, removed: RemovedReference[]): Fields {
  const next = clone(fields)
  for (const entry of removed) {
    const project = ((next[entry.field] ?? []) as Data[]).find(item => item.id === entry.projectId)
    if (!project) continue
    const members = (project.tasks ??= []) as Data[]
    if (!members.some(item => (item.taskId ?? item.id) === (entry.member.taskId ?? entry.member.id))) members.splice(Math.min(entry.index, members.length), 0, clone(entry.member))
  }
  return next
}
export function restoreArea(fields: Fields, id: string): Fields {
  const next = clone(fields), archived = (next.archivedAreas ?? []) as Data[]
  const entry = archived.find(item => (item.area as Data).id === id)
  if (!entry) return next
  const area = entry.area as Data, areas = next.areas as Data[]
  if (areas.some(item => item.id === id || String(item.label).localeCompare(String(area.label), undefined, { sensitivity: 'accent' }) === 0)) throw new Error('An active Area already uses this name. Rename it before restoring this Area.')
  areas.splice(Math.min(Number(entry.position), areas.length), 0, area)
  next.archivedAreas = archived.filter(item => item !== entry)
  return next
}
export function restoreProject(fields: Fields, id: string): Fields {
  let next = clone(fields)
  const archived = (next.archivedObjectives ?? []) as Data[]
  const project = archived.find(item => item.id === id)
  if (!project) return next
  const label = String(project.channel ?? '').replace(/^#/, '')
  const hiddenArea = ((next.archivedAreas ?? []) as Data[]).find(item => (item.area as Data).label === label)
  if (hiddenArea) next = restoreArea(next, String((hiddenArea.area as Data).id))
  const active = next.weeklyObjectives as Data[]
  if (active.some(item => item.id === id)) throw new Error('This Project is already active.')
  const tasks = [...next.tasks as Data[], ...Object.values(next.datedTasksByDate as Record<string, Data[]>).flat(), ...((next.backlogGroups ?? []) as Data[]).flatMap(group => group.items as Data[])]
  const restored = clone(project)
  restored.tasks = ((restored.tasks ?? []) as Data[]).filter(member => {
    const task = tasks.find(item => item.id === (member.taskId ?? member.id))
    if (task?.objectiveId && task.objectiveId !== id) return false
    if (task) task.objectiveId = id
    return true
  })
  const position = Number(project.archivePosition ?? active.length)
  for (const seriesId of (project.archivedSeriesIds ?? []) as string[]) {
    const definition = ((next.recurrenceDefinitions ?? {}) as Data)[seriesId] as Data | undefined
    if (definition && !(definition.task as Data).objectiveId) (definition.task as Data).objectiveId = id
  }
  const weekIndex = Number(project.archiveWeeklyOrderIndex ?? -1)
  const order = (next.weeklyObjectiveOrder ??= []) as string[]
  if (weekIndex >= 0 && !order.includes(id)) order.splice(Math.min(weekIndex, order.length), 0, id)
  delete restored.archivedSeriesIds; delete restored.archiveWeeklyOrderIndex
  delete restored.archivePosition; delete restored.archivedAt
  active.splice(Math.min(position, active.length), 0, restored)
  next.archivedObjectives = archived.filter(item => item.id !== id)
  return next
}

import { editDocument, copyRecord, equalJson } from './workspace-immutable'
import { collectionCommand } from './workspace-collection-command'
import { taskFromJson } from './workspace-selectors'
import { noRecurrence } from './recurrence'
import type { WorkspaceDocument } from './workspace'
import { type Data } from './workspace'
import { addDays } from './calendar-dates'
import { recurrenceDateKeys } from './recurrence'

const content = (entity: WorkspaceDocument['entities'][number]) => entity.data.content as Data
export function rememberRecurrenceProgress(
  input: WorkspaceDocument,
  previous?: WorkspaceDocument,
): WorkspaceDocument {
  if (input.entities === previous?.entities) return input
  return editDocument(input, (document) => {
    const progress = (document.fields.recurrenceProgress ?? {}) as Data
    const definitions = (document.fields.recurrenceDefinitions ?? {}) as Data
    const old = new Map(previous?.entities.filter((e) => e.kind === 'task').map((e) => [e.id, content(e)]))
    const groups = new Map<string, Data[]>()
    for (const entity of document.entities.filter((e) => e.kind === 'task')) {
      const task = content(entity)
      if (!task.recurrenceSeriesId) continue
      const prior = old.get(entity.id)
      if (
        prior?.recurrenceSeriesId === task.recurrenceSeriesId &&
        [
          'title',
          'minutes',
          'time',
          'channel',
          'accent',
          'objectiveId',
          'subtasks',
          'notes',
          'media',
          'comments',
          'actualMinutes',
        ].some((key) => !equalJson(prior[key], task[key]))
      )
        task.recurrenceEdited = true
      const id = String(task.recurrenceSeriesId)
      const group = groups.get(id) ?? []
      group.push(task)
      groups.set(id, group)
    }
    for (const [id, group] of groups) {
      group.sort((a, b) => Number(a.recurrenceIndex) - Number(b.recurrenceIndex))
      const last = group.at(-1)!
      const rule = taskFromJson(last).recurrence ?? noRecurrence()
      // The logical occurrence index is stable when its scheduled date changes.
      const dates = recurrenceDateKeys(
        String(last.recurrenceStartDateKey),
        { ...rule, end: { ...rule.end, type: 'after', count: Number(last.recurrenceIndex) + 1 } },
        '9999-12-31',
      ) as string[]
      const through = dates[Number(last.recurrenceIndex)]
      if (through && through > String(progress[id] ?? '')) progress[id] = through
      if (!definitions[id]) {
        const seed = group.find((task) => !task.recurrenceEdited) ?? group[0]!
        const seedEvent = document.entities.find((e) => e.kind === 'event' && e.id === seed.id)
        definitions[id] = { task: freshOccurrence(seed), event: seedEvent ? content(seedEvent) : null }
      }
    }
    if (!Object.keys(progress).length && !Object.keys(definitions).length) return
    document.fields.recurrenceProgress = progress
    document.fields.recurrenceDefinitions = definitions
  })
}
export function freshOccurrence(template: Data): Data {
  const task = copyRecord(template)
  delete task.recurrenceEdited
  delete task.actualMinutes
  delete task.completedAtMinute
  delete task.completedDateKey
  delete task.incompletePosition
  task.complete = false
  task.notes = ''
  task.media = []
  task.comments = []
  task.activity = []
  if (Array.isArray(task.subtasks))
    task.subtasks = (task.subtasks as Data[]).map((item) => {
      const next: Data = { ...item, complete: false }
      delete next.actualMinutes
      delete next.completedAtMinute
      return next
    })
  return task
}
// Only append beyond the remembered generation boundary; removed individual occurrences stay removed.
export function extendRecurrences(input: WorkspaceDocument, today: string): WorkspaceDocument {
  const document = rememberRecurrenceProgress(input)
  return collectionCommand(document, (fields) => {
    const progress = (fields.recurrenceProgress ?? {}) as Data
    const stops = (fields.recurrenceStops ?? {}) as Data
    const definitions = (fields.recurrenceDefinitions ?? {}) as Data
    const series = new Map(
      Object.entries(definitions).map(([id, definition]) => [id, (definition as Data).task as Data]),
    )
    let changed = false
    for (const [id, template] of series) {
      const horizon = addDays(today, 365)
      const through = String(progress[id] ?? template.recurrenceStartDateKey)
      if (through >= horizon || stops[id]) continue
      const start = String(template.recurrenceStartDateKey)
      const dates = recurrenceDateKeys(
        start,
        taskFromJson(template).recurrence ?? noRecurrence(),
        horizon,
      ) as string[]
      const sourceEvent = (definitions[id] as Data)?.event as Data | null
      dates.forEach((dateKey, index) => {
        if (dateKey <= through) return
        const task: Data = {
          ...freshOccurrence(template),
          id: `${id}-date-${dateKey}`,
          recurrenceIndex: index,
        }
        if (
          task.objectiveId &&
          !document.entities.some(
            (entity) => entity.kind === 'project' && content(entity).id === task.objectiveId,
          )
        )
          delete task.objectiveId
        const dated = fields.datedTasksByDate as Record<string, Data[]>
        const lane = dateKey === today ? (fields.tasks as Data[]) : (dated[dateKey] ??= [])
        lane.push(task)
        if (sourceEvent && template.time) {
          task.minutes = Number(sourceEvent.end) - Number(sourceEvent.start)
          ;(fields.events as Data[]).push({
            ...sourceEvent,
            id: task.id,
            ...(sourceEvent.taskId ? { taskId: task.id } : {}),
            dateKey,
            title: task.title!,
            complete: false,
          })
        }
        for (const collection of [
          'weeklyObjectives',
          'archivedObjectives',
          'weekly.accomplishedObjectives',
        ]) {
          for (const objective of (fields[collection] ?? []) as Data[])
            if (objective.id === template.objectiveId) {
              ;(objective.tasks as Data[]).push({
                id: `objective-${task.id}`,
                taskId: task.id,
                title: task.title!,
                minutes: task.minutes!,
                complete: false,
              })
            }
        }
        changed = true
      })
      progress[id] = horizon
      changed = true
    }
    if (!changed) return fields
    fields.recurrenceProgress = progress
    return fields
  })
}

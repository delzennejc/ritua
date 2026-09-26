import type { Recurrence, SessionRecurrenceDefinition } from './models'
import type { Data, Entity, Json, WorkspaceDocument } from './workspace-types'
import { copyRecord, editDocument } from './workspace-immutable'
import { validateDocument } from './workspace-validation'
import { orderSessionBoardLanes, reconcileSessionBoards, sessionLane } from './session-board-order'
import { freshOccurrence } from './recurring-workspace'
import { noRecurrence, recurrenceDateKeys } from './recurrence'
import { addDays } from './calendar-dates'
import { taskContent } from './workspace-selectors'

export type SessionDeletionScope = 'single' | 'following'
export type SessionDeletionUndo = {
  sessions: Entity[]
  seriesId: string | null
  previousStop: Json | undefined
}
type SessionSeriesMetadata = {
  recurrence: Recurrence
  seriesId: string
  startDateKey: string
  index: number
}

const content = (entity: Entity) => entity.data.content as Data
const isSessionEntity = (entity: Entity) => entity.kind === 'event' && content(entity).kind === 'session'
const sessionEntities = (document: WorkspaceDocument) => document.entities.filter(isSessionEntity)
const taskEntities = (document: WorkspaceDocument) =>
  document.entities.filter((entity) => entity.kind === 'task')

/** Session edits reconcile their boards and are validated as one canonical change. */
function editSessionDocument(input: WorkspaceDocument, edit: (document: WorkspaceDocument) => void) {
  const next = editDocument(input, (document) => {
    edit(document)
    reconcileSessionBoards(input, document)
  })
  validateDocument(next)
  return next
}

/** The repeat rule describes timing only; each occurrence keeps its own task copies. */
function sessionTemplate(source: Data): Data {
  const template: Data = { title: source.title, start: source.start, end: source.end }
  if (source.color !== undefined) template.color = source.color
  return template
}

/** Repeated session work is copied without completion history or independent recurrence identity. */
function freshTaskTemplate(entity: Entity): Data {
  const task = freshOccurrence(taskContent(entity)) as Data
  delete task.id
  delete task.taskId
  delete task.recurrence
  delete task.recurrenceIndex
  delete task.recurrenceSeriesId
  delete task.recurrenceStartDateKey
  delete task.recurrenceEdited
  // A session supplies its members' timing; copies retain only their own estimate.
  task.time = null
  return task
}

function hasWork(task: Data) {
  return Boolean(
    task.complete ||
      Number(task.actualMinutes) > 0 ||
      task.notes ||
      (task.media as Data[] | undefined)?.length ||
      (task.comments as Data[] | undefined)?.length ||
      (task.activity as Data[] | undefined)?.length ||
      (task.subtasks as Data[] | undefined)?.some((item) => item.complete),
  )
}

/** Copies of session work join the same Project as their source task when it still exists. */
function linkTaskToProject(document: WorkspaceDocument, task: Data) {
  const objectiveId = task.objectiveId
  const owner = document.entities.find(
    (entity) =>
      entity.kind === 'project' &&
      entity.data.collection === 'weeklyObjectives' &&
      (entity.data.content as Data).id === objectiveId,
  )
  const project = objectiveId && owner ? owner : null
  if (!project) {
    delete task.objectiveId
    return
  }
  project.data.hasTasks = true
  ;(project.data.links as Data[]).push({
    id: `objective-${task.id}`,
    taskId: task.id,
    keys: ['id', 'taskId', 'title', 'minutes', 'complete'],
    extra: {},
  })
}

function occurrenceTaskEntities(
  document: WorkspaceDocument,
  occurrenceId: string,
  lane: string,
  templates: Data[],
) {
  const base = document.entities.filter(
    (entity) => entity.kind === 'task' && entity.data.lane === lane,
  ).length
  return templates.map((template, index) => {
    const task: Data = { ...copyRecord(template), id: `${occurrenceId}-task-${index + 1}` }
    return {
      kind: 'task' as const,
      id: String(task.id),
      data: { content: task, lane, position: base + index },
    }
  })
}

/** Generated work joins the same Project as its source task when it still exists. */
function linkOccurrenceTasks(document: WorkspaceDocument, tasks: Entity[], dateKey: string, lane: string) {
  for (const task of tasks) linkTaskToProject(document, content(task))
  if (tasks.length && lane !== 'today')
    document.fields.dateKeys = [...new Set([...(document.fields.dateKeys as string[]), dateKey])]
}

function insertSessionOccurrence(
  document: WorkspaceDocument,
  id: string,
  template: Data,
  templates: Data[],
  metadata: SessionSeriesMetadata,
  dateKey: string,
) {
  const lane = sessionLane(document, dateKey)
  const tasks = occurrenceTaskEntities(document, id, lane, templates)
  const event: Entity = {
    kind: 'event',
    id,
    data: {
      content: {
        ...copyRecord(template),
        id,
        kind: 'session',
        dateKey,
        taskIds: tasks.map((entity) => entity.id),
        recurrence: metadata.recurrence,
        recurrenceSeriesId: metadata.seriesId,
        recurrenceStartDateKey: metadata.startDateKey,
        recurrenceIndex: metadata.index,
      },
      taskId: null,
      derived: [],
      position: document.entities.filter((entity) => entity.kind === 'event').length,
    },
  }
  document.entities.push(event, ...tasks)
  linkOccurrenceTasks(document, tasks, dateKey, lane)
  return event
}

/** Generated copies without work are removed with their occurrence; worked tasks stay on the board. */
function deleteUntouchedTasks(document: WorkspaceDocument, ids: string[]) {
  const deleted = new Set<string>()
  for (const id of ids) {
    const task = document.entities.find((entity) => entity.kind === 'task' && entity.id === id)
    if (!task || hasWork(content(task))) continue
    deleted.add(id)
  }
  if (!deleted.size) return
  document.entities = document.entities.filter((entity) => {
    if (entity.kind === 'task' && deleted.has(entity.id)) return false
    if (entity.kind === 'event' && entity.data.taskId && deleted.has(String(entity.data.taskId))) return false
    return true
  })
  for (const entity of document.entities)
    if (entity.kind === 'project')
      entity.data.links = (entity.data.links as Data[]).filter((link) => !deleted.has(String(link.taskId)))
  for (const session of sessionEntities(document))
    content(session).taskIds = (content(session).taskIds as string[]).filter((id) => !deleted.has(id))
}

/** A reused occurrence gains fresh copies when the series repeats its tasks and it has none yet. */
function fillOccurrenceTasks(document: WorkspaceDocument, event: Entity, templates: Data[]) {
  if (!templates.length || ((content(event).taskIds as string[]) ?? []).length) return
  const dateKey = String(content(event).dateKey)
  const lane = sessionLane(document, dateKey)
  const tasks = occurrenceTaskEntities(document, event.id, lane, templates)
  document.entities.push(...tasks)
  content(event).taskIds = tasks.map((entity) => entity.id)
  linkOccurrenceTasks(document, tasks, dateKey, lane)
}

function clearOccurrenceTasks(document: WorkspaceDocument, event: Entity) {
  deleteUntouchedTasks(document, (content(event).taskIds as string[]) ?? [])
  content(event).taskIds = []
}

function setSeriesMetadata(target: Data, metadata: SessionSeriesMetadata) {
  target.recurrence = metadata.recurrence
  target.recurrenceSeriesId = metadata.seriesId
  target.recurrenceStartDateKey = metadata.startDateKey
  target.recurrenceIndex = metadata.index
}

function clearSeriesMetadata(target: Data) {
  delete target.recurrence
  delete target.recurrenceSeriesId
  delete target.recurrenceStartDateKey
  delete target.recurrenceIndex
}

/** Removing a future occurrence deletes only untouched generated copies; worked tasks stay on the board. */
function removeOccurrence(document: WorkspaceDocument, event: Entity) {
  deleteUntouchedTasks(document, (content(event).taskIds as string[] | undefined) ?? [])
  document.entities = document.entities.filter((entity) => entity !== event)
}

/**
 * Set, change or stop a session's repetition. Future occurrences are replaced as one edit:
 * completed and edited work is preserved, untouched generated copies are cleaned up, and
 * past occurrences keep their history. `repeatTasks` decides whether every occurrence
 * repeats the session's tasks or stays an empty session slot.
 */
export function changeWorkspaceSessionRecurrence(
  input: WorkspaceDocument,
  sessionId: string,
  recurrence: Recurrence,
  context: { today: string; seriesId: string; repeatTasks?: boolean },
): WorkspaceDocument {
  return editSessionDocument(input, (document) => {
    const selected = sessionEntities(document).find((entity) => entity.id === sessionId)
    if (!selected) return
    const selectedContent = content(selected)
    const oldSeries =
      typeof selectedContent.recurrenceSeriesId === 'string' ? selectedContent.recurrenceSeriesId : null
    const selectedDateKey = String(selectedContent.dateKey)
    const start = selectedDateKey < context.today ? context.today : selectedDateKey
    const recurring = recurrence.frequency !== 'none'
    const repeatTasks = context.repeatTasks !== false
    const series = sessionEntities(document).filter((entity) =>
      oldSeries ? content(entity).recurrenceSeriesId === oldSeries : entity.id === sessionId,
    )
    const future = series.filter((entity) => String(content(entity).dateKey) >= start)
    const session = sessionTemplate(selectedContent)
    const definitions = { ...((document.fields.sessionRecurrenceDefinitions ?? {}) as Data) }
    const previousDefinition = oldSeries ? (definitions[oldSeries] as Data | undefined) : undefined
    const previousTemplates = (previousDefinition?.tasks ?? []) as Data[]
    const occurrenceTemplates = (selectedContent.taskIds as string[])
      .map((id) => document.entities.find((entity) => entity.kind === 'task' && entity.id === id))
      .filter((entity): entity is Entity => Boolean(entity))
      .map(freshTaskTemplate)
    // Keep the series' task templates when switching to session-only so a later
    // change can repeat them again from an occurrence that is already empty.
    const storedTemplates = occurrenceTemplates.length ? occurrenceTemplates : previousTemplates
    const templates = repeatTasks ? storedTemplates : []
    const dates = recurring
      ? (recurrenceDateKeys(start, recurrence, addDays(start, 365)) as string[])
      : selectedDateKey >= context.today
        ? [selectedDateKey]
        : []
    const reused = new Set<string>()
    dates.forEach((dateKey, index) => {
      const existing = future.find(
        (entity) => !reused.has(entity.id) && String(content(entity).dateKey) === dateKey,
      )
      if (existing) {
        reused.add(existing.id)
        if (recurring)
          setSeriesMetadata(content(existing), {
            recurrence,
            seriesId: context.seriesId,
            startDateKey: start,
            index,
          })
        else clearSeriesMetadata(content(existing))
        // The selected occurrence keeps its own tasks; every reused date follows the chosen
        // scope. An empty selected occurrence gains copies when tasks repeat.
        if (recurring) {
          if (repeatTasks) fillOccurrenceTasks(document, existing, templates)
          else if (existing.id !== sessionId) clearOccurrenceTasks(document, existing)
        }
        return
      }
      const entity = insertSessionOccurrence(
        document,
        `${context.seriesId}-date-${dateKey}`,
        session,
        templates,
        { recurrence, seriesId: context.seriesId, startDateKey: start, index },
        dateKey,
      )
      reused.add(entity.id)
    })
    for (const entity of future) if (!reused.has(entity.id)) removeOccurrence(document, entity)
    const stops = { ...((document.fields.sessionRecurrenceStops ?? {}) as Data) }
    if (oldSeries && oldSeries !== context.seriesId) stops[oldSeries] = true
    if (recurring) delete stops[context.seriesId]
    document.fields.sessionRecurrenceStops = stops
    if (!recurring) return
    const definition: SessionRecurrenceDefinition = {
      session: {
        ...(copyRecord(session) as SessionRecurrenceDefinition['session']),
        recurrence,
        recurrenceStartDateKey: start,
      },
      tasks: copyRecord(storedTemplates) as SessionRecurrenceDefinition['tasks'],
      repeatTasks,
    }
    definitions[context.seriesId] = definition as unknown as Data
    document.fields.sessionRecurrenceDefinitions = definitions
    document.fields.sessionRecurrenceProgress = {
      ...((document.fields.sessionRecurrenceProgress ?? {}) as Data),
      [context.seriesId]: addDays(start, 365),
    }
  })
}

/**
 * The background color belongs to the repeat: changing it updates this occurrence
 * and every later occurrence of the series, and the template for future extension.
 */
export function changeWorkspaceSessionColor(
  input: WorkspaceDocument,
  sessionId: string,
  color: string | null,
): WorkspaceDocument {
  return editSessionDocument(input, (document) => {
    const selected = sessionEntities(document).find((entity) => entity.id === sessionId)
    if (!selected) return
    const selectedContent = content(selected)
    const seriesId =
      typeof selectedContent.recurrenceSeriesId === 'string' ? selectedContent.recurrenceSeriesId : null
    const dateKey = String(selectedContent.dateKey)
    const applyColor = (target: Data) => {
      if (color === null) delete target.color
      else target.color = color
    }
    applyColor(selectedContent)
    if (!seriesId) return
    const definitions = { ...((document.fields.sessionRecurrenceDefinitions ?? {}) as Data) }
    const definition = definitions[seriesId] as Data | undefined
    if (definition) {
      const session = { ...((definition.session ?? {}) as Data) }
      applyColor(session)
      definitions[seriesId] = { ...definition, session }
      document.fields.sessionRecurrenceDefinitions = definitions
    }
    for (const entity of sessionEntities(document)) {
      if (entity === selected) continue
      const candidate = content(entity)
      if (candidate.recurrenceSeriesId !== seriesId || String(candidate.dateKey) < dateKey) continue
      applyColor(candidate)
    }
  })
}

/** Append occurrences beyond the remembered boundary, never regenerating removed or moved dates. */ export function extendSessionRecurrences(
  input: WorkspaceDocument,
  today: string,
): WorkspaceDocument {
  const definitions = (input.fields.sessionRecurrenceDefinitions ?? {}) as Data
  const stops = (input.fields.sessionRecurrenceStops ?? {}) as Data
  const seriesIds = Object.keys(definitions).filter((id) => !stops[id])
  if (!seriesIds.length) return input
  const horizon = addDays(today, 365)
  const lanes = new Set<string>()
  return editDocument(input, (document) => {
    let changed = false
    for (const seriesId of seriesIds) {
      const definition = definitions[seriesId] as Data
      const session = (definition.session ?? {}) as Data
      const storedTemplates = (definition.tasks ?? []) as Data[]
      const templates = definition.repeatTasks === false ? [] : storedTemplates
      const recurrence = (session.recurrence as Recurrence | undefined) ?? noRecurrence()
      const start = String(session.recurrenceStartDateKey ?? today)
      const progress = (document.fields.sessionRecurrenceProgress ?? {}) as Data
      const through = String(progress[seriesId] ?? start)
      if (through >= horizon) continue
      const dates = recurrenceDateKeys(start, recurrence, horizon) as string[]
      const existing = new Set(
        sessionEntities(document)
          .filter((entity) => content(entity).recurrenceSeriesId === seriesId)
          .map((entity) => String(content(entity).dateKey)),
      )
      dates.forEach((dateKey, index) => {
        if (dateKey <= through || existing.has(dateKey)) return
        const id = `${seriesId}-date-${dateKey}`
        if (document.entities.some((entity) => entity.kind === 'event' && entity.id === id)) return
        insertSessionOccurrence(
          document,
          id,
          session,
          templates,
          { recurrence, seriesId, startDateKey: start, index },
          dateKey,
        )
        lanes.add(sessionLane(document, dateKey))
        changed = true
      })
      document.fields.sessionRecurrenceProgress = { ...progress, [seriesId]: horizon }
      changed = true
    }
    if (changed) orderSessionBoardLanes(document, lanes)
  })
}

/** Delete one occurrence, or stop the series and remove this and every following occurrence. */
export function deleteWorkspaceSession(
  input: WorkspaceDocument,
  sessionId: string,
  scope: SessionDeletionScope = 'single',
) {
  let undo: SessionDeletionUndo = { sessions: [], seriesId: null, previousStop: undefined }
  const document = editSessionDocument(input, (document) => {
    const selected = sessionEntities(document).find((entity) => entity.id === sessionId)
    if (!selected) return
    const selectedContent = content(selected)
    const seriesId =
      scope === 'following' && typeof selectedContent.recurrenceSeriesId === 'string'
        ? selectedContent.recurrenceSeriesId
        : null
    const removed = new Set<string>([sessionId])
    if (seriesId) {
      const index = Number(selectedContent.recurrenceIndex ?? 0)
      for (const entity of sessionEntities(document)) {
        const candidate = content(entity)
        if (candidate.recurrenceSeriesId === seriesId && Number(candidate.recurrenceIndex ?? 0) >= index)
          removed.add(entity.id)
      }
    }
    const stops = { ...((document.fields.sessionRecurrenceStops ?? {}) as Data) }
    undo = { sessions: [], seriesId, previousStop: seriesId ? stops[seriesId] : undefined }
    if (seriesId) {
      stops[seriesId] = true
      document.fields.sessionRecurrenceStops = stops
    }
    document.entities = document.entities.filter((entity) => {
      if (entity.kind === 'event' && removed.has(entity.id)) {
        undo.sessions.push(copyRecord(entity))
        return false
      }
      return true
    })
  })
  return { document, undo }
}

export function undoWorkspaceSessionDeletion(
  input: WorkspaceDocument,
  undo: SessionDeletionUndo,
): WorkspaceDocument {
  return editSessionDocument(input, (document) => {
    const taskIds = new Set(taskEntities(document).map((entity) => entity.id))
    for (const saved of [...undo.sessions].sort(
      (a, b) => Number(a.data.position) - Number(b.data.position),
    )) {
      if (document.entities.some((entity) => entity.kind === 'event' && entity.id === saved.id)) continue
      const events = document.entities
        .filter((entity) => entity.kind === 'event')
        .sort((a, b) => Number(a.data.position) - Number(b.data.position))
      const restored = copyRecord(saved)
      const session = restored.data.content as Data
      session.taskIds = (session.taskIds as string[]).filter((id) => taskIds.has(id))
      events.splice(Math.min(Number(saved.data.position), events.length), 0, restored)
      events.forEach((entity, index) => {
        entity.data.position = index
      })
      document.entities.push(restored)
      if (typeof session.dateKey === 'string')
        document.fields.dateKeys = [...new Set([...(document.fields.dateKeys as string[]), session.dateKey])]
    }
    if (undo.seriesId) {
      const stops = { ...((document.fields.sessionRecurrenceStops ?? {}) as Data) }
      if (undo.previousStop === undefined) delete stops[undo.seriesId]
      else stops[undo.seriesId] = undo.previousStop
      document.fields.sessionRecurrenceStops = stops
    }
  })
}

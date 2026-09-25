import { editDocument, equalJson, copyRecord } from './workspace-immutable'
import type { WorkspaceDocument } from './workspace-types'

type Patch = {
  scope: 'field' | 'entity'
  entity?: { kind: string; id: string }
  path: string[]
  beforePresent: boolean
  before?: unknown
  afterPresent: boolean
  after?: unknown
}

type EventGuard = { id: string; dateKey: unknown; start: unknown; end: unknown }
type EntityGuard =
  | { kind: 'task'; id: string; lane: unknown }
  | { kind: 'event'; id: string; taskId: unknown; dateKey: unknown; start: unknown; end: unknown }
export type TodayStatusUndo = {
  patches: Patch[]
  taskId: string
  taskLane: unknown
  relatedEvents: EventGuard[]
  entityGuards: EntityGuard[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

function collect(
  scope: Patch['scope'],
  entity: Patch['entity'],
  path: string[],
  before: unknown,
  after: unknown,
  patches: Patch[],
) {
  if (equalJson(before, after)) return
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      collect(scope, entity, [...path, key], before[key], after[key], patches)
    }
    return
  }
  patches.push({
    scope,
    entity,
    path,
    beforePresent: before !== undefined,
    ...(before === undefined ? {} : { before: copyRecord(before) }),
    afterPresent: after !== undefined,
    ...(after === undefined ? {} : { after: copyRecord(after) }),
  })
}

/** Records field-level inverses so an undo can preserve unrelated edits made afterward. */
export function createTodayStatusUndo(
  before: WorkspaceDocument,
  after: WorkspaceDocument,
  taskId: string,
): TodayStatusUndo {
  const patches: Patch[] = []
  collect('field', undefined, [], before.fields, after.fields, patches)
  const beforeById = new Map(before.entities.map((entity) => [`${entity.kind}:${entity.id}`, entity]))
  for (const next of after.entities) {
    const old = beforeById.get(`${next.kind}:${next.id}`)
    if (old && old !== next)
      collect('entity', { kind: next.kind, id: next.id }, [], old.data, next.data, patches)
  }
  const task = after.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
  const relatedEvents = after.entities
    .filter((entity) => entity.kind === 'event' && entity.data.taskId === taskId)
    .map((entity) => {
      const content = entity.data.content as Record<string, unknown>
      return { id: entity.id, dateKey: content.dateKey, start: content.start, end: content.end }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const touched = new Set(
    patches.filter((patch) => patch.entity).map((patch) => `${patch.entity!.kind}:${patch.entity!.id}`),
  )
  const entityGuards = after.entities.flatMap<EntityGuard>((entity) => {
    if (!touched.has(`${entity.kind}:${entity.id}`)) return []
    if (entity.kind === 'task') return [{ kind: 'task', id: entity.id, lane: entity.data.lane }]
    if (entity.kind === 'event') {
      const content = entity.data.content as Record<string, unknown>
      return [
        {
          kind: 'event',
          id: entity.id,
          taskId: entity.data.taskId,
          dateKey: content.dateKey,
          start: content.start,
          end: content.end,
        },
      ]
    }
    return []
  })
  return { patches, taskId, taskLane: task?.data.lane, relatedEvents, entityGuards }
}

function canApply(document: WorkspaceDocument, undo: TodayStatusUndo) {
  const taskId = undo.taskId
  const task = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
  if (!task || !equalJson(task.data.lane, undo.taskLane)) return false
  const relatedEvents = document.entities
    .filter((entity) => entity.kind === 'event' && entity.data.taskId === taskId)
    .map((entity) => {
      const content = entity.data.content as Record<string, unknown>
      return { id: entity.id, dateKey: content.dateKey, start: content.start, end: content.end }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  if (!equalJson(relatedEvents, undo.relatedEvents)) return false
  const entitiesById = new Map(document.entities.map((entity) => [`${entity.kind}:${entity.id}`, entity]))
  for (const guard of undo.entityGuards) {
    const entity = entitiesById.get(`${guard.kind}:${guard.id}`)
    if (!entity) return false
    if (guard.kind === 'task') {
      if (!equalJson(entity.data.lane, guard.lane)) return false
    } else {
      const content = entity.data.content as Record<string, unknown>
      if (
        !equalJson(entity.data.taskId, guard.taskId) ||
        !equalJson(content.dateKey, guard.dateKey) ||
        !equalJson(content.start, guard.start) ||
        !equalJson(content.end, guard.end)
      )
        return false
    }
  }

  return undo.patches.every((patch) => {
    const owner: Record<string, unknown> | undefined =
      patch.scope === 'field'
        ? (document.fields as Record<string, unknown>)
        : (document.entities.find(
            (entity) => entity.kind === patch.entity?.kind && entity.id === patch.entity.id,
          )?.data as Record<string, unknown> | undefined)
    if (!owner) return false
    let target: Record<string, unknown> | undefined = owner
    for (const key of patch.path.slice(0, -1)) {
      const child: unknown = target[key]
      if (!isRecord(child)) return false
      target = child
    }
    const key = patch.path.at(-1)
    if (!key || !target) return false
    const currentPresent = Object.hasOwn(target, key)
    return currentPresent === patch.afterPresent && (!currentPresent || equalJson(target[key], patch.after))
  })
}

/** Applies the inverse atomically only while all affected values and schedule guards still match. */
export function undoTodayStatus(document: WorkspaceDocument, undo: TodayStatusUndo): WorkspaceDocument {
  if (!canApply(document, undo)) return document
  return editDocument(document, (draft) => {
    for (const patch of undo.patches) {
      const owner: Record<string, unknown> | undefined =
        patch.scope === 'field'
          ? (draft.fields as Record<string, unknown>)
          : (draft.entities.find(
              (entity) => entity.kind === patch.entity?.kind && entity.id === patch.entity.id,
            )?.data as Record<string, unknown> | undefined)
      if (!owner) continue
      let target: Record<string, unknown> | undefined = owner
      for (const key of patch.path.slice(0, -1)) {
        const child: unknown = target?.[key]
        if (!isRecord(child)) return
        target = child
      }
      if (!target) continue
      const key = patch.path.at(-1)
      if (!key) continue
      if (patch.beforePresent) target[key] = copyRecord(patch.before)
      else delete target[key]
    }
  })
}

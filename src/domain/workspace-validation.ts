import { validateTaskDetails } from './task-validation'
import type { Json } from './workspace-types'
import type { WorkspaceDocument } from './workspace-types'
import type { Data, WorkspaceCommit } from './workspace-types'
import { durableFields } from './workspace-fields'
import { WorkspaceValidationError, WorkspaceConflictError } from './workspace-errors'
const array = (value: Json | undefined): Data[] => (value ?? []) as Data[]
const object = (value: Json | undefined): Data => (value ?? {}) as Data

export { WorkspaceValidationError, WorkspaceConflictError } from './workspace-errors'
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkspaceValidationError(message)
}
export function validateJson(value: unknown, depth = 0, maxText = 200000): asserts value is Json {
  assert(depth < 32, 'Workspace data is too deeply nested')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'Invalid number')
    return
  }
  if (typeof value === 'string') {
    assert(value.length <= maxText, 'Text is too long')
    return
  }
  assert(value && typeof value === 'object', 'Workspace data must be serializable')
  if (Array.isArray(value)) {
    assert(value.length <= 50000, 'Too many items')
    for (const item of value) validateJson(item, depth + 1, maxText)
    return
  }
  for (const [key, item] of Object.entries(value)) {
    assert(!['__proto__', 'prototype', 'constructor'].includes(key), 'Invalid field')
    validateJson(item, depth + 1, maxText)
  }
}
export function validateCommit(value: unknown): WorkspaceCommit {
  validateJson(value)
  assert(value && !Array.isArray(value) && typeof value === 'object', 'Invalid workspace command')
  const command = value as unknown as WorkspaceCommit
  assert(Number.isSafeInteger(command.revision) && command.revision >= 0, 'Invalid revision')
  assert(
    typeof command.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(command.requestId),
    'Invalid request ID',
  )
  assert(Array.isArray(command.put) && Array.isArray(command.remove), 'Invalid changes')
  assert(
    command.fields && typeof command.fields === 'object' && !Array.isArray(command.fields),
    'Invalid workspace fields',
  )
  if (command.fields.profile !== undefined) {
    const profile = command.fields.profile as Data
    assert(
      profile &&
        typeof profile === 'object' &&
        typeof profile.displayName === 'string' &&
        profile.displayName.trim().length > 0 &&
        profile.displayName.length <= 80,
      'Profile name must contain 1–80 characters',
    )
    assert(
      typeof profile.avatar === 'string' &&
        (!profile.avatar || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(profile.avatar)),
      'Invalid profile picture',
    )
  }
  const allowed = new Set<string>([...durableFields, 'dateKeys'])
  for (const key of Object.keys(command.fields)) assert(allowed.has(key), `Unknown workspace field ${key}`)
  for (const e of [...command.put, ...command.remove]) {
    assert(['area', 'task', 'project', 'event'].includes(e.kind), 'Invalid entity kind')
    assert(typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 500, 'Invalid entity ID')
  }
  for (const e of command.put)
    assert(e.data && typeof e.data === 'object' && !Array.isArray(e.data), 'Invalid entity payload')
  assert(JSON.stringify(command).length <= 12000000, 'Workspace change is too large')
  return command
}
export function applyChanges(current: WorkspaceDocument, raw: unknown): WorkspaceDocument {
  const command = validateCommit(raw)
  if (command.revision !== current.revision)
    throw new WorkspaceConflictError('Workspace changed. Choose which conflicting edits to keep.')
  const entities = new Map(current.entities.map((e) => [`${e.kind}:${e.id}`, e]))
  for (const e of command.remove) entities.delete(`${e.kind}:${e.id}`)
  for (const e of command.put) entities.set(`${e.kind}:${e.id}`, e)
  const result = { revision: current.revision + 1, entities: [...entities.values()], fields: command.fields }
  validateDocument(result)
  return result
}
const checkedEntityShapes = new WeakSet<object>()
function validateReferences(entity: import('./workspace-types').Entity, taskIds: Set<string>) {
  if (entity.kind === 'project')
    for (const link of array(entity.data.links))
      assert(taskIds.has(String(link.taskId)), 'Project references missing task')
  if (entity.kind === 'event') {
    if (entity.data.taskId) assert(taskIds.has(String(entity.data.taskId)), 'Event references missing task')
    const content = object(entity.data.content)
    if (content.kind === 'session')
      for (const id of content.taskIds as string[]) assert(taskIds.has(id), 'Session references missing task')
  }
}
export function validateDocument(doc: WorkspaceDocument) {
  assert(doc.entities.length <= 100000, 'Too many workspace entities')
  const ids = new Set<string>()
  const taskIds = new Set(doc.entities.filter((e) => e.kind === 'task').map((e) => e.id))
  for (const e of doc.entities) {
    assert(!ids.has(`${e.kind}:${e.id}`), 'Duplicate entity')
    ids.add(`${e.kind}:${e.id}`)
    if (Object.isFrozen(e) && checkedEntityShapes.has(e)) {
      validateReferences(e, taskIds)
      continue
    }
    const content = object(e.data.content)
    assert(typeof content.id === 'string', 'Missing content ID')
    assert(Number.isSafeInteger(e.data.position) && Number(e.data.position) >= 0, 'Invalid entity order')
    if (e.kind !== 'project') assert(content.id === e.id, 'Entity identity mismatch')
    else {
      assert(
        ['weeklyObjectives', 'archivedObjectives', 'weekly.accomplishedObjectives'].includes(
          String(e.data.collection),
        ),
        'Invalid Project collection',
      )
      assert(e.id === `${e.data.collection}:${content.id}`, 'Project identity mismatch')
      assert(Array.isArray(e.data.links), 'Invalid Project links')
      if (content.taskOrder !== undefined)
        assert(
          Array.isArray(content.taskOrder) &&
            content.taskOrder.every((id) => typeof id === 'string') &&
            new Set(content.taskOrder).size === content.taskOrder.length,
          'Invalid Project task order',
        )
      for (const link of array(e.data.links))
        assert(
          typeof link.id === 'string' &&
            typeof link.taskId === 'string' &&
            Array.isArray(link.keys) &&
            link.keys.every((key) => typeof key === 'string'),
          'Invalid task reference',
        )
    }
    if (e.kind === 'task' || e.kind === 'project') assert(typeof content.title === 'string', 'Missing title')
    if (e.kind === 'area')
      assert(typeof content.label === 'string' && typeof content.color === 'string', 'Invalid Area')
    if (e.kind === 'task') {
      validateTaskDetails(content)
      assert(
        typeof e.data.lane === 'string' && /^(today$|date:|backlog:|project:)/.test(e.data.lane),
        'Invalid task location',
      )
      for (const field of ['minutes', 'actualMinutes'])
        if (content[field] != null)
          assert(
            typeof content[field] === 'number' &&
              Number.isFinite(content[field]) &&
              Number(content[field]) >= 0,
            'Invalid duration',
          )
      if (content.completedDateKey != null)
        assert(
          typeof content.completedDateKey === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(content.completedDateKey) &&
            !Number.isNaN(Date.parse(content.completedDateKey)) &&
            new Date(content.completedDateKey).toISOString().slice(0, 10) === content.completedDateKey,
          'Invalid completion date',
        )
      if (content.complete !== undefined)
        assert(typeof content.complete === 'boolean', 'Invalid task completion')
      if (content.subtasks !== undefined) {
        assert(Array.isArray(content.subtasks), 'Invalid subtasks')
        for (const subtask of array(content.subtasks)) {
          assert(
            typeof subtask.id === 'string' &&
              typeof subtask.title === 'string' &&
              typeof subtask.complete === 'boolean',
            'Invalid subtask',
          )
          for (const field of ['minutes', 'actualMinutes'])
            if (subtask[field] != null)
              assert(
                typeof subtask[field] === 'number' && Number(subtask[field]) >= 0,
                'Invalid subtask duration',
              )
        }
      }
      if (content.media !== undefined) {
        assert(
          Array.isArray(content.media) && content.media.length <= 100,
          'A task can contain up to 100 images',
        )
        const ids = new Set<string>()
        for (const item of array(content.media)) {
          const file = item && object(item.attachment)
          assert(
            file && typeof file.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(file.id) && !ids.has(file.id),
            'Invalid media attachment',
          )
          assert(
            typeof file.name === 'string' &&
              file.name.length > 0 &&
              file.name.length <= 255 &&
              typeof file.size === 'number' &&
              Number.isSafeInteger(file.size) &&
              file.size > 0 &&
              file.size <= 25 * 1024 * 1024,
            'Invalid image metadata',
          )
          ids.add(file.id)
        }
      }
      for (const key of ['comments', 'activity'])
        if (content[key] !== undefined) assert(Array.isArray(content[key]), `Invalid ${key}`)
    }
    if (e.kind === 'event') {
      assert(
        typeof content.start === 'number' &&
          typeof content.end === 'number' &&
          content.start >= 0 &&
          content.end >= content.start &&
          content.end <= 1440,
        'Invalid calendar event',
      )
      if (e.data.taskId) assert(taskIds.has(String(e.data.taskId)), 'Calendar references missing task')
      if (content.taskId !== undefined)
        assert(
          typeof content.taskId === 'string' && content.taskId === e.data.taskId,
          'Invalid calendar task reference',
        )
      if (content.kind === 'session') {
        assert(
          typeof content.title === 'string' && content.title.trim().length > 0 && content.title.length <= 500,
          'Session title must contain 1–500 characters',
        )
        assert(
          Number.isInteger(content.start) &&
            Number.isInteger(content.end) &&
            Number(content.end) - Number(content.start) >= 15,
          'Sessions must last at least 15 minutes',
        )
        assert(
          typeof content.dateKey === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(content.dateKey) &&
            !Number.isNaN(Date.parse(content.dateKey)) &&
            new Date(content.dateKey).toISOString().slice(0, 10) === content.dateKey,
          'Invalid session date',
        )
        assert(!e.data.taskId, 'A session cannot be a task')
        assert(
          Array.isArray(content.taskIds) &&
            content.taskIds.length <= 1000 &&
            new Set(content.taskIds).size === content.taskIds.length,
          'Invalid session tasks',
        )
        for (const id of content.taskIds)
          assert(typeof id === 'string' && taskIds.has(id), 'Session references missing task')
      }
    }
    validateReferences(e, taskIds)
    if (Object.isFrozen(e)) checkedEntityShapes.add(e)
  }
}

export function validateSnapshot(document: WorkspaceDocument) {
  validateCommit({
    revision: document.revision,
    requestId: 'snapshot',
    fields: document.fields,
    put: [],
    remove: [],
  })
  for (const entity of document.entities)
    validateCommit({
      revision: document.revision,
      requestId: 'snapshot',
      fields: {},
      put: [entity],
      remove: [],
    })
  validateDocument(document)
}

const checkedFields = new WeakSet<object>()
const checkedRecords = new WeakSet<object>()
/** Renderer snapshots are frozen. Check new payloads once, but check relationships on every edit. */
export function validateImmutableSnapshot(document: WorkspaceDocument) {
  if (!checkedFields.has(document.fields)) {
    validateCommit({
      revision: document.revision,
      requestId: 'snapshot',
      fields: document.fields,
      put: [],
      remove: [],
    })
    if (Object.isFrozen(document.fields)) checkedFields.add(document.fields)
  }
  for (const entity of document.entities)
    if (!checkedRecords.has(entity)) {
      validateCommit({
        revision: document.revision,
        requestId: 'snapshot',
        fields: {},
        put: [entity],
        remove: [],
      })
      if (Object.isFrozen(entity)) checkedRecords.add(entity)
    }
  validateDocument(document)
}

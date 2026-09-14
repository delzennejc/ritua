import { equalJson } from './workspace-immutable'
import { sharedTaskFields } from './workspace-fields'
import type { Json } from './workspace-types'
import type { Fields } from './workspace-types'
import type { WorkspaceDocument } from './workspace-types'
import type { WorkspaceCommit } from './workspace-types'
import type { Data, Entity } from './workspace-types'
const array = (value: Json | undefined): Data[] => (value ?? []) as Data[]
const object = (value: Json | undefined): Data => (value ?? {}) as Data

// View pools are projections only. Each task is persisted once with its canonical location.
export function normalize(fields: Fields, revision = 0, cloneRecords = true): WorkspaceDocument {
  const copy = <T>(value: T): T => (cloneRecords ? (JSON.parse(JSON.stringify(value)) as T) : value)
  const entities: Entity[] = []
  const taskMap = new Map<string, Entity>()
  const rest = { ...copy(fields) }
  for (const key of [
    'areas',
    'tasks',
    'datedTasksByDate',
    'backlogGroups',
    'weeklyObjectives',
    'archivedObjectives',
    'events',
    'weekly.accomplishedObjectives',
  ])
    delete rest[key]
  const addTask = (task: Data, lane: string, position: number) => {
    const id = String(task.id)
    if (taskMap.has(id)) throw new Error(`Task ${id} is present in more than one canonical lane`)
    const entity: Entity = { kind: 'task', id, data: { content: copy(task), lane, position } }
    taskMap.set(id, entity)
    entities.push(entity)
  }
  array(fields.tasks).forEach((task, i) => addTask(task, 'today', i))
  const dated = object(fields.datedTasksByDate)
  rest.dateKeys = Object.keys(dated)
  for (const [date, tasks] of Object.entries(dated))
    array(tasks).forEach((task, i) => addTask(task, `date:${date}`, i))
  rest.backlogGroups = array(fields.backlogGroups).map((group) => {
    array(group.items).forEach((task, i) => addTask(task, `backlog:${group.id}`, i))
    const { items: _items, ...metadata } = group
    return metadata
  })
  array(fields.areas).forEach((area, position) =>
    entities.push({ kind: 'area', id: String(area.id), data: { content: copy(area), position } }),
  )
  for (const collection of ['weeklyObjectives', 'archivedObjectives', 'weekly.accomplishedObjectives']) {
    array(fields[collection]).forEach((project, position) => {
      const { tasks: members, ...content } = project
      const links = array(members).map((member, index) => {
        const taskId = String(member.taskId ?? member.id)
        if (!taskMap.has(taskId))
          addTask({ ...member, id: taskId }, `project:${collection}:${project.id}`, index)
        const task = object(taskMap.get(taskId)!.data.content)
        const extra: Data = {}
        for (const [key, value] of Object.entries(member)) {
          if (value === undefined) continue
          if (key === 'id' || key === 'taskId') continue
          if (sharedTaskFields.has(key)) {
            if (task[key] === undefined) {
              taskMap.get(taskId)!.data.content = {
                ...object(taskMap.get(taskId)!.data.content),
                [key]: copy(value),
              }
            }
          } else extra[key] = copy(value)
        }
        return { id: member.id!, taskId, keys: Object.keys(member), extra }
      })
      entities.push({
        kind: 'project',
        id: `${collection}:${project.id}`,
        data: { content, collection, position, links, hasTasks: members !== undefined },
      })
    })
  }
  array(fields.events).forEach((event, position) => {
    const task = event.kind === 'session' ? undefined : taskMap.get(String(event.id))
    const content = { ...copy(event) }
    const derived: string[] = []
    if (task) {
      for (const key of ['title', 'complete'])
        if (key in content) {
          delete content[key]
          derived.push(key)
        }
    }
    entities.push({
      kind: 'event',
      id: String(event.id),
      data: { content, position, taskId: task?.id ?? null, derived },
    })
  })
  return copy({ revision, entities, fields: rest })
}

export function project(document: WorkspaceDocument, cloneRecords = true): Fields {
  const copy = <T>(value: T): T => (cloneRecords ? (JSON.parse(JSON.stringify(value)) as T) : value)
  const fields = { ...copy(document.fields) }
  // Index once; scanning every task once per dated lane made projection quadratic.
  const kinds = new Map<Entity['kind'], Entity[]>()
  const lanes = new Map<string, Entity[]>()
  const taskMap = new Map<string, Data>()
  for (const entity of document.entities) {
    const group = kinds.get(entity.kind) ?? []
    group.push(entity)
    kinds.set(entity.kind, group)
    if (entity.kind === 'task') {
      taskMap.set(entity.id, object(entity.data.content))
      const lane = String(entity.data.lane)
      const members = lanes.get(lane) ?? []
      members.push(entity)
      lanes.set(lane, members)
    }
  }
  const byPosition = (a: Entity, b: Entity) => Number(a.data.position) - Number(b.data.position)
  for (const group of kinds.values()) group.sort(byPosition)
  for (const group of lanes.values()) group.sort(byPosition)
  const ordered = (kind: Entity['kind']) => kinds.get(kind) ?? []
  const lane = (name: string) => (lanes.get(name) ?? []).map((e) => copy(e.data.content))
  fields.tasks = lane('today')
  fields.datedTasksByDate = Object.fromEntries(
    ((fields.dateKeys as string[]) ?? []).map((date) => [date, lane(`date:${date}`)]),
  )
  delete fields.dateKeys
  fields.backlogGroups = array(fields.backlogGroups).map((group) => ({
    ...group,
    items: lane(`backlog:${group.id}`),
  }))
  fields.areas = ordered('area').map((e) => copy(e.data.content))
  for (const collection of ['weeklyObjectives', 'archivedObjectives', 'weekly.accomplishedObjectives']) {
    fields[collection] = ordered('project')
      .filter((e) => e.data.collection === collection)
      .map((e) => {
        const result = { ...copy(object(e.data.content)) }
        if (e.data.hasTasks)
          result.tasks = array(e.data.links).map((link) => {
            const task = taskMap.get(String(link.taskId)) ?? {}
            const member: Data = {}
            for (const key of link.keys as string[]) {
              if (key === 'id') member.id = link.id!
              else if (key === 'taskId') member.taskId = link.taskId!
              else if (sharedTaskFields.has(key)) {
                if (task[key] !== undefined) member[key] = copy(task[key])
              } else if (object(link.extra)[key] !== undefined) member[key] = copy(object(link.extra)[key])
            }
            return member
          })
        return result
      })
  }
  fields.events = ordered('event').map((e) => {
    const event = { ...copy(object(e.data.content)) }
    const task = taskMap.get(String(e.data.taskId))
    for (const key of e.data.derived as string[]) if (task?.[key] !== undefined) event[key] = copy(task[key])
    return event
  })
  return fields
}

export function changes(
  before: WorkspaceDocument,
  after: WorkspaceDocument,
  requestId: string,
): WorkspaceCommit {
  const old = new Map(before.entities.map((e) => [`${e.kind}:${e.id}`, e]))
  const next = new Set(after.entities.map((e) => `${e.kind}:${e.id}`))
  return {
    revision: before.revision,
    requestId,
    put: after.entities.filter((e) => !equalJson(old.get(`${e.kind}:${e.id}`), e)),
    remove: before.entities
      .filter((e) => !next.has(`${e.kind}:${e.id}`))
      .map(({ kind, id }) => ({ kind, id })),
    fields: after.fields,
  }
}

// Canonical desktop workspace records. No renderer, Electron or SQL imports.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Data = { [key: string]: Json }
export type Fields = Record<string, Json>
export interface Entity { kind: 'task' | 'project' | 'area' | 'event'; id: string; data: Data }
export interface WorkspaceDocument { revision: number; entities: Entity[]; fields: Fields }
export interface WorkspaceCommit { revision: number; requestId: string; put: Entity[]; remove: { kind: Entity['kind']; id: string }[]; fields: Fields }
export const durableFields = ['profile','archivedAreas','recurrenceDefinitions','recurrenceProgress','recurrenceStops','workspaceDate','ritualHistory','daily.completedDate','weekly.completedWeek','areas','tasks','datedTasksByDate','backlogGroups','weeklyObjectives','archivedObjectives','weeklyObjectiveOrder','events','view','planningStep','weeklyStep','taskScope','navigationOpen','rightPanelOpenByPage','rightPanes','daily.planText','daily.shutdownTime','daily.yesterdayTaskIdsByLane','weekly.reviewText','weekly.planText','weekly.accomplishedObjectives'] as const
const array = (value: Json | undefined): Data[] => (value ?? []) as Data[]
const object = (value: Json | undefined): Data => (value ?? {}) as Data
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const sharedTaskFields = new Set(['title','minutes','actualMinutes','complete','time','channel','accent','objectiveId','subtasks','notes','comments','activity','completedAtMinute','recurrence','recurrenceIndex','recurrenceEdited','recurrenceSeriesId','recurrenceStartDateKey'])

// View pools are projections only. Each task is persisted once with its canonical location.
export function normalize(fields: Fields, revision = 0): WorkspaceDocument {
  const entities: Entity[] = []
  const taskMap = new Map<string, Entity>()
  const rest = copy(fields)
  for (const key of ['areas','tasks','datedTasksByDate','backlogGroups','weeklyObjectives','archivedObjectives','events','weekly.accomplishedObjectives']) delete rest[key]
  const addTask = (task: Data, lane: string, position: number) => {
    const id = String(task.id)
    if (taskMap.has(id)) throw new Error(`Task ${id} is present in more than one canonical lane`)
    const entity: Entity = { kind: 'task', id, data: { content: copy(task), lane, position } }
    taskMap.set(id, entity); entities.push(entity)
  }
  array(fields.tasks).forEach((task, i) => addTask(task, 'today', i))
  const dated = object(fields.datedTasksByDate)
  rest.dateKeys = Object.keys(dated)
  for (const [date, tasks] of Object.entries(dated)) array(tasks).forEach((task, i) => addTask(task, `date:${date}`, i))
  rest.backlogGroups = array(fields.backlogGroups).map(group => {
    array(group.items).forEach((task, i) => addTask(task, `backlog:${group.id}`, i))
    const { items: _items, ...metadata } = group
    return metadata
  })
  array(fields.areas).forEach((area, position) => entities.push({kind: 'area', id: String(area.id), data: {content: copy(area), position}}))
  for (const collection of ['weeklyObjectives','archivedObjectives','weekly.accomplishedObjectives']) {
    array(fields[collection]).forEach((project, position) => {
      const { tasks: members, ...content } = project
      const links = array(members).map((member, index) => {
        const taskId = String(member.taskId ?? member.id)
        if (!taskMap.has(taskId)) addTask({...member, id: taskId}, `project:${collection}:${project.id}`, index)
        const task = object(taskMap.get(taskId)!.data.content)
        const extra: Data = {}
        for (const [key, value] of Object.entries(member)) {
          if(value === undefined) continue
          if (key === 'id' || key === 'taskId') continue
          if (sharedTaskFields.has(key)) { if (task[key] === undefined) task[key] = copy(value) }
          else extra[key] = copy(value)
        }
        return {id: member.id!, taskId, keys: Object.keys(member), extra}
      })
      entities.push({kind: 'project', id: `${collection}:${project.id}`, data: {content, collection, position, links, hasTasks: members !== undefined}})
    })
  }
  array(fields.events).forEach((event, position) => {
    const task = taskMap.get(String(event.id))
    const content = copy(event)
    const derived: string[] = []
    if (task) {
      for (const key of ['title','complete']) if (key in content) { delete content[key]; derived.push(key) }
    }
    entities.push({kind:'event', id:String(event.id), data:{content, position, taskId:task?.id ?? null, derived}})
  })
  return copy({revision, entities, fields: rest})
}

export function project(document: WorkspaceDocument): Fields {
  const fields = copy(document.fields)
  const tasks = document.entities.filter(e => e.kind === 'task')
  const taskMap = new Map(tasks.map(e => [e.id, object(e.data.content)]))
  const ordered = (kind: Entity['kind']) => document.entities.filter(e => e.kind === kind).sort((a,b) => Number(a.data.position) - Number(b.data.position))
  const lane = (name: string) => tasks.filter(e => e.data.lane === name).sort((a,b) => Number(a.data.position) - Number(b.data.position)).map(e => copy(e.data.content))
  fields.tasks = lane('today')
  fields.datedTasksByDate = Object.fromEntries((fields.dateKeys as string[] ?? []).map(date => [date, lane(`date:${date}`)]))
  delete fields.dateKeys
  fields.backlogGroups = array(fields.backlogGroups).map(group => ({...group, items: lane(`backlog:${group.id}`)}))
  fields.areas = ordered('area').map(e => copy(e.data.content))
  for (const collection of ['weeklyObjectives','archivedObjectives','weekly.accomplishedObjectives']) {
    fields[collection] = ordered('project').filter(e => e.data.collection === collection).map(e => {
      const result = copy(object(e.data.content))
      if (e.data.hasTasks) result.tasks = array(e.data.links).map(link => {
        const task = taskMap.get(String(link.taskId)) ?? {}
        const member: Data = {}
        for (const key of link.keys as string[]) {
          if (key === 'id') member.id = link.id!
          else if (key === 'taskId') member.taskId = link.taskId!
          else if (sharedTaskFields.has(key)) { if (task[key] !== undefined) member[key] = copy(task[key]) }
          else if (object(link.extra)[key] !== undefined) member[key] = copy(object(link.extra)[key])
        }
        return member
      })
      return result
    })
  }
  fields.events = ordered('event').map(e => {
    const event = copy(object(e.data.content))
    const task = taskMap.get(String(e.data.taskId))
    for (const key of e.data.derived as string[]) if (task?.[key] !== undefined) event[key] = copy(task[key])
    return event
  })
  return fields
}

export function changes(before: WorkspaceDocument, after: WorkspaceDocument, requestId: string): WorkspaceCommit {
  const old = new Map(before.entities.map(e => [`${e.kind}:${e.id}`, JSON.stringify(e)]))
  const next = new Set(after.entities.map(e => `${e.kind}:${e.id}`))
  return { revision: before.revision, requestId,
    put: after.entities.filter(e => old.get(`${e.kind}:${e.id}`) !== JSON.stringify(e)),
    remove: before.entities.filter(e => !next.has(`${e.kind}:${e.id}`)).map(({kind,id})=>({kind,id})), fields: after.fields }
}

export class WorkspaceValidationError extends Error {}
export class WorkspaceConflictError extends Error {}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new WorkspaceValidationError(message) }
export function validateJson(value: unknown, depth = 0, maxText = 200000): asserts value is Json {
  assert(depth < 32, 'Workspace data is too deeply nested')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') { assert(Number.isFinite(value), 'Invalid number'); return }
  if (typeof value === 'string') { assert(value.length <= maxText, 'Text is too long'); return }
  assert(value && typeof value === 'object', 'Workspace data must be serializable')
  if (Array.isArray(value)) { assert(value.length <= 50000, 'Too many items'); for(const item of value) validateJson(item, depth+1, maxText); return }
  for (const [key,item] of Object.entries(value)) {
    assert(!['__proto__','prototype','constructor'].includes(key), 'Invalid field')
    validateJson(item, depth+1, maxText)
  }
}
export function validateCommit(value: unknown): WorkspaceCommit {
  validateJson(value)
  assert(value && !Array.isArray(value) && typeof value === 'object', 'Invalid workspace command')
  const command = value as unknown as WorkspaceCommit
  assert(Number.isSafeInteger(command.revision) && command.revision >= 0, 'Invalid revision')
  assert(typeof command.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(command.requestId), 'Invalid request ID')
  assert(Array.isArray(command.put) && Array.isArray(command.remove), 'Invalid changes')
  assert(command.fields && typeof command.fields === 'object' && !Array.isArray(command.fields), 'Invalid workspace fields')
  if (command.fields.profile !== undefined) {
    const profile = command.fields.profile as Data
    assert(profile && typeof profile === 'object' && typeof profile.displayName === 'string' && profile.displayName.trim().length > 0 && profile.displayName.length <= 80, 'Profile name must contain 1–80 characters')
    assert(typeof profile.avatar === 'string' && (!profile.avatar || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(profile.avatar)), 'Invalid profile picture')
  }
  const allowed = new Set<string>([...durableFields,'dateKeys'])
  for(const key of Object.keys(command.fields)) assert(allowed.has(key), `Unknown workspace field ${key}`)
  for (const e of [...command.put, ...command.remove]) {
    assert(['area','task','project','event'].includes(e.kind), 'Invalid entity kind')
    assert(typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 500, 'Invalid entity ID')
  }
  for(const e of command.put) assert(e.data && typeof e.data === 'object' && !Array.isArray(e.data), 'Invalid entity payload')
  assert(JSON.stringify(command).length <= 12000000, 'Workspace change is too large')
  return command
}
export function applyChanges(current: WorkspaceDocument, raw: unknown): WorkspaceDocument {
  const command = validateCommit(raw)
  if (command.revision !== current.revision) throw new WorkspaceConflictError('Workspace changed. Choose which conflicting edits to keep.')
  const entities = new Map(current.entities.map(e=>[`${e.kind}:${e.id}`, e]))
  for(const e of command.remove) entities.delete(`${e.kind}:${e.id}`)
  for(const e of command.put) entities.set(`${e.kind}:${e.id}`,e)
  const result = {revision:current.revision+1, entities:[...entities.values()], fields:command.fields}
  validateDocument(result)
  return result
}
export function validateDocument(doc: WorkspaceDocument) {
  assert(doc.entities.length <= 100000, 'Too many workspace entities')
  const ids = new Set<string>()
  const taskIds = new Set(doc.entities.filter(e=>e.kind==='task').map(e=>e.id))
  for(const e of doc.entities) {
    assert(!ids.has(`${e.kind}:${e.id}`), 'Duplicate entity'); ids.add(`${e.kind}:${e.id}`)
    const content = object(e.data.content)
    assert(typeof content.id === 'string', 'Missing content ID')
    assert(Number.isSafeInteger(e.data.position) && Number(e.data.position)>=0, 'Invalid entity order')
    if(e.kind!=='project') assert(content.id===e.id,'Entity identity mismatch')
    else {
      assert(['weeklyObjectives','archivedObjectives','weekly.accomplishedObjectives'].includes(String(e.data.collection)),'Invalid Project collection')
      assert(e.id===`${e.data.collection}:${content.id}`,'Project identity mismatch')
      assert(Array.isArray(e.data.links),'Invalid Project links')
      for(const link of array(e.data.links)) assert(typeof link.id==='string' && typeof link.taskId==='string' && Array.isArray(link.keys) && link.keys.every(key=>typeof key==='string'),'Invalid task reference')
    }
    if(e.kind==='task' || e.kind==='project') assert(typeof content.title==='string', 'Missing title')
    if(e.kind==='area') assert(typeof content.label==='string' && typeof content.color==='string', 'Invalid Area')
    if(e.kind==='task') {
      assert(typeof e.data.lane==='string' && /^(today$|date:|backlog:|project:)/.test(e.data.lane), 'Invalid task location')
      for(const field of ['minutes','actualMinutes']) if(content[field]!=null) assert(typeof content[field]==='number' && Number.isFinite(content[field]) && Number(content[field])>=0, 'Invalid duration')
      if(content.complete!==undefined) assert(typeof content.complete==='boolean','Invalid task completion')
      if(content.subtasks!==undefined) {
        assert(Array.isArray(content.subtasks),'Invalid subtasks')
        for(const subtask of array(content.subtasks)) {
          assert(typeof subtask.id==='string' && typeof subtask.title==='string' && typeof subtask.complete==='boolean','Invalid subtask')
          for(const field of ['minutes','actualMinutes']) if(subtask[field]!=null) assert(typeof subtask[field]==='number' && Number(subtask[field])>=0,'Invalid subtask duration')
        }
      }
      for(const key of ['comments','activity']) if(content[key]!==undefined) assert(Array.isArray(content[key]),`Invalid ${key}`)
    }
    if(e.kind==='event') {
      assert(typeof content.start==='number' && typeof content.end==='number' && content.start>=0 && content.end>=content.start && content.end<=1440,'Invalid calendar event')
      if(e.data.taskId) assert(taskIds.has(String(e.data.taskId)), 'Calendar references missing task')
    }
    if(e.kind==='project') for(const link of array(e.data.links)) assert(taskIds.has(String(link.taskId)), 'Project references missing task')
  }
}

export function validateSnapshot(document: WorkspaceDocument) {
  validateCommit({ revision: document.revision, requestId: "snapshot", fields: document.fields, put: [], remove: [] })
  for (const entity of document.entities) validateCommit({ revision: document.revision, requestId: "snapshot", fields: {}, put: [entity], remove: [] })
  validateDocument(document)
}

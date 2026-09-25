import type { CalendarSession } from './models'
import type { Entity, WorkspaceDocument } from './workspace-types'
import { taskContent } from './workspace-selectors'
import { editDocument, equalJson } from './workspace-immutable'

export const documentSessions = (document: WorkspaceDocument) =>
  document.entities
    .filter(
      (entity) => entity.kind === 'event' && (entity.data.content as { kind?: string }).kind === 'session',
    )
    .map((entity) => entity.data.content as unknown as CalendarSession)

export const sessionLane = (document: WorkspaceDocument, dateKey: string) =>
  dateKey === document.fields.workspaceDate ? 'today' : `date:${dateKey}`

const laneTasks = (document: WorkspaceDocument, lane: string) =>
  document.entities
    .filter((entity) => entity.kind === 'task' && entity.data.lane === lane)
    .sort((a, b) => Number(a.data.position) - Number(b.data.position))

export function detachSessionMembership(document: WorkspaceDocument, taskId: string, exceptId?: string) {
  for (const session of documentSessions(document)) {
    if (session.id !== exceptId && session.taskIds.includes(taskId))
      session.taskIds = session.taskIds.filter((id) => id !== taskId)
  }
}

/** A session supplies timing; the task retains its own estimate and canonical identity. */
export function placeSessionMembers(
  document: WorkspaceDocument,
  session: CalendarSession,
  ids = session.taskIds,
) {
  const lane = sessionLane(document, session.dateKey)
  for (const id of ids) {
    const entity = document.entities.find((entity) => entity.kind === 'task' && entity.id === id)
    if (!entity) continue
    detachSessionMembership(document, id, session.id)
    if (entity.data.lane !== lane) {
      const previousLane = String(entity.data.lane)
      entity.data.position = laneTasks(document, lane).length
      entity.data.lane = lane
      laneTasks(document, previousLane).forEach((task, position) => {
        task.data.position = position
      })
    }
    if (taskContent(entity).time) taskContent(entity).time = null
    if (document.entities.some((event) => event.kind === 'event' && event.data.taskId === id))
      document.entities = document.entities.filter(
        (event) => event.kind !== 'event' || event.data.taskId !== id,
      )
  }
  if (ids.length && lane !== 'today')
    document.fields.dateKeys = [...new Set([...(document.fields.dateKeys as string[]), session.dateKey])]
}

/** Reconcile only affected days, preserving manual board ordering elsewhere. */
export function reconcileSessionBoards(
  previous: WorkspaceDocument,
  document: WorkspaceDocument,
  lanes = new Set<string>(),
) {
  const before = new Map(documentSessions(previous).map((session) => [session.id, session]))
  const next = documentSessions(document)
  for (const session of next) {
    const old = before.get(session.id)
    if (equalJson(old, session)) continue
    if (!old || old.dateKey !== session.dateKey || !equalJson(old.taskIds, session.taskIds)) {
      for (const task of previous.entities)
        if (task.kind === 'task' && session.taskIds.includes(task.id)) lanes.add(String(task.data.lane))
      placeSessionMembers(document, session)
    }
    lanes.add(sessionLane(document, session.dateKey))
  }
  for (const old of before.values()) {
    if (
      !equalJson(
        old,
        next.find((session) => session.id === old.id),
      )
    )
      lanes.add(sessionLane(document, old.dateKey))
  }
  orderSessionBoardLanes(document, lanes)
}

/** Session rows occupy one chronological group, ordered by the session's references. */
export function orderSessionBoardLanes(document: WorkspaceDocument, lanes?: Set<string>) {
  const sessions = documentSessions(document)
  const allLanes =
    lanes ?? new Set(document.entities.filter((e) => e.kind === 'task').map((e) => String(e.data.lane)))
  for (const lane of allLanes) {
    if (lane !== 'today' && !lane.startsWith('date:')) continue
    const tasks = laneTasks(document, lane)
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const completedPositions = new Map<string, number>()
    const membership = new Map<string, { start: number; group: number; index: number }>()
    sessions.forEach((session, group) => {
      if (sessionLane(document, session.dateKey) !== lane) return
      const isComplete = (id: string) => Boolean(byId.get(id) && taskContent(byId.get(id)!).complete)
      session.taskIds = [
        ...session.taskIds.filter((id) => !isComplete(id)),
        ...session.taskIds.filter(isComplete),
      ]
      // Keep completed tasks in the board's completed section while mirroring manual session order.
      const completedIds = session.taskIds.filter(isComplete)
      const slots = completedIds.map((id) => Number(byId.get(id)!.data.position)).sort((a, b) => a - b)
      completedIds.forEach((id, index) => completedPositions.set(id, slots[index]!))
      session.taskIds.forEach((id, index) => {
        if (!membership.has(id)) membership.set(id, { start: session.start, group, index })
      })
    })
    const timing = (entity: Entity) => {
      const member = membership.get(entity.id)
      if (member) return member.start
      const task = taskContent(entity)
      if (task.complete) return Infinity
      const match = /^(\d{1,2}):(\d{2})$/.exec(task.time || '')
      return match ? Number(match[1]) * 60 + Number(match[2]) : Infinity
    }
    tasks.sort((a, b) => {
      const firstComplete = Boolean(taskContent(a).complete)
      const secondComplete = Boolean(taskContent(b).complete)
      if (firstComplete !== secondComplete) return Number(firstComplete) - Number(secondComplete)
      if (firstComplete)
        return (
          (completedPositions.get(a.id) ?? Number(a.data.position)) -
          (completedPositions.get(b.id) ?? Number(b.data.position))
        )
      const first = membership.get(a.id),
        second = membership.get(b.id)
      const timeDifference = timing(a) - timing(b)
      if (timeDifference) return timeDifference
      if (first && second) return first.group - second.group || first.index - second.index
      if (first || second) return first ? -1 : 1
      const completeDifference =
        Number(Boolean(taskContent(a).complete)) - Number(Boolean(taskContent(b).complete))
      return completeDifference || Number(a.data.position) - Number(b.data.position)
    })
    tasks.forEach((entity, position) => {
      entity.data.position = position
    })
  }
}

/** Run on drop, after reversible board previews, so crossing a group during a drag cannot unlink early. */
export function commitBoardSessionOrder(input: WorkspaceDocument, taskId: string, sourceDateKey: string) {
  return editDocument(input, (document) => {
    const task = document.entities.find((entity) => entity.kind === 'task' && entity.id === taskId)
    if (!task) return
    const lane = String(task.data.lane)
    const tasks = laneTasks(document, lane)
    const index = tasks.findIndex((entity) => entity.id === taskId)
    const ranks = new Map(tasks.map((entity, position) => [entity.id, position]))
    let changed = false
    for (const session of documentSessions(document)) {
      if (!session.taskIds.includes(taskId)) continue
      changed = true
      const adjacent = [tasks[index - 1], tasks[index + 1]].some(
        (entity) => entity && session.taskIds.includes(entity.id),
      )
      if (
        lane !== sessionLane(document, sourceDateKey) ||
        lane !== sessionLane(document, session.dateKey) ||
        !adjacent
      ) {
        session.taskIds = session.taskIds.filter((id) => id !== taskId)
      } else {
        session.taskIds.sort((a, b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity))
      }
    }
    if (changed) orderSessionBoardLanes(document, new Set([lane, sessionLane(document, sourceDateKey)]))
  })
}

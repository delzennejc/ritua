import type { Task } from './models'
import type { Data, WorkspaceDocument } from './workspace-types'
import { editDocument } from './workspace-immutable'
import { taskContent } from './workspace-selectors'
import { addDays, localDateKey } from './calendar-dates'
import { detachSessionMembership, orderSessionBoardLanes } from './session-board-order'

export type DailySelection = {
  taskIds: string[]
  highlightId: string | null
  availableTaskIds?: string[]
  anytimeTaskIds?: string[]
}

/** Read canonical tasks once; project references never duplicate the review or picker. */
export function dailyPlanningTasks(document: WorkspaceDocument, today = localDateKey()) {
  const yesterday = addDays(today, -1)
  const activeProjects = new Set(
    document.entities
      .filter((entity) => entity.kind === 'project' && entity.data.collection === 'weeklyObjectives')
      .map((entity) => entity.id),
  )
  const completed: Task[] = []
  const candidates: { task: Task; source: string }[] = []
  const todayIds: string[] = []
  const groups = document.fields.backlogGroups as Data[]
  const draft = document.fields['daily.selection'] as DailySelection | null | undefined
  const anytimeIds = new Set(draft?.anytimeTaskIds ?? [])
  for (const entity of [...document.entities].sort(
    (a, b) => Number(a.data.position) - Number(b.data.position),
  )) {
    if (entity.kind !== 'task') continue
    const task = taskContent(entity)
    if (task.complete && task.completedDateKey === yesterday) completed.push(task)
    if (task.complete) continue
    const lane = String(entity.data.lane)
    if (lane === 'today') {
      todayIds.push(task.id)
      candidates.push({ task, source: 'Anytime' })
    } else if (lane.startsWith('date:') && lane.slice(5) < today) {
      candidates.push({
        task,
        source: lane.slice(5) === yesterday ? 'Unfinished from yesterday' : `Unfinished · ${lane.slice(5)}`,
      })
    } else if (lane.startsWith('backlog:')) {
      candidates.push({
        task,
        source: String(groups.find((group) => `backlog:${group.id}` === lane)?.label ?? 'Anytime'),
      })
    } else if (lane.startsWith('project:') && activeProjects.has(lane.slice(8))) {
      candidates.push({ task, source: 'Project task' })
    }
  }
  for (const candidate of candidates) {
    if (anytimeIds.has(candidate.task.id)) candidate.source = 'Anytime'
  }
  const ranks = new Map((draft?.availableTaskIds ?? []).map((id, index) => [id, index]))
  candidates.sort((a, b) => (ranks.get(a.task.id) ?? Infinity) - (ranks.get(b.task.id) ?? Infinity))
  return { completed, candidates, todayIds }
}

/** Saved choices may outlive a deleted task so Undo can restore them; render only live candidates. */
export function dailySelection(document: WorkspaceDocument, today = localDateKey()): DailySelection {
  const { candidates, todayIds } = dailyPlanningTasks(document, today)
  const draft = document.fields['daily.selection'] as DailySelection | null | undefined
  const available = new Set(candidates.map(({ task }) => task.id))
  const taskIds = (draft?.taskIds ?? todayIds).filter((id) => available.has(id))
  const highlightId = draft
    ? draft.highlightId
    : ((document.fields['daily.highlightTaskId'] as string | null) ?? null)
  return { taskIds, highlightId: highlightId && taskIds.includes(highlightId) ? highlightId : null }
}

/** Task location, calendar effects, highlight and ritual completion publish as one atomic edit. */
export function finishDailyPlan(input: WorkspaceDocument, selection: DailySelection, today = localDateKey()) {
  if (input.fields.workspaceDate !== today) throw new Error('The day changed. Reopen Daily planning.')
  const available = new Set(dailyPlanningTasks(input, today).candidates.map(({ task }) => task.id))
  const selected = new Set(selection.taskIds)
  const draft = input.fields['daily.selection'] as DailySelection | null | undefined
  const anytimeIds = new Set(draft?.anytimeTaskIds ?? [])
  if (selected.size !== selection.taskIds.length || selection.taskIds.some((id) => !available.has(id)))
    throw new Error('Your tasks changed. Review the selection before starting your day.')
  if (
    selected.size
      ? !selection.highlightId || !selected.has(selection.highlightId)
      : selection.highlightId !== null
  )
    throw new Error('Choose one daily highlight from your selected tasks.')
  return editDocument(input, (document) => {
    const groups = document.fields.backlogGroups as Data[]
    const backlog = groups.find((group) => group.id === 'anytime') ?? groups[0]
    const tasks = document.entities.filter((entity) => entity.kind === 'task')
    const removed = new Set<string>()
    for (const entity of tasks) {
      const task = taskContent(entity)
      if (task.complete) continue
      if (selected.has(entity.id) && entity.data.lane !== 'today') {
        detachSessionMembership(document, entity.id)
        entity.data.lane = 'today'
        task.time = null
      } else if (
        (entity.data.lane === 'today' || (anytimeIds.has(entity.id) && available.has(entity.id))) &&
        !selected.has(entity.id)
      ) {
        if (!backlog) throw new Error('Create an Anytime list before removing today’s tasks.')
        detachSessionMembership(document, entity.id)
        entity.data.lane = `backlog:${backlog.id}`
        task.time = null
        removed.add(entity.id)
      }
    }
    // Keep historical blocks. Only today's discarded reservations are removed.
    document.entities = document.entities.filter(
      (entity) =>
        entity.kind !== 'event' ||
        !removed.has(String(entity.data.taskId)) ||
        ((entity.data.content as Data).dateKey || today) !== today,
    )
    const ranks = new Map(selection.taskIds.map((id, index) => [id, index]))
    const availableRanks = new Map((draft?.availableTaskIds ?? []).map((id, index) => [id, index]))
    const lanes = new Map<string, typeof tasks>()
    for (const task of tasks) {
      const lane = String(task.data.lane)
      if (!lanes.has(lane)) lanes.set(lane, [])
      lanes.get(lane)!.push(task)
    }
    for (const [lane, members] of lanes) {
      members.sort((a, b) =>
        lane === 'today'
          ? (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
            Number(a.data.position) - Number(b.data.position)
          : lane === `backlog:${backlog?.id}`
            ? (availableRanks.get(a.id) ?? Infinity) - (availableRanks.get(b.id) ?? Infinity) ||
              Number(a.data.position) - Number(b.data.position)
            : Number(a.data.position) - Number(b.data.position),
      )
      members.forEach((entity, index) => {
        entity.data.position = index
      })
    }
    orderSessionBoardLanes(document, new Set(['today']))
    document.fields['daily.highlightTaskId'] = selection.highlightId
    document.fields['daily.selection'] = null
    document.fields['daily.completedDate'] = today
    document.fields.planningStep = 0
    document.fields.view = 'today'
  })
}

export function changeDailyHighlight(input: WorkspaceDocument, taskId: string | null) {
  if (
    taskId &&
    !input.entities.some(
      (entity) => entity.kind === 'task' && entity.id === taskId && entity.data.lane === 'today',
    )
  )
    throw new Error('Choose a task planned for today.')
  return editDocument(input, (document) => {
    document.fields['daily.highlightTaskId'] = taskId
  })
}

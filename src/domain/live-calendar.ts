import { normalize, project, type Data, type Fields, type WorkspaceDocument } from './workspace'

import { localDateKey, mondayOf } from './calendar-dates'
export * from './calendar-dates'
import { extendRecurrences } from './recurring-workspace'

// Retain historical date assignments; a new day never silently reschedules unfinished work.
export function rollWorkspaceDate(document: WorkspaceDocument, today = localDateKey()): WorkspaceDocument {
  const fields = project(document)
  const previous = typeof fields.workspaceDate === 'string' ? fields.workspaceDate : today
  if (previous === today) return extendRecurrences({ ...document, fields: { ...document.fields, workspaceDate: today } }, today)
  const dates = fields.datedTasksByDate as Record<string, Data[]>
  dates[previous] = [...(dates[previous] ?? []), ...(fields.tasks as Data[])]
  fields.tasks = dates[today] ?? []
  delete dates[today]
  fields.events = (fields.events as Data[]).map(event => ({ ...event, dateKey: event.dateKey || previous }))
  const history = (fields.ritualHistory ?? {}) as Data
  const daily: Data = {}
  for (const key of ['daily.planText', 'daily.shutdownTime', 'daily.yesterdayTaskIdsByLane', 'planningStep']) {
    if (fields[key] !== undefined) daily[key] = fields[key]!
    delete fields[key]
  }
  history[previous] = { ...((history[previous] ?? {}) as Data), daily }
  if (mondayOf(previous) !== mondayOf(today)) {
    const weekly: Data = {}
    for (const key of ['weekly.reviewText', 'weekly.planText', 'weekly.accomplishedObjectives', 'weeklyStep']) {
      if (fields[key] !== undefined) weekly[key] = fields[key]!
      delete fields[key]
    }
    history[mondayOf(previous)] = { ...((history[mondayOf(previous)] ?? {}) as Data), weekly }
  }
  // Restore already-written ritual drafts when travelling back across a local date boundary.
  const savedDay = history[today] as Data | undefined
  const savedWeek = history[mondayOf(today)] as Data | undefined
  Object.assign(fields, (savedDay?.daily ?? {}) as Fields, (savedWeek?.weekly ?? {}) as Fields)
  fields.ritualHistory = history
  fields.workspaceDate = today
  return extendRecurrences(normalize(fields, document.revision), today)
}

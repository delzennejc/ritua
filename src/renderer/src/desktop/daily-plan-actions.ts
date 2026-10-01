import {
  changeDailyReviewTask,
  completeDailyReview,
  dailyReviewTasks,
  type DailyReviewMove,
} from '../../../domain/daily-review'
import { publishTaskChange } from './today-status-actions'
import { changeDailyHighlight, finishDailyPlan, type DailySelection } from '../../../domain/daily-plan'
import { getWorkspaceDocument, replaceWorkspaceDocument } from './workspace-store'
import { activityContext } from './activity-context'
import { isDayReviewed, setDayReviewed } from '../../../domain/day-review'

export function startPlannedDay(selection: DailySelection) {
  replaceWorkspaceDocument(finishDailyPlan(getWorkspaceDocument(), selection))
}
export function finishYesterdayReview() {
  replaceWorkspaceDocument(completeDailyReview(getWorkspaceDocument()))
}
export function togglePastDayReview(dateKey: string) {
  const document = getWorkspaceDocument()
  const reviewed = !isDayReviewed(document, dateKey)
  replaceWorkspaceDocument(setDayReviewed(document, dateKey, reviewed))
  return reviewed
}
export function setDailyHighlight(taskId: string | null) {
  replaceWorkspaceDocument(changeDailyHighlight(getWorkspaceDocument(), taskId))
}
export function updateDailyReviewTask(move: DailyReviewMove) {
  const before = getWorkspaceDocument()
  const after = changeDailyReviewTask(before, move, activityContext())
  return publishTaskChange(before, after, move.taskId, 'Yesterday’s review updated.')
}

export function toggleTaskInDailyReview(taskId: string) {
  const document = getWorkspaceDocument()
  if (document.fields.view !== 'planning' || Number(document.fields.planningStep || 0) !== 0) return false
  const task = dailyReviewTasks(document).find((item) => item.id === taskId)
  if (!task) return false
  updateDailyReviewTask({ taskId, complete: !task.complete })
  return true
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { isDayReviewed, markDayReviewed, setDayReviewed } from '../domain/day-review'
import { completeDailyReview, dailyReviewCompleted } from '../domain/daily-review'
import { rollWorkspaceDate } from '../domain/live-calendar'
import { emptyWorkspace } from '../domain/production-workspace'
import { applyChanges, changes, normalize, project, type Data } from '../domain/workspace'
import { projectTaskProgress } from '../renderer/src/app/components/ProjectProgressCircle'

const today = '2026-09-29'
test('manual day reviews preserve current planning and archived drafts and survive save, rollover and date travel', () => {
  const initial = normalize({
    ...project(emptyWorkspace(today)),
    view: 'home',
    planningStep: 0,
    'daily.selection': { taskIds: ['task'], highlightId: 'task' },
    tasks: [{ id: 'task', title: 'Current plan', complete: false }],
    datedTasksByDate: {
      '2026-09-23': [{ id: 'finished', title: 'Already done', complete: true }],
    },
    ritualHistory: {
      '2026-09-24': { daily: { 'daily.planText': 'Keep this draft' }, weekly: { note: 'Keep this too' } },
    },
  })
  assert.equal(isDayReviewed(initial, '2026-09-23'), false, 'Completed tasks do not imply a reviewed day')
  const checked = markDayReviewed(initial, '2026-09-23', today)
  const saved = applyChanges(initial, changes(initial, checked, 'manual-review'))
  assert.equal(isDayReviewed(saved, '2026-09-23'), true)
  assert.deepEqual(saved.entities, initial.entities)
  assert.equal(saved.fields.view, 'home')
  assert.equal(saved.fields.planningStep, 0)
  assert.deepEqual(saved.fields['daily.selection'], initial.fields['daily.selection'])
  const history = saved.fields.ritualHistory as Data
  assert.deepEqual(history['2026-09-24'], {
    daily: { 'daily.planText': 'Keep this draft', 'daily.reviewedDate': '2026-09-23' },
    weekly: { note: 'Keep this too' },
  })
  assert.equal(markDayReviewed(saved, '2026-09-23', today), saved, 'Rechecking never clears review status')
  const yesterday = markDayReviewed(saved, '2026-09-28', today)
  assert.equal(dailyReviewCompleted(yesterday, today), true, 'Home and Yesterday share completion')
  assert.equal(yesterday.fields.planningStep, 0, 'Manual checking stays on Home')
  assert.equal(completeDailyReview(yesterday, today).fields.planningStep, 1)
  const another = markDayReviewed(yesterday, '2026-09-25', today)
  const tomorrow = rollWorkspaceDate(another, '2026-09-30')
  const reopened = normalize(project(tomorrow))
  for (const dateKey of ['2026-09-23', '2026-09-25', '2026-09-28'])
    assert.equal(isDayReviewed(reopened, dateKey), true, 'Each reviewed day retains its own status')
  assert.equal(isDayReviewed(reopened, today), false)
  const back = rollWorkspaceDate(reopened, '2026-09-24')
  assert.equal(dailyReviewCompleted(back, '2026-09-24'), true)
  const forward = rollWorkspaceDate(back, '2026-09-30')
  assert.equal(isDayReviewed(forward, '2026-09-23'), true)
  assert.equal(isDayReviewed(forward, '2026-09-28'), true)
})

test('unchecking clears active and archived reviews without losing drafts and stays unchecked after date travel', () => {
  const initial = normalize({
    ...project(emptyWorkspace(today)),
    view: 'home',
    planningStep: 1,
    'daily.reviewedDate': '2026-09-28',
    'daily.selection': { taskIds: [], highlightId: null },
    ritualHistory: {
      [today]: { daily: { 'daily.reviewedDate': '2026-09-28', 'daily.planText': 'Active draft' } },
      '2026-09-24': {
        daily: { 'daily.reviewedDate': '2026-09-23', 'daily.planText': 'Older draft' },
        weekly: { note: 'Weekly draft' },
      },
      '2026-09-26': { daily: { 'daily.reviewedDate': '2026-09-25' } },
    },
  })
  const uncheckedYesterday = setDayReviewed(initial, '2026-09-28', false, today)
  assert.equal(dailyReviewCompleted(uncheckedYesterday, today), false)
  assert.equal(uncheckedYesterday.fields['daily.reviewedDate'], undefined)
  assert.deepEqual((uncheckedYesterday.fields.ritualHistory as Data)[today], {
    daily: { 'daily.planText': 'Active draft' },
  })
  const unchecked = setDayReviewed(uncheckedYesterday, '2026-09-23', false, today)
  const saved = applyChanges(initial, changes(initial, unchecked, 'uncheck-reviews'))
  assert.equal(isDayReviewed(saved, '2026-09-23'), false)
  assert.equal(isDayReviewed(saved, '2026-09-25'), true, 'Other days retain their review status')
  assert.deepEqual((saved.fields.ritualHistory as Data)['2026-09-24'], {
    daily: { 'daily.planText': 'Older draft' },
    weekly: { note: 'Weekly draft' },
  })
  assert.deepEqual(saved.entities, initial.entities)
  assert.equal(saved.fields.view, 'home')
  assert.equal(saved.fields.planningStep, 1)
  assert.deepEqual(saved.fields['daily.selection'], initial.fields['daily.selection'])
  assert.equal(setDayReviewed(saved, '2026-09-23', false, today), saved)
  const reopened = normalize(project(rollWorkspaceDate(saved, '2026-09-30')))
  const back = rollWorkspaceDate(reopened, '2026-09-24')
  assert.equal(dailyReviewCompleted(back, '2026-09-24'), false)
  const forward = rollWorkspaceDate(back, today)
  assert.equal(
    dailyReviewCompleted(forward, today),
    false,
    'An archived duplicate cannot restore a cleared review',
  )
  assert.equal(isDayReviewed(forward, '2026-09-25'), true)
  assert.equal(
    dailyReviewCompleted(completeDailyReview(forward, today), today),
    true,
    'Yesterday can be reviewed again',
  )
})

test('day review commands and archived review records reject invalid or future dates', () => {
  const initial = emptyWorkspace(today)
  for (const dateKey of [today, '2026-09-30', '2026-02-30', '2026-09-32', 'yesterday']) {
    assert.throws(() => markDayReviewed(initial, dateKey, today), /Choose a past day/)
    assert.throws(() => setDayReviewed(initial, dateKey, false, today), /Choose a past day/)
  }
  assert.throws(() => markDayReviewed(initial, '2026-09-23', '2026-09-30'), /The day changed/)
  assert.throws(() => setDayReviewed(initial, '2026-09-23', false, '2026-09-30'), /The day changed/)
  for (const reviewedDate of [true, 42, [], '2026-02-30', '2026-09-22']) {
    const invalid = {
      ...initial,
      fields: {
        ...initial.fields,
        ritualHistory: { '2026-09-24': { daily: { 'daily.reviewedDate': reviewedDate } } },
      },
    }
    assert.throws(
      () => applyChanges(initial, changes(initial, invalid, 'bad-review')),
      /Invalid daily review date/,
    )
  }
})

test('today progress is empty with no tasks and only complete when a populated day is finished', () => {
  assert.deepEqual(projectTaskProgress([]), {
    taskCount: 0,
    completedTaskCount: 0,
    isComplete: false,
    progress: 0,
  })
  const tasks = [{ complete: true }, { complete: false }]
  assert.equal(projectTaskProgress(tasks).progress, 0.5)
  assert.equal(projectTaskProgress(tasks).isComplete, false)
  assert.equal(projectTaskProgress(tasks.map(() => ({ complete: true }))).isComplete, true)
})

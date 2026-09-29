import {
  dailyReviewTasks,
  dailyReviewTimeData,
  dailyReviewActivity,
  changeDailyReviewTask,
} from '../domain/daily-review'
import { taskTimeTotals } from '../domain/task-time'
import { createTodayStatusUndo, undoTodayStatus } from '../domain/today-board-undo'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dailyPlanningTasks,
  dailySelection,
  finishDailyPlan,
  changeDailyHighlight,
} from '../domain/daily-plan'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, applyChanges, changes, validateDocument, type Data } from '../domain/workspace'
import { rollWorkspaceDate } from '../domain/live-calendar'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from '../domain/task-deletion'

const reviewContext = { now: new Date(2026, 8, 29, 11, 45), actor: 'Test' }
const today = '2026-09-29',
  yesterday = '2026-09-28'
const task = (id: string, extra: Data = {}) => ({ id, title: id, complete: false, channel: 'Work', ...extra })
test('yesterday time includes recorded work and all session members without estimates or other dates', () => {
  const doc = normalize({
    ...project(emptyWorkspace(today)),
    tasks: [task('session-member', { actualMinutes: 300 }), task('today-only', { actualMinutes: 90 })],
    datedTasksByDate: {
      [yesterday]: [
        task('recorded', { actualMinutes: 25 }),
        task('estimated', { minutes: 180 }),
        task('completed-today', { complete: true, completedDateKey: today, actualMinutes: 60 }),
      ],
      '2026-09-20': [task('finished', { complete: true, completedDateKey: yesterday, actualMinutes: 45 })],
    },
    events: [
      {
        id: 'session',
        kind: 'session',
        title: 'Focus',
        dateKey: yesterday,
        start: 600,
        end: 660,
        taskIds: ['session-member'],
      },
      {
        id: 'empty',
        kind: 'session',
        title: 'Meeting',
        dateKey: yesterday,
        start: 700,
        end: 730,
        taskIds: [],
      },
      {
        id: 'today-session',
        kind: 'session',
        title: 'Today',
        dateKey: today,
        start: 600,
        end: 900,
        taskIds: [],
      },
    ],
  })
  const before = structuredClone(doc)
  const data = dailyReviewTimeData(doc, today)
  assert.deepEqual(
    new Set(data.tasks.map((item) => item.id)),
    new Set(['recorded', 'estimated', 'finished', 'session-member']),
  )
  assert.equal(taskTimeTotals(data.tasks, data.events, { dateKeys: data.dateKeys }).actual, 160)
  assert.equal(
    taskTimeTotals(data.tasks, data.events, { dateKeys: data.dateKeys, includeEmptySessions: false }).actual,
    130,
  )
  assert.deepEqual(doc, before)
  const activity = dailyReviewActivity(doc, today)
  assert.equal(activity.length, 183)
  assert.equal(activity[0]?.dateKey, '2026-03-30')
  assert.deepEqual(activity.at(-1), {
    dateKey: yesterday,
    taskCount: 3,
    minutes: 160,
    mostLoggedArea: 'Work',
    areaBreakdown: [
      { area: 'Work', taskCount: 3, minutes: 130 },
      { area: null, taskCount: 0, minutes: 30 },
    ],
  })
  assert.deepEqual(
    activity.find((day) => day.dateKey === '2026-09-20'),
    {
      dateKey: '2026-09-20',
      taskCount: 0,
      minutes: 0,
      mostLoggedArea: null,
      areaBreakdown: [],
    },
  )
  assert.ok(activity.slice(0, -1).every((day) => day.minutes === 0 && day.taskCount === 0))
  const empty = dailyReviewTimeData(emptyWorkspace(today), today)
  assert.equal(taskTimeTotals(empty.tasks, empty.events, { dateKeys: empty.dateKeys }).actual, 0)
})
test('six-month activity starts with a full Monday week across month ends and leap years', () => {
  const monthEnd = dailyReviewActivity(emptyWorkspace('2026-08-31'), '2026-08-31')
  assert.equal(monthEnd[0]?.dateKey, '2026-03-02')
  assert.equal(monthEnd.at(-1)?.dateKey, '2026-08-30')
  const leapYear = dailyReviewActivity(emptyWorkspace('2024-08-31'), '2024-08-31')
  assert.equal(leapYear[0]?.dateKey, '2024-03-04')
  assert.equal(new Set(leapYear.map((day) => day.dateKey)).size, leapYear.length)
  const mondayStart = dailyReviewActivity(emptyWorkspace('2024-08-26'), '2024-08-26')
  assert.equal(mondayStart[0]?.dateKey, '2024-02-26')
  assert.ok(mondayStart.some((day) => day.dateKey === '2024-02-29'))
})

test('activity color follows logged area minutes, including shared sessions, not task counts or estimates', () => {
  const doc = normalize({
    ...project(emptyWorkspace(today)),
    datedTasksByDate: {
      [yesterday]: [
        task('work-a', { actualMinutes: 20, minutes: 600 }),
        task('work-b', { actualMinutes: 20 }),
        task('work-session', { actualMinutes: 999 }),
        task('personal-session', { channel: 'Personal', actualMinutes: 999 }),
        task('personal-extra', { channel: 'Personal', actualMinutes: 45 }),
      ],
    },
    events: [
      {
        id: 'shared',
        kind: 'session',
        title: 'Shared',
        dateKey: yesterday,
        start: 600,
        end: 660,
        taskIds: ['work-session', 'personal-session'],
      },
      {
        id: 'unassigned',
        kind: 'session',
        title: 'Unassigned',
        dateKey: yesterday,
        start: 700,
        end: 1000,
        taskIds: [],
      },
    ],
  })
  assert.equal(dailyReviewActivity(doc, today).at(-1)?.mostLoggedArea, 'Personal')
  assert.deepEqual(dailyReviewActivity(doc, today).at(-1)?.areaBreakdown, [
    { area: null, taskCount: 0, minutes: 300 },
    { area: 'Personal', taskCount: 2, minutes: 75 },
    { area: 'Work', taskCount: 3, minutes: 70 },
  ])
  const personal = doc.entities.find((entity) => entity.id === 'personal-extra')!
  ;(personal.data.content as Data).actualMinutes = 0
  assert.equal(dailyReviewActivity(doc, today).at(-1)?.mostLoggedArea, 'Work')
})

function fixture() {
  return normalize({
    ...project(emptyWorkspace(today)),
    tasks: [
      task('keep'),
      task('remove', { time: '10:00' }),
      task('already-done', { complete: true, completedDateKey: today }),
    ],
    datedTasksByDate: {
      [yesterday]: [
        task('unfinished'),
        task('leave-behind'),
        task('actually-today', { complete: true, completedDateKey: today }),
      ],
      '2026-09-20': [task('finished-yesterday', { complete: true, completedDateKey: yesterday })],
      '2026-09-30': [task('future')],
    },
    backlogGroups: [{ id: 'anytime', label: 'Anytime', items: [task('backlog')] }],
    events: [
      { id: 'remove', dateKey: today, start: 600, end: 630 },
      { id: 'remove-history', taskId: 'remove', dateKey: yesterday, start: 600, end: 630 },
      { id: 'unfinished', dateKey: yesterday, start: 660, end: 690 },
      {
        id: 'old-session',
        kind: 'session',
        title: 'Yesterday',
        dateKey: yesterday,
        start: 600,
        end: 720,
        taskIds: ['unfinished', 'leave-behind'],
      },
      {
        id: 'today-session',
        kind: 'session',
        title: 'Today',
        dateKey: today,
        start: 600,
        end: 720,
        taskIds: ['keep', 'remove'],
      },
    ],
  })
}

test('daily review uses actual completion dates and selection uses canonical eligible work', () => {
  const doc = fixture()
  assert.deepEqual(
    dailyPlanningTasks(doc, today).completed.map((t) => t.id),
    ['finished-yesterday'],
  )
  assert.deepEqual(dailySelection(doc, today), { taskIds: ['keep', 'remove'], highlightId: null })
  assert.ok(!dailyPlanningTasks(doc, today).candidates.some(({ task }) => task.id === 'future'))
})
test('starting a day saves selected tasks and highlight atomically while preserving history', () => {
  const doc = fixture(),
    before = structuredClone(doc)
  const next = finishDailyPlan(
    doc,
    { taskIds: ['keep', 'unfinished', 'backlog'], highlightId: 'backlog' },
    today,
  )
  const saved = applyChanges(doc, changes(doc, next, 'plan-day'))
  validateDocument(saved)
  assert.deepEqual(doc, before)
  const lane = (id: string) => saved.entities.find((e) => e.id === id && e.kind === 'task')!.data.lane
  assert.equal(lane('unfinished'), 'today')
  assert.equal(lane('leave-behind'), `date:${yesterday}`)
  assert.equal(lane('backlog'), 'today')
  assert.equal(lane('remove'), 'backlog:anytime')
  assert.equal(lane('already-done'), 'today')
  assert.ok(!saved.entities.some((e) => e.kind === 'event' && e.id === 'remove'))
  assert.ok(saved.entities.some((e) => e.id === 'remove-history'))
  assert.ok(saved.entities.some((e) => e.kind === 'event' && e.id === 'unfinished'))
  assert.deepEqual((saved.entities.find((e) => e.id === 'old-session')!.data.content as Data).taskIds, [
    'leave-behind',
  ])
  assert.deepEqual((saved.entities.find((e) => e.id === 'today-session')!.data.content as Data).taskIds, [
    'keep',
  ])
  assert.equal(saved.fields.view, 'today')
  assert.equal(saved.fields['daily.highlightTaskId'], 'backlog')
  assert.equal(saved.fields['daily.completedDate'], today)
  assert.equal(saved.fields['daily.selection'], null)
})
test('invalid or stale selections cannot partially finish the ritual', () => {
  const doc = fixture(),
    before = structuredClone(doc)
  for (const selection of [
    { taskIds: ['missing'], highlightId: 'missing' },
    { taskIds: ['keep'], highlightId: 'remove' },
    { taskIds: ['keep'], highlightId: null },
    { taskIds: ['keep', 'keep'], highlightId: 'keep' },
  ])
    assert.throws(() => finishDailyPlan(doc, selection, today))
  assert.throws(() => finishDailyPlan(doc, { taskIds: [], highlightId: null }, yesterday))
  assert.deepEqual(doc, before)
  assert.equal(
    finishDailyPlan(emptyWorkspace(today), { taskIds: [], highlightId: null }, today).fields.view,
    'today',
  )
})
test('drafts survive serialization, task deletion and Undo; rollover starts a fresh ritual', () => {
  const initial = fixture()
  const draft = {
    ...initial,
    fields: {
      ...initial.fields,
      'daily.selection': { taskIds: ['keep', 'backlog'], highlightId: 'backlog' },
      'daily.highlightTaskId': 'keep',
    },
  }
  const saved = applyChanges(initial, changes(initial, draft, 'save-draft'))
  assert.deepEqual(dailySelection(saved, today), draft.fields['daily.selection'])
  const deleted = deleteWorkspaceTask(saved, 'backlog')
  assert.deepEqual(dailySelection(deleted.document, today), { taskIds: ['keep'], highlightId: null })
  assert.deepEqual(
    dailySelection(undoWorkspaceTaskDeletion(deleted.document, deleted.undo), today),
    draft.fields['daily.selection'],
  )
  const tomorrow = rollWorkspaceDate(saved, '2026-09-30')
  assert.equal(tomorrow.fields['daily.selection'], undefined)
  assert.equal(tomorrow.fields['daily.highlightTaskId'], undefined)
  assert.equal(changeDailyHighlight(saved, 'keep').fields['daily.highlightTaskId'], 'keep')
  assert.throws(() => changeDailyHighlight(saved, 'backlog'))
  assert.throws(() =>
    validateDocument({
      ...saved,
      fields: { ...saved.fields, 'daily.selection': { taskIds: ['keep'], highlightId: 'missing' } },
    }),
  )
})

test('available planning order is durable without moving canonical tasks', () => {
  const initial = fixture()
  const draft = {
    ...initial,
    fields: {
      ...initial.fields,
      'daily.selection': {
        taskIds: ['keep'],
        highlightId: 'keep',
        availableTaskIds: ['leave-behind', 'unfinished', 'backlog', 'deleted-task'],
      },
    },
  }
  const saved = applyChanges(initial, changes(initial, draft, 'reorder-available'))
  assert.deepEqual(saved.entities, initial.entities)
  assert.deepEqual(
    dailyPlanningTasks(saved, today)
      .candidates.slice(0, 3)
      .map(({ task }) => task.id),
    ['leave-behind', 'unfinished', 'backlog'],
  )
  for (const availableTaskIds of [['unfinished', 'unfinished'], [42], 'unfinished']) {
    assert.throws(
      () =>
        validateDocument({
          ...saved,
          fields: {
            ...saved.fields,
            'daily.selection': { ...draft.fields['daily.selection'], availableTaskIds },
          },
        }),
      /Invalid daily available task order/,
    )
  }
})

test('tasks returned from the plan appear atop Anytime and finish there atomically', () => {
  const initial = fixture()
  const draft = {
    ...initial,
    fields: {
      ...initial.fields,
      'daily.selection': {
        taskIds: ['keep'],
        highlightId: 'keep',
        availableTaskIds: ['unfinished', 'remove', 'backlog'],
        anytimeTaskIds: ['unfinished', 'remove'],
      },
    },
  }
  const saved = applyChanges(initial, changes(initial, draft, 'return-to-anytime'))
  assert.deepEqual(saved.entities, initial.entities)
  const candidates = dailyPlanningTasks(saved, today).candidates
  assert.deepEqual(
    candidates
      .filter(({ source }) => source === 'Anytime')
      .slice(0, 3)
      .map(({ task }) => task.id),
    ['unfinished', 'remove', 'backlog'],
  )
  assert.ok(!candidates.some(({ source }) => source === 'Already planned for today'))
  const finished = finishDailyPlan(saved, dailySelection(saved, today), today)
  const backlog = finished.entities
    .filter((e) => e.kind === 'task' && e.data.lane === 'backlog:anytime')
    .sort((a, b) => Number(a.data.position) - Number(b.data.position))
  assert.deepEqual(
    backlog.map((e) => e.id),
    ['unfinished', 'remove', 'backlog'],
  )
  assert.equal(finished.entities.find((e) => e.id === 'keep')?.data.lane, 'today')
  assert.equal(finished.entities.find((e) => e.id === 'leave-behind')?.data.lane, `date:${yesterday}`)
  validateDocument(finished)
  const reselected = finishDailyPlan(
    saved,
    { taskIds: ['keep', 'unfinished'], highlightId: 'unfinished' },
    today,
  )
  assert.equal(
    reselected.entities.find((e) => e.kind === 'task' && e.id === 'unfinished')?.data.lane,
    'today',
  )
  for (const anytimeTaskIds of [['remove', 'remove'], [42], 'remove']) {
    assert.throws(
      () =>
        validateDocument({
          ...saved,
          fields: {
            ...saved.fields,
            'daily.selection': { ...draft.fields['daily.selection'], anytimeTaskIds },
          },
        }),
      /Invalid daily Anytime tasks/,
    )
  }
})

test('yesterday review includes unfinished work and retrospective completion preserves the calendar', () => {
  const before = fixture()
  assert.deepEqual(
    new Set(dailyReviewTasks(before, today).map((t) => t.id)),
    new Set(['unfinished', 'leave-behind', 'finished-yesterday']),
  )
  const next = changeDailyReviewTask(before, { taskId: 'unfinished', complete: true }, reviewContext)
  validateDocument(next)
  const completed = next.entities.find((e) => e.kind === 'task' && e.id === 'unfinished')!
  assert.equal(completed.data.lane, `date:${yesterday}`)
  assert.equal((completed.data.content as Data).completedDateKey, yesterday)
  assert.equal((completed.data.content as Data).completedAtMinute, null)
  const calendar = (doc: typeof before) =>
    doc.entities
      .filter((e) => e.kind === 'event')
      .map((e) => ({
        ...e,
        data: {
          ...e.data,
          content: {
            ...(e.data.content as Data),
            ...((e.data.content as Data).taskIds
              ? { taskIds: [...((e.data.content as Data).taskIds as string[])].sort() }
              : {}),
          },
        },
      }))
  assert.deepEqual(calendar(next), calendar(before))
  assert.ok(!dailyPlanningTasks(next, today).candidates.some(({ task }) => task.id === 'unfinished'))
  const saved = applyChanges(before, changes(before, next, 'review-completion'))
  assert.equal(dailyReviewTasks(saved, today).find((t) => t.id === 'unfinished')?.complete, true)
  assert.deepEqual(undoTodayStatus(next, createTodayStatusUndo(before, next, 'unfinished')), before)
  const reopened = changeDailyReviewTask(
    next,
    { taskId: 'finished-yesterday', complete: false },
    reviewContext,
  )
  assert.ok(dailyReviewTasks(reopened, today).some((t) => t.id === 'finished-yesterday' && !t.complete))
  assert.equal(rollWorkspaceDate(reopened, '2026-09-30').fields['daily.reviewOrder'], undefined)
})

test('review area and Done drop is atomic, protects project links, and supports Undo', () => {
  const fields = project(fixture())
  const dated = fields.datedTasksByDate as Record<string, Data[]>
  dated[yesterday]![0]!.objectiveId = 'launch'
  fields.weeklyObjectives = [
    { id: 'launch', title: 'Launch', channel: 'Work', tasks: [dated[yesterday]![0]!] },
  ]
  const before = normalize(fields)
  assert.throws(
    () =>
      changeDailyReviewTask(
        before,
        { taskId: 'unfinished', areaId: 'personal', complete: true },
        reviewContext,
      ),
    /Confirm/,
  )
  const next = changeDailyReviewTask(
    before,
    {
      taskId: 'unfinished',
      areaId: 'personal',
      complete: true,
      unlinkFromProject: true,
      beforeTaskId: 'finished-yesterday',
    },
    reviewContext,
  )
  validateDocument(next)
  const task = next.entities.find((e) => e.kind === 'task' && e.id === 'unfinished')!
  assert.equal((task.data.content as Data).channel, 'Personal')
  assert.equal((task.data.content as Data).objectiveId, undefined)
  assert.equal(task.data.lane, `date:${yesterday}`)
  assert.deepEqual(next.entities.find((e) => e.kind === 'project')!.data.links, [])
  assert.deepEqual(undoTodayStatus(next, createTodayStatusUndo(before, next, 'unfinished')), before)
  const beforeOrder = dailyReviewTasks(next, today).map((t) => t.id)
  assert.ok(beforeOrder.indexOf('unfinished') < beforeOrder.indexOf('finished-yesterday'))
  assert.throws(
    () => changeDailyReviewTask(before, { taskId: 'future', complete: true }, reviewContext),
    /no longer/,
  )
  assert.throws(() =>
    validateDocument({ ...before, fields: { ...before.fields, 'daily.reviewOrder': ['same', 'same'] } }),
  )
})

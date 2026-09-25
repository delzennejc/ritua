import assert from 'node:assert/strict'
import test from 'node:test'
import { areaTimeRange, areaTimeSummary } from '../domain/area-time'
import type { Task } from '../domain/models'

test('Area time periods follow calendar weeks, months, quarters, semesters and years', () => {
  const today = '2026-09-16'
  assert.deepEqual(areaTimeRange('week', today), { start: '2026-09-14', end: '2026-09-21' })
  assert.deepEqual(areaTimeRange('month', today), { start: '2026-09-01', end: '2026-10-01' })
  assert.deepEqual(areaTimeRange('quarter', today), { start: '2026-07-01', end: '2026-10-01' })
  assert.deepEqual(areaTimeRange('semester', today), { start: '2026-07-01', end: '2027-01-01' })
  assert.deepEqual(areaTimeRange('semester', '2026-06-30'), { start: '2026-01-01', end: '2026-07-01' })
  assert.deepEqual(areaTimeRange('year', today), { start: '2026-01-01', end: '2027-01-01' })
  assert.deepEqual(areaTimeRange('week', '2027-01-03'), { start: '2026-12-28', end: '2027-01-04' })
})

test('Area time includes only completed tasks in the selected period without duplicate counting', () => {
  const entry = (id: string, dateKey: string | null, extra: Partial<Task> = {}) => ({
    dateKey,
    task: { id, title: id, complete: true, minutes: 60, actualMinutes: 60, ...extra },
  })
  const entries = [
    entry('old', '2025-09-16'),
    entry('january', '2026-01-02'),
    entry('july', '2026-07-10'),
    entry('earlier-month', '2026-09-03'),
    entry('last-week', '2026-09-13'),
    entry('monday', '2026-09-14', { actualMinutes: 90 }),
    entry('monday', '2026-09-14', { actualMinutes: 90 }),
    entry('zero', '2026-09-15', { actualMinutes: 0 }),
    entry('pending', '2026-09-16', { complete: false, actualMinutes: 30 }),
    entry('late-completion', '2026-08-01', { completedDateKey: '2026-09-16', actualMinutes: 45 }),
    entry('backlog', null, { completedDateKey: '2026-09-16', actualMinutes: 15 }),
    entry('undated', null),
    entry('next-week', '2026-09-21'),
    entry('next-year', '2027-01-01'),
  ]
  const week = areaTimeSummary(entries, 'week', '2026-09-16')
  assert.equal(week.total, 150)
  assert.equal(week.buckets.length, 7)
  assert.deepEqual(
    week.buckets.map((bucket) => bucket.minutes),
    [90, 0, 60, 0, 0, 0, 0],
  )
  const month = areaTimeSummary(entries, 'month', '2026-09-16')
  assert.equal(month.buckets.length, 30)
  assert.equal(month.total, 330)
  const quarter = areaTimeSummary(entries, 'quarter', '2026-09-16')
  assert.deepEqual(
    quarter.buckets.map((bucket) => bucket.minutes),
    [60, 0, 330],
  )
  assert.equal(areaTimeSummary(entries, 'semester', '2026-09-16').total, 390)
  assert.equal(areaTimeSummary(entries, 'year', '2026-09-16').total, 450)
})

test('Area time fills empty periods, leap days and daylight-saving weeks with correct buckets', () => {
  const leapMonth = areaTimeSummary([], 'month', '2028-02-10')
  assert.equal(leapMonth.buckets.length, 29)
  assert.equal(leapMonth.end, '2028-02-29')
  const springWeek = areaTimeSummary([], 'week', '2026-03-29')
  assert.equal(springWeek.buckets.length, 7)
  assert.equal(springWeek.end, '2026-03-29')
  assert.equal(areaTimeSummary([], 'semester', '2026-07-01').buckets.length, 6)
  const year = areaTimeSummary([], 'year', '2026-12-31')
  assert.equal(year.buckets.length, 12)
  assert.equal(year.total, 0)
})

test('Area time uses Session dates and shares, excluding member logs and future Sessions', () => {
  const entries = [
    { dateKey: '2026-09-14', task: { id: 'a', title: 'A', complete: true, actualMinutes: 200 } },
    { dateKey: '2026-09-14', task: { id: 'b', title: 'B', complete: false, actualMinutes: 300 } },
  ]
  const session = {
    id: 's',
    kind: 'session' as const,
    title: 'Focus',
    dateKey: '2026-09-15',
    start: 600,
    end: 660,
    taskIds: ['a', 'b'],
  }
  const events = [session, { ...session, id: 'future', dateKey: '2026-09-17' }]
  const summary = areaTimeSummary(entries, 'week', '2026-09-16', events)
  assert.equal(summary.total, 60)
  assert.deepEqual(
    summary.buckets.map((bucket) => bucket.minutes),
    [0, 60, 0, 0, 0, 0, 0],
  )
  assert.equal(areaTimeSummary(entries.slice(0, 1), 'week', '2026-09-16', events).total, 30)
})

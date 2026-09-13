import { testCalendarSessions } from "./calendar-session-tests"
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../main/db/database'
import { addDays, calendarDaysAround, localDateKey, mondayOf, previousWeekDays, rollWorkspaceDate } from '../domain/live-calendar'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, type Data } from '../domain/workspace'
import { testTaskCompletion } from './task-completion-tests'

export function testLiveWorkspace() {
  testTaskCompletion()
  testCalendarSessions()
  assert.equal(localDateKey(new Date(2026, 8, 7, 0, 1)), '2026-09-07')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-03-29', 1), '2026-03-30', 'DST must not change the local calendar day')
  assert.equal(mondayOf('2027-01-01'), '2026-12-28')
  assert.deepEqual(previousWeekDays('2026-09-07').map(day => day.dateKey), ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'])
  assert.ok(calendarDaysAround('2027-01-01').some(day => day.dateKey === '2026-12-31'))
  assert.equal(emptyWorkspace().entities.filter(e => e.kind !== 'area').length, 0, 'Production must start without sample work')
  const fields = project(emptyWorkspace('2026-12-31'))
  fields.tasks = [{ id: 'old', title: 'Yesterday work', complete: false, minutes: 30 }]
  fields.datedTasksByDate = { '2027-01-01': [{ id: 'new', title: 'New year work', complete: false, minutes: 45 }] }
  fields.events = [{ id: 'old', title: 'Yesterday work', start: 600, end: 630 }]
  fields['daily.planText'] = 'Saved year-end plan'
  fields['weekly.planText'] = 'Saved week plan'
  const rolled = rollWorkspaceDate(normalize(fields), '2027-01-01')
  const after = project(rolled)
  assert.equal((after.tasks as Data[])[0]!.id, 'new')
  assert.equal(((after.datedTasksByDate as Data)['2026-12-31'] as Data[])[0]!.id, 'old')
  assert.equal((after.events as Data[])[0]!.dateKey, '2026-12-31')
  assert.equal(after['daily.planText'], undefined)
  assert.equal(after['weekly.planText'], 'Saved week plan')
  assert.equal((((after.ritualHistory as Data)['2026-12-31'] as Data).daily as Data)['daily.planText'], 'Saved year-end plan')
  assert.deepEqual(rollWorkspaceDate(rolled, '2027-01-01'), rolled, 'Same-day hydration must be idempotent')
  const nextWeek = project(rollWorkspaceDate(rolled, '2027-01-04'))
  assert.equal(nextWeek['weekly.planText'], undefined)
  assert.equal((((nextWeek.ritualHistory as Data)['2026-12-28'] as Data).weekly as Data)['weekly.planText'], 'Saved week plan')
  const directory = mkdtempSync(join(tmpdir(), 'ritua-initialization-'))
  try {
    const freshPath = join(directory, 'fresh.sqlite')
    const fresh = openDatabase(freshPath)
    const first = fresh.loadWorkspace()
    assert.deepEqual(first.entities.filter(entity => entity.kind === 'area').map(entity => (entity.data.content as Data).label).sort(), ['Personal', 'Work'])
    assert.ok(first.entities.every(entity => entity.kind === 'area'), 'Fresh production starts without sample tasks or projects')
    fresh.close()
    const rawFresh = new Database(freshPath, { readonly: true })
    assert.deepEqual((rawFresh.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name), ['app_metadata', 'attachments', 'workspace_entities', 'workspace_receipts', 'workspace_state'])
    rawFresh.close()
    const reopened = openDatabase(freshPath)
    assert.equal(reopened.loadWorkspace().fields.workspaceDate, localDateKey())
    assert.equal(reopened.loadWorkspace().entities.length, 2, 'Restart must not reseed or duplicate Areas')
    reopened.close()
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

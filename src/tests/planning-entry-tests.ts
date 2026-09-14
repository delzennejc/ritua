import assert from 'node:assert/strict'
import { completeWeeklyPlanning, openPendingPlanning } from './view-command-adapters'
import { rollWorkspaceDate } from '../domain/live-calendar'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'

export function testPlanningEntry() {
  const monday = '2026-09-14'
  const fields = { ...project(emptyWorkspace(monday)), view: 'backlog', planningStep: 3, weeklyStep: 2 }
  for (const day of ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']) {
    assert.equal(openPendingPlanning(fields, day).view, 'planning', 'Every other day opens Daily Planning')
  }
  const opening = openPendingPlanning(fields, monday)
  assert.equal(opening.view, 'weekly-planning', 'Monday overrides the saved screen')
  assert.equal(opening.weeklyStep, 2, 'Reopening preserves weekly progress')
  assert.equal(
    openPendingPlanning({ ...fields, 'daily.completedDate': monday }, monday).view,
    'weekly-planning',
  )
  const weeklyDone = project(normalize(completeWeeklyPlanning(opening, monday)))
  assert.equal(weeklyDone.view, 'planning', 'Weekly completion hands off to Daily Planning')
  assert.equal(weeklyDone.planningStep, 3, 'Handoff preserves an unfinished daily draft')
  assert.equal(
    openPendingPlanning({ ...weeklyDone, view: 'today' }, monday).view,
    'planning',
    'Restart after weekly completion opens pending Daily Planning',
  )
  const finished = { ...weeklyDone, 'daily.completedDate': monday, view: 'backlog' }
  assert.deepEqual(
    openPendingPlanning(project(normalize(finished)), monday),
    project(normalize(finished)),
    'Completed planning does not interrupt same-day reopening',
  )
  assert.equal(
    completeWeeklyPlanning(finished, monday).view,
    'home',
    'Repeating Weekly Planning does not repeat completed Daily Planning',
  )
  const tuesday = project(rollWorkspaceDate(normalize(finished), '2026-09-15'))
  assert.equal(openPendingPlanning(tuesday, '2026-09-15').view, 'planning')
  assert.equal(tuesday.planningStep, undefined, 'A new day starts fresh')
  const nextMonday = project(rollWorkspaceDate(normalize(finished), '2026-09-21'))
  assert.equal(openPendingPlanning(nextMonday, '2026-09-21').view, 'weekly-planning')
  assert.equal(nextMonday.weeklyStep, undefined, 'A new week starts fresh')
}

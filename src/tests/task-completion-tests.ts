import type { Fields } from '../domain/workspace'
import assert from 'node:assert/strict'
import { toggleWorkspaceTaskCompletion } from './view-command-adapters'
import { taskWorkedMinutes } from '../domain/task-time'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, validateDocument, type Data } from '../domain/workspace'

const today = '2026-09-10'
const task = (id: string, start: number, minutes: number, complete = false): Data => ({
  id,
  title: id,
  time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
  minutes,
  complete,
})
const event = (id: string, start: number, end: number, dateKey = today): Data => ({
  id,
  title: id,
  start,
  end,
  dateKey,
  complete: false,
})
export const fixture = (): Fields => ({
  ...project(emptyWorkspace(today)),
  tasks: [
    task('first', 600, 60),
    task('next', 660, 30),
    task('later', 720, 45),
    task('done', 800, 30, true),
    { id: 'unscheduled', title: 'unscheduled', minutes: 30, complete: false },
  ],
  datedTasksByDate: { '2026-09-11': [task('tomorrow', 660, 30)] },
  weeklyObjectives: [
    {
      id: 'project',
      title: 'project',
      tasks: [
        {
          id: 'ref-first',
          taskId: 'first',
          title: 'first',
          minutes: 60,
          actualMinutes: null,
          time: '10:00',
          complete: false,
        },
        { id: 'ref-next', taskId: 'next', title: 'next', minutes: 30, time: '11:00', complete: false },
      ],
    },
  ],
  events: [
    event('first', 600, 660),
    event('next', 660, 690),
    event('later', 720, 765),
    { ...event('done', 800, 830), complete: true },
    event('meeting', 900, 930),
    { ...event('shutdown', 1140, 1140), kind: 'shutdown' },
    event('tomorrow', 660, 690, '2026-09-11'),
  ],
})
export const completeAt = (fields: Fields, minute: number, id = 'first', day = today) =>
  toggleWorkspaceTaskCompletion(
    fields,
    id,
    new Date(
      `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
    ),
  )
export const block = (fields: Fields, id: string) => (fields.events as Data[]).find((item) => item.id === id)!
const member = (fields: Fields, id: string) => (fields.tasks as Data[]).find((item) => item.id === id)!

export function testTaskCompletion() {
  for (const minute of [615, 645, 659, 660, 690, 780, 781, 839, 840]) {
    const before = fixture()
    const snapshot = structuredClone(before)
    const after = completeAt(before, minute)
    assert.deepEqual(before, snapshot, 'Completion must not mutate its input')
    const delta = minute - 660
    assert.equal(block(after, 'first').end, minute)
    assert.equal(member(after, 'first').minutes, minute - 600)
    assert.equal(
      member(after, 'first').actualMinutes,
      minute - 600,
      'Actual time is the final calendar duration after completion',
    )
    assert.equal(
      taskWorkedMinutes(member(after, 'first')),
      minute - 600,
      'Review totals use the recorded calendar time',
    )
    assert.equal(member(after, 'first').completedAtMinute, minute)
    assert.equal(block(after, 'first').complete, true)
    assert.equal(block(after, 'next').start, 660 + delta)
    assert.equal(block(after, 'next').end, 690 + delta)
    assert.equal(block(after, 'later').start, 720 + delta)
    assert.equal(member(after, 'next').minutes, 30)
    const mirrors = (after.weeklyObjectives as Data[])[0]!.tasks as Data[]
    assert.equal(mirrors[0]!.taskId, 'next', 'Completion keeps project tasks ordered')
    assert.equal(mirrors[1]!.minutes, minute - 600, 'Project duration derives from the canonical task')
    assert.equal(
      mirrors[1]!.actualMinutes,
      minute - 600,
      'Project actual time derives from the canonical task',
    )
    assert.equal(mirrors[0]!.time, member(after, 'next').time)
    for (const id of ['done', 'meeting', 'shutdown', 'tomorrow'])
      assert.deepEqual(block(after, id), block(before, id))
    assert.deepEqual(member(after, 'unscheduled'), member(before, 'unscheduled'))
    validateDocument(normalize(after))
    assert.deepEqual(project(normalize(after)), after, 'Completion survives canonical roundtrip')
    const reopened = completeAt(after, 700)
    assert.equal(member(reopened, 'first').complete, false)
    assert.equal(member(reopened, 'first').completedAtMinute, null)
    assert.equal(
      member(reopened, 'first').actualMinutes,
      minute - 600,
      'Reopening preserves already recorded work',
    )
    assert.equal(block(reopened, 'first').end, minute, 'Reopening does not trigger another retiming')
    assert.equal(block(reopened, 'next').start, 660 + delta)
    assert.equal((reopened.tasks as Data[])[0]!.id, 'first', 'Reopening restores task position')
    assert.equal(((reopened.weeklyObjectives as Data[])[0]!.tasks as Data[])[0]!.taskId, 'first')
  }
  for (const minute of [479, 600, 841]) {
    const after = completeAt(fixture(), minute)
    assert.equal(block(after, 'first').end, 660, 'Outside three hours or before start must not resize')
    assert.equal(block(after, 'next').start, 660)
    assert.equal(member(after, 'first').complete, true)
    assert.equal(
      member(after, 'first').actualMinutes,
      60,
      'Without retiming, Actual uses the unchanged calendar block',
    )
  }
  const long = fixture()
  block(long, 'first').start = 420
  assert.equal(block(completeAt(long, 480), 'first').end, 480, 'Exactly three hours early is included')
  assert.equal(block(completeAt(long, 479), 'first').end, 660, 'More than three hours early is excluded')
  for (const day of ['2026-09-09', '2026-09-11']) {
    const after = completeAt(fixture(), 650, 'first', day)
    assert.equal(
      block(after, 'first').end,
      660,
      'Minute-of-day coincidence on another date must not retime history or future work',
    )
    assert.equal(
      member(after, 'first').actualMinutes,
      60,
      'Completing work on another date records its own calendar duration',
    )
  }
  for (const previousActual of [0, 25, 120]) {
    const fields = fixture()
    member(fields, 'first').actualMinutes = previousActual
    assert.equal(
      member(completeAt(fields, 645), 'first').actualMinutes,
      45,
      'Completing a scheduled task replaces earlier Actual with its final calendar duration',
    )
  }
  const unscheduled = fixture()
  member(unscheduled, 'unscheduled').actualMinutes = 12
  assert.equal(
    member(completeAt(unscheduled, 645, 'unscheduled'), 'unscheduled').actualMinutes,
    12,
    'Tasks without a calendar block retain logged actual time',
  )
  assert.equal(
    member(completeAt(fixture(), 645, 'unscheduled'), 'unscheduled').actualMinutes,
    undefined,
    'A missing calendar block must not fabricate Actual',
  )
  const brief = fixture()
  assert.equal(
    member(completeAt(brief, 601), 'first').minutes,
    1,
    'Actual completion is not snapped to the resize grid',
  )
  const overlap = fixture()
  ;(overlap.tasks as Data[]).push(task('parallel', 630, 60))
  ;(overlap.events as Data[]).push(event('parallel', 630, 690))
  assert.equal(
    block(completeAt(overlap, 690), 'parallel').start,
    630,
    'Already-started parallel work is not a following task',
  )
  const midnight = fixture()
  block(midnight, 'later').start = 1395
  block(midnight, 'later').end = 1425
  const bounded = completeAt(midnight, 690)
  assert.equal(block(bounded, 'later').end, 1440, 'The following group stays within its calendar day')
  assert.equal(block(bounded, 'next').start, 675, 'Midnight caps the entire following group equally')
  validateDocument(normalize(bounded))
  assert.equal(completeAt(brief, 650, 'missing'), brief)
}

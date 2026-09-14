import type { Fields } from '../domain/workspace'
import assert from 'node:assert/strict'
import { reassignMissedTasksToToday } from './view-command-adapters'
import { emptyWorkspace } from '../domain/production-workspace'
import { applyChanges, changes, normalize, project, type Data } from '../domain/workspace'

export function testDailyPlanning() {
  const today = '2027-01-01'
  const yesterday = '2026-12-31'
  const task = (id: string, extra: Data = {}): Data => ({
    id,
    title: id,
    minutes: 30,
    complete: false,
    ...extra,
  })
  const fields: Fields = {
    ...project(emptyWorkspace(today)),
    tasks: [task('existing'), task('completed-today', { complete: true })],
    datedTasksByDate: {
      [yesterday]: [
        task('worked', { actualMinutes: 10 }),
        task('missed-work', {
          channel: 'Work',
          time: '10:00',
          notes: 'Keep these notes',
          objectiveId: 'project',
          subtasks: [task('subtask')],
        }),
        task('missed-personal', { channel: 'Personal', recurrenceSeriesId: 'series', recurrenceIndex: 1 }),
        task('reviewed-as-missed', { complete: true, actualMinutes: 30 }),
      ],
      '2027-01-02': [task('future')],
    },
    weeklyObjectives: [
      {
        id: 'project',
        title: 'Project',
        tasks: [
          {
            id: 'project-missed',
            taskId: 'missed-work',
            title: 'missed-work',
            time: '10:00',
            complete: false,
          },
        ],
      },
    ],
    events: [
      { id: 'missed-work', title: 'missed-work', dateKey: yesterday, start: 600, end: 630 },
      { id: 'worked', title: 'worked', dateKey: yesterday, start: 660, end: 690 },
    ],
    'daily.yesterdayTaskIdsByLane': {
      worked: ['worked'],
      missed: ['missed-personal', 'missed-work', 'reviewed-as-missed', 'missing', 'future', 'missed-work'],
    },
  }
  const ids = (fields['daily.yesterdayTaskIdsByLane'] as Data).missed as string[]
  const before = structuredClone(fields)
  const after = reassignMissedTasksToToday(fields, ids, today)
  assert.deepEqual(fields, before, 'Review carryover must not mutate its input')
  assert.deepEqual(
    (after.tasks as Data[]).map((item) => item.id),
    ['existing', 'missed-personal', 'missed-work', 'completed-today', 'reviewed-as-missed'],
    'Every reviewed task moves in review order, with completed tasks last',
  )
  const dates = after.datedTasksByDate as Record<string, Data[]>
  assert.deepEqual(
    dates[yesterday]!.map((item) => item.id),
    ['worked'],
    'Worked-on tasks stay yesterday',
  )
  assert.deepEqual(
    dates['2027-01-02'],
    (fields.datedTasksByDate as Data)['2027-01-02'],
    'Stale review IDs must not pull work back from another day',
  )
  for (const id of ['missed-work', 'missed-personal', 'reviewed-as-missed']) {
    assert.deepEqual(
      (after.tasks as Data[]).find((item) => item.id === id),
      ((fields.datedTasksByDate as Data)[yesterday] as Data[]).find((item) => item.id === id),
      'Carryover preserves task details and recurrence identity',
    )
  }
  assert.equal(
    (after.events as Data[])[0]!.dateKey,
    today,
    'An existing calendar block follows its task to today',
  )
  assert.deepEqual(
    (after.events as Data[])[1],
    (fields.events as Data[])[1],
    'Worked-on calendar history stays yesterday',
  )
  assert.deepEqual(
    after.weeklyObjectives,
    fields.weeklyObjectives,
    'Project references retain the same canonical task',
  )
  assert.equal(
    reassignMissedTasksToToday(after, ids, today),
    after,
    'Revisiting the review must not duplicate tasks',
  )
  assert.equal(reassignMissedTasksToToday(fields, [], today), fields, 'An empty review is a no-op')
  const initial = normalize(fields)
  const saved = applyChanges(initial, changes(initial, normalize(after), 'daily-carryover'))
  assert.deepEqual(
    project(saved),
    after,
    'Task and event dates persist together through a validated atomic commit',
  )
}

import assert from 'node:assert/strict'
import {
  normalize,
  project,
  validateDocument,
  type Fields,
  type WorkspaceDocument,
} from '../domain/workspace'
import { emptyWorkspace } from '../domain/production-workspace'
import { type TaskCommand } from '../domain/task-commands'
import { executeTaskCommand } from './view-command-adapters'
import { changeWorkspaceField } from './view-command-adapters'
import { changeWorkspaceRecurrence } from './view-command-adapters'
import { recurrenceForPreset } from '../domain/recurrence'
import { removeWorkspaceProject, undoWorkspaceProjectRemoval } from './view-command-adapters'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from './view-command-adapters'
import { workspaceCollections } from '../domain/workspace-collections'
import { selectTask } from '../domain/workspace-selectors'
import { createCalendarSession, linkSessionTask } from './view-command-adapters'
import { editWorkspaceTask } from './view-command-adapters'

const context = { today: '2026-09-14', now: new Date('2026-09-14T10:00:00'), actor: 'Test' }
export function assertWorkspaceInvariants(fields: Fields) {
  const doc = normalize(fields)
  validateDocument(doc)
  assert.deepEqual(project(normalize(project(doc))), project(doc), 'Projection is stable across restart')
  const ids = doc.entities.filter((e) => e.kind === 'task').map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'Each task has one canonical location')
  const views = workspaceCollections(project(doc))
  for (const owner of views.weeklyObjectives)
    for (const member of owner.tasks ?? []) {
      const task = selectTask(doc, member.taskId || member.id)!
      assert.ok(task, 'Project references an existing task')
      if (member.title !== undefined) assert.equal(member.title, task.title)
      if (member.complete !== undefined) assert.equal(member.complete, task.complete)
      if (task.objectiveId)
        assert.equal(task.objectiveId, owner.id, 'Active ownership agrees with project references')
    }
  for (const event of views.events)
    if (event.kind !== 'session' && event.kind !== 'shutdown') {
      const task = selectTask(doc, event.id)
      if (task) {
        if (event.title !== undefined) assert.equal(event.title, task.title)
        const location = doc.entities.find((e) => e.kind === 'task' && e.id === task.id)!.data.lane
        assert.equal(
          location,
          (event.dateKey ?? context.today) === context.today ? 'today' : `date:${event.dateKey}`,
        )
        assert.equal(task.minutes, event.end - event.start, 'Calendar duration matches task')
      }
    }
  return doc
}

/** The same scenario runs in Node and through an actual SQLite close/reopen after each step. */
export function exerciseWorkspaceSequence(
  restart: (doc: WorkspaceDocument) => WorkspaceDocument = (doc) => JSON.parse(JSON.stringify(doc)),
) {
  let fields = project(emptyWorkspace(context.today))
  const checkpoint = (next: Fields) => {
    const doc = assertWorkspaceInvariants(next)
    fields = project(restart(doc))
    assertWorkspaceInvariants(fields)
  }
  const command = (command: TaskCommand) => checkpoint(executeTaskCommand(fields, command, context))
  checkpoint(
    changeWorkspaceField(fields, 'weeklyObjectives', [
      { id: 'project', title: 'Original', channel: 'Work', tasks: [] },
      { id: 'other', title: 'New owner', channel: 'Work', tasks: [] },
    ]),
  )
  command({
    type: 'task.create',
    tasks: [
      {
        task: {
          id: 'task',
          title: 'Recurring work',
          channel: 'Work',
          objectiveId: 'project',
          minutes: 30,
          complete: false,
        },
        lane: 'today',
      },
    ],
  })
  const recurrence = recurrenceForPreset('daily', context.today)
  recurrence.end = { type: 'after', date: '', count: 4 }
  checkpoint(
    changeWorkspaceRecurrence(fields, 'task', recurrence, {
      today: context.today,
      seriesId: 'series',
      prepareTask: (task) => task,
    }).fields,
  )
  const recurringId = normalize(fields).entities.find((e) => e.kind === 'task' && e.data.lane === 'today')!.id
  command({ type: 'task.schedule', taskId: recurringId, dateKey: '2026-09-16', start: 600, end: 645 })
  checkpoint(
    createCalendarSession(fields, {
      id: 'session',
      title: 'Work session',
      dateKey: '2026-09-16',
      start: 600,
      end: 780,
    }),
  )
  checkpoint(linkSessionTask(fields, 'session', recurringId))
  const archived = removeWorkspaceProject(fields, 'project', 'archive', context.now)!
  checkpoint(archived.fields)
  command({ type: 'task.assign', taskId: recurringId, projectId: 'other' })
  checkpoint(
    editWorkspaceTask(
      fields,
      recurringId,
      { title: 'Edited after archive' },
      { actor: context.actor, now: context.now },
    ),
  )
  checkpoint(undoWorkspaceProjectRemoval(fields, archived.undo))
  assert.equal(selectTask(normalize(fields), recurringId)!.objectiveId, 'other')
  assert.equal(selectTask(normalize(fields), recurringId)!.title, 'Edited after archive')
  const deletion = deleteWorkspaceTask(fields, recurringId, 'following')
  checkpoint(deletion.fields)
  command({
    type: 'task.create',
    tasks: [{ task: { id: 'unrelated', title: 'Later work', channel: 'Personal' }, lane: 'backlog:anytime' }],
  })
  checkpoint(undoWorkspaceTaskDeletion(fields, deletion.undo))
  assert.ok(selectTask(normalize(fields), 'unrelated'))
  assert.deepEqual(
    (workspaceCollections(fields).events.find((e) => e.id === 'session') as { taskIds: string[] }).taskIds,
    [recurringId],
  )
  command({ type: 'task.unschedule', taskId: recurringId })
  command({ type: 'task.move', taskId: recurringId, lane: 'backlog:someday' })
  command({ type: 'task.complete-undated', taskId: recurringId })
  assert.equal(selectTask(normalize(fields), recurringId)!.complete, true)
  return fields
}

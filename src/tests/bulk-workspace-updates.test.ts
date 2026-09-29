import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSession } from '../renderer/src/desktop/workspace-session'
import { createBulkWorkspaceUpdateQueue } from '../renderer/src/desktop/bulk-workspace-updates'
import { addSessionTask, createCalendarSession } from '../domain/calendar-sessions'
import { stageWorkspaceSessionRecurrence } from '../domain/session-recurrence'
import { recurrenceForPreset } from '../domain/recurrence'
import { renameWorkspaceArea } from '../domain/area-commands'
import { selectTask } from '../domain/workspace-selectors'
import type { Data } from '../domain/workspace-types'
import { emptyWorkspace } from '../domain/production-workspace'
import { changeWorkspaceField } from '../domain/workspace-commands'
import { executeTaskCommand, validateWorkspaceTaskAssignments } from '../domain/task-commands'
import { applyBulkWorkspaceAction } from '../renderer/src/desktop/bulk-workspace-actions'
import { stageWorkspaceProjectArea } from '../domain/project-commands'
import { createWorkspaceTasks } from '../domain/task-creation'
import { editWorkspaceTask } from '../domain/task-editing'

test('large recurrence and Area edits publish the selected item before updating related records', async () => {
  let queue: ReturnType<typeof createBulkWorkspaceUpdateQueue> | undefined
  const session = createWorkspaceSession(undefined, {
    async prepareClose() {
      await queue?.flush()
    },
  })
  try {
    await session.initializeWorkspace()
    const today = String(session.getDocument().fields.workspaceDate)
    let document = createCalendarSession(session.getDocument(), {
      id: 'session',
      title: 'Planning',
      dateKey: today,
      start: 600,
      end: 660,
    })
    document = addSessionTask(document, 'session', { id: 'task', title: 'Prepare' })
    session.replaceWorkspaceDocument(document)
    const rule = recurrenceForPreset('daily', today)
    session.replaceWorkspaceDocument(stageWorkspaceSessionRecurrence(session.getDocument(), 'session', rule))
    queue = createBulkWorkspaceUpdateQueue(session.getDocument, session.replaceWorkspaceDocument, (error) => {
      throw error
    })
    queue.enqueue('session-recurrence:session', {
      type: 'session-recurrence',
      sessionId: 'session',
      recurrence: rule,
      context: { today, seriesId: 'series' },
    })
    assert.equal(
      (
        (session.getDocument().entities.find((entity) => entity.id === 'session')!.data.content as Data)
          .recurrence as Data
      ).frequency,
      'day',
    )
    assert.equal(
      session
        .getDocument()
        .entities.filter(
          (entity) =>
            entity.kind === 'event' && (entity.data.content as Data).recurrenceSeriesId === 'series',
        ).length,
      0,
    )
    await queue.flush()
    assert.ok(
      session
        .getDocument()
        .entities.filter(
          (entity) =>
            entity.kind === 'event' && (entity.data.content as Data).recurrenceSeriesId === 'series',
        ).length > 300,
    )

    const area = session
      .getDocument()
      .entities.find((entity) => entity.kind === 'area' && (entity.data.content as Data).label === 'Work')!
    session.replaceWorkspaceDocument(renameWorkspaceArea(session.getDocument(), area.id, 'Office', true))
    queue.enqueue('area-rename', { type: 'area-rename', previous: 'Work', label: 'Office' })
    assert.equal(
      (session.getDocument().entities.find((entity) => entity.id === area.id)!.data.content as Data).label,
      'Office',
    )
    assert.equal(selectTask(session.getDocument(), 'task')!.channel, 'Work')
    await session.flushBeforeClose()
    assert.equal(selectTask(session.getDocument(), 'task')!.channel, 'Office')
    assert.ok(
      session
        .getDocument()
        .entities.some(
          (entity) =>
            entity.kind === 'task' &&
            (entity.data.content as Data).channel === 'Office' &&
            entity.id !== 'task',
        ),
    )
  } finally {
    await queue?.flush()
    session.dispose()
  }
})

test('large project assignment publishes one task, then updates remaining eligible tasks', () => {
  const context = { actor: 'Test', today: '2026-09-28', now: new Date('2026-09-28T10:00:00Z') }
  let document = changeWorkspaceField(emptyWorkspace(), 'weeklyObjectives', [
    { id: 'project', title: 'Project', channel: 'Work', complete: false, tasks: [] },
  ])
  const ids = Array.from({ length: 20 }, (_, index) => `task-${index}`)
  document = executeTaskCommand(
    document,
    {
      type: 'task.create',
      tasks: ids.map((id) => ({ task: { id, title: id, channel: 'Work' }, lane: 'today' })),
    },
    context,
  )
  validateWorkspaceTaskAssignments(document, ids, 'project')
  const staged = executeTaskCommand(
    document,
    { type: 'task.assign-many', taskIds: [ids[0]!], projectId: 'project' },
    context,
  )
  assert.equal(selectTask(staged, ids[0]!)!.objectiveId, 'project')
  assert.equal(selectTask(staged, ids[1]!)!.objectiveId, undefined)
  const result = applyBulkWorkspaceAction(staged, {
    type: 'task-assign-many',
    taskIds: ids.slice(1),
    projectId: 'project',
    expected: Object.fromEntries(ids.slice(1).map((id) => [id, { channel: 'Work' }])),
    context: { actor: context.actor, today: context.today, now: context.now.toISOString() },
  })
  assert.ok(ids.every((id) => selectTask(result.document, id)!.objectiveId === 'project'))
  const movedProject = stageWorkspaceProjectArea(result.document, 'project', { channel: 'Personal' })
  assert.equal(selectTask(movedProject, ids[0]!)!.channel, 'Work')
  const movedTasks = applyBulkWorkspaceAction(movedProject, {
    type: 'project-area',
    projectId: 'project',
    patch: { channel: 'Personal' },
    accent: 'green',
  }).document
  assert.ok(ids.every((id) => selectTask(movedTasks, id)!.channel === 'Personal'))
})

test('recurring task creation shows the first task before generating later copies', () => {
  const context = { actor: 'Test', today: '2026-09-28', now: new Date('2026-09-28T10:00:00Z') }
  const request = {
    seriesId: 'new-series',
    area: 'Work',
    accent: 'violet',
    dateKey: context.today,
    minutes: 30,
    title: 'Original',
    recurrence: recurrenceForPreset('daily', context.today),
  }
  const staged = createWorkspaceTasks(emptyWorkspace(), request, context, { firstOnly: true })
  assert.equal(staged.firstTaskId, 'new-series-1')
  assert.equal(staged.document.entities.filter((entity) => entity.kind === 'task').length, 1)
  const renamed = editWorkspaceTask(
    staged.document,
    'new-series-1',
    { title: 'Updated before propagation' },
    { actor: context.actor, now: context.now },
  )
  const result = applyBulkWorkspaceAction(renamed, {
    type: 'task-create-following',
    request,
    firstTaskId: staged.firstTaskId!,
    context: { actor: context.actor, today: context.today, now: context.now.toISOString() },
  }).document
  const tasks = result.entities.filter((entity) => entity.kind === 'task')
  assert.ok(tasks.length > 300)
  assert.equal(tasks.filter((entity) => entity.id === staged.firstTaskId).length, 1)
  assert.ok(tasks.every((entity) => (entity.data.content as Data).title === 'Updated before propagation'))
})

test('a bulk result recomputes when another canonical edit arrives during calculation', async () => {
  let document = emptyWorkspace()
  const queue = createBulkWorkspaceUpdateQueue(
    () => document,
    (next) => {
      document = next
    },
    (error) => {
      throw error
    },
  )
  queue.enqueue('rename', { type: 'area-rename', previous: 'Work', label: 'Office' })
  const pending = queue.flush()
  document = executeTaskCommand(
    document,
    {
      type: 'task.create',
      tasks: [{ task: { id: 'concurrent', title: 'Concurrent', channel: 'Work' }, lane: 'today' }],
    },
    { actor: 'Test', today: '2026-09-28', now: new Date('2026-09-28T10:00:00Z') },
  )
  await pending
  assert.equal(selectTask(document, 'concurrent')!.channel, 'Office')
})

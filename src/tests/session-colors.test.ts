import assert from 'node:assert/strict'
import test from 'node:test'
import { createCalendarSession, linkSessionTask, moveSessionTask } from '../domain/calendar-sessions'
import { majoritySessionArea } from '../domain/session-colors'
import { documentSessions } from '../domain/session-board-order'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace-projection'
import { taskContent } from '../domain/workspace-selectors'
import { editWorkspaceTask } from '../domain/task-editing'
import type { Area } from '../domain/models'
import type { WorkspaceDocument } from '../domain/workspace-types'

const today = '2026-09-30'

function fixture() {
  const fields = project(emptyWorkspace(today))
  fields.areas = [
    { id: 'work', label: 'Work', color: '#8d6ae8' },
    { id: 'personal', label: 'Personal', color: '#69b984' },
    { id: 'home', label: 'Home', color: '#69b984' },
  ]
  fields.tasks = [
    { id: 'work', title: 'Long work task', channel: 'Work', minutes: 600 },
    { id: 'personal-1', title: 'Personal task', channel: 'Personal', minutes: 5 },
    { id: 'personal-2', title: 'Completed personal task', channel: 'Personal', complete: true },
    { id: 'home', title: 'Home task', channel: 'Home' },
  ]
  fields.weeklyObjectives = [
    {
      id: 'project',
      title: 'Work project',
      channel: 'Work',
      tasks: [{ id: 'mirror', taskId: 'work', title: 'Long work task' }],
    },
  ]
  return createCalendarSession(normalize(fields), {
    id: 'session',
    title: 'Focus',
    dateKey: today,
    start: 600,
    end: 780,
  })
}

function majority(document: WorkspaceDocument, sessionId = 'session') {
  const tasks = new Map(
    document.entities
      .filter((entity) => entity.kind === 'task')
      .map((entity) => [entity.id, taskContent(entity)]),
  )
  return majoritySessionArea(
    documentSessions(document).find((session) => session.id === sessionId)!,
    tasks,
    project(document).areas as unknown as Area[],
  )
}

test('session color follows task counts across drops, counting completion and canonical tasks once', () => {
  let document = fixture()
  assert.equal(majority(document), undefined, 'Empty sessions keep the neutral background')
  document = linkSessionTask(document, 'session', 'work')
  assert.equal(majority(document)?.id, 'work')
  document = linkSessionTask(document, 'session', 'personal-1')
  assert.equal(majority(document)?.id, 'work', 'Area order breaks ties')
  document = linkSessionTask(document, 'session', 'home')
  assert.equal(majority(document)?.id, 'work', 'Areas sharing a color count separately')
  document = linkSessionTask(document, 'session', 'personal-2')
  assert.equal(majority(document)?.id, 'personal', 'The largest task count wins, regardless of estimates')
  assert.equal(
    documentSessions(document)[0]!.color,
    undefined,
    'Automatic colors do not become manual overrides',
  )
  assert.equal(
    majority(normalize(project(document)))?.color,
    '#69b984',
    'Automatic colors survive serialization',
  )
})

test('automatic session color updates for task removal, moves and area reassignment', () => {
  let document = fixture()
  for (const id of ['work', 'personal-1', 'personal-2']) document = linkSessionTask(document, 'session', id)
  document = createCalendarSession(document, {
    id: 'second',
    title: 'Later focus',
    dateKey: today,
    start: 840,
    end: 900,
  })
  document = moveSessionTask(document, 'session', 'personal-2', 'second')
  assert.equal(majority(document)?.id, 'work')
  assert.equal(majority(document, 'second')?.id, 'personal')
  document = moveSessionTask(document, 'session', 'work', null)
  assert.equal(majority(document)?.id, 'personal')
  document = editWorkspaceTask(
    document,
    'personal-1',
    { channel: 'Home' },
    { actor: 'Test', now: new Date(`${today}T12:00:00`) },
  )
  assert.equal(majority(document)?.id, 'home')
  document = moveSessionTask(document, 'session', 'personal-1', null)
  assert.equal(majority(document), undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSession } from '../renderer/src/desktop/workspace-session'
import { createRecurringTaskUpdateQueue } from '../renderer/src/desktop/recurring-task-updates'
import { createBulkWorkspaceUpdateQueue } from '../renderer/src/desktop/bulk-workspace-updates'
import { createCalendarSession, addSessionTask } from '../domain/calendar-sessions'
import { changeWorkspaceSessionRecurrence } from '../domain/session-recurrence'
import { recurrenceForPreset } from '../domain/recurrence'
import { editWorkspaceTask } from '../domain/task-editing'
import { selectTask } from '../domain/workspace-selectors'
import type { Data } from '../domain/workspace-types'

test('recurring property edits show on the selected task first and close drains the queued series update', async () => {
  let bulk: ReturnType<typeof createBulkWorkspaceUpdateQueue> | undefined
  const session = createWorkspaceSession(undefined, {
    async prepareClose() {
      await bulk?.flush()
    },
  })
  try {
    await session.initializeWorkspace()
    const today = String(session.getDocument().fields.workspaceDate)
    let document = createCalendarSession(session.getDocument(), {
      id: 'session',
      title: 'Writing',
      dateKey: today,
      start: 600,
      end: 660,
    })
    document = addSessionTask(document, 'session', { id: 'work', title: 'Original' })
    document = changeWorkspaceSessionRecurrence(document, 'session', recurrenceForPreset('weekly', today), {
      today,
      seriesId: 'series',
    })
    session.replaceWorkspaceDocument(document)
    const following = document.entities.find(
      (entity) =>
        entity.kind === 'event' &&
        (entity.data.content as Data).recurrenceSeriesId === 'series' &&
        entity.id !== 'session',
    )!
    const laterTaskId = ((following.data.content as Data).taskIds as string[])[0]!
    bulk = createBulkWorkspaceUpdateQueue(session.getDocument, session.replaceWorkspaceDocument, (error) => {
      throw error
    })
    const queue = createRecurringTaskUpdateQueue(session.getDocument, bulk)
    const context = { actor: 'Test', now: new Date(), deferSessionPropagation: true }
    session.replaceWorkspaceDocument(
      editWorkspaceTask(session.getDocument(), 'work', { channel: 'Personal' }, context),
    )
    queue.enqueue('work', { channel: 'Personal' })
    session.replaceWorkspaceDocument(
      editWorkspaceTask(session.getDocument(), 'work', { notes: 'New instructions' }, context),
    )
    queue.enqueue('work', { notes: 'New instructions' })
    assert.equal(selectTask(session.getDocument(), 'work')!.channel, 'Personal')
    assert.equal(selectTask(session.getDocument(), laterTaskId)!.channel, 'Work')
    assert.equal(selectTask(session.getDocument(), laterTaskId)!.notes, '')

    await session.flushBeforeClose()
    assert.equal(selectTask(session.getDocument(), laterTaskId)!.channel, 'Personal')
    assert.equal(selectTask(session.getDocument(), laterTaskId)!.notes, 'New instructions')
  } finally {
    await bulk?.flush()
    session.dispose()
  }
})

import assert from 'node:assert/strict'
import { emptyWorkspace } from '../domain/production-workspace'
import { executeTaskCommand } from '../domain/task-commands'
import { editWorkspaceCalendar } from '../domain/calendar-commands'
import { editWorkspaceTask } from '../domain/task-editing'
import { toggleWorkspaceTaskCompletion } from '../domain/task-completion'
import { deleteWorkspaceTask, undoWorkspaceTaskDeletion } from '../domain/task-deletion'
import { project, normalize, validateDocument, type WorkspaceDocument } from '../domain/workspace'
import { workspaceCollections } from '../domain/workspace-collections'
import { selectTask } from '../domain/workspace-selectors'

export function testTaskCalendarBlocks() {
  const context = { today: '2026-09-16', now: new Date('2026-09-16T08:00:00'), actor: 'Test' }
  let doc = executeTaskCommand(
    emptyWorkspace(context.today),
    {
      type: 'task.create',
      tasks: [
        { task: { id: 'split-work', title: 'Split work', complete: false, minutes: 60 }, lane: 'today' },
      ],
    },
    context,
  )
  const blocks = (input: WorkspaceDocument) => workspaceCollections(project(input)).events
  const schedule = (dateKey: string, start: number, end: number) => {
    doc = executeTaskCommand(
      doc,
      { type: 'task.schedule', taskId: 'split-work', dateKey, start, end },
      context,
    )
    validateDocument(doc)
  }
  schedule(context.today, 660, 720)
  schedule(context.today, 780, 840)
  schedule('2026-09-17', 540, 720)
  const original = doc
  assert.equal(blocks(doc).length, 3)
  assert.equal(new Set(blocks(doc).map((block) => block.id)).size, 3)
  assert.equal(doc.entities.filter((e) => e.kind === 'task').length, 1)
  assert.equal(selectTask(doc, 'split-work')!.minutes, 300, 'One hour + one hour + three hours = five hours')
  assert.equal(selectTask(doc, 'split-work')!.complete, false, 'Scheduling more work never completes it')
  assert.deepEqual(project(normalize(project(doc))), project(doc), 'All block references survive projection')

  const middle = blocks(doc)[1]!
  doc = executeTaskCommand(
    doc,
    {
      type: 'task.schedule',
      taskId: 'split-work',
      eventId: middle.id,
      dateKey: context.today,
      start: 795,
      end: 855,
    },
    context,
  )
  assert.equal(blocks(doc).length, 3, 'Editing a selected block does not append')
  assert.equal(blocks(doc)[0]!.start, 660, 'Editing preserves the earlier block')
  doc = editWorkspaceCalendar(
    doc,
    blocks(doc).map((block) => (block.id === middle.id ? { ...block, end: 885 } : block)),
  )
  assert.equal(selectTask(doc, 'split-work')!.minutes, 330, 'Resize adjusts the sum')
  doc = editWorkspaceCalendar(
    doc,
    blocks(doc).filter((block) => block.id !== middle.id),
  )
  assert.equal(selectTask(doc, 'split-work')!.minutes, 240, 'Removing one block retains the others')
  assert.equal(blocks(doc).length, 2)
  doc = editWorkspaceTask(doc, 'split-work', { title: 'Renamed work' }, context)
  assert.ok(
    blocks(doc).every((block) => block.title === 'Renamed work'),
    'Titles come from the same task',
  )
  assert.throws(
    () => editWorkspaceTask(doc, 'split-work', { minutes: 60 }, context),
    /individual calendar blocks/,
  )
  const deleted = deleteWorkspaceTask(doc, 'split-work')
  assert.equal(blocks(deleted.document).length, 0)
  assert.deepEqual(
    project(undoWorkspaceTaskDeletion(deleted.document, deleted.undo)),
    project(doc),
    'Undo restores all blocks',
  )

  doc = toggleWorkspaceTaskCompletion(original, 'split-work', new Date('2026-09-17T12:00:00'))
  assert.equal(selectTask(doc, 'split-work')!.actualMinutes, 300, 'Completion records all scheduled work')
  assert.ok(
    blocks(doc).every((block) => block.kind !== 'shutdown' && block.kind !== 'session' && block.complete),
  )
  assert.equal(blocks(doc)[0]!.end, 720, 'Completion preserves earlier days')
  const early = toggleWorkspaceTaskCompletion(original, 'split-work', new Date('2026-09-17T11:30:00'))
  assert.equal(selectTask(early, 'split-work')!.minutes, 270)
  assert.equal(selectTask(early, 'split-work')!.actualMinutes, 270)
  assert.equal(blocks(early)[1]!.end, 840, 'Only the final active block is resized')
  validateDocument(early)
  const reopened = toggleWorkspaceTaskCompletion(doc, 'split-work', new Date('2026-09-17T12:01:00'))
  assert.equal(selectTask(reopened, 'split-work')!.complete, false)
  assert.equal(blocks(reopened).length, 3)
  const removed = executeTaskCommand(
    original,
    { type: 'task.unschedule', taskId: 'split-work', eventId: middle.id },
    context,
  )
  assert.equal(selectTask(removed, 'split-work')!.minutes, 240)
  const empty = executeTaskCommand(removed, { type: 'task.unschedule', taskId: 'split-work' }, context)
  assert.equal(selectTask(empty, 'split-work')!.minutes, 0)
  assert.equal(selectTask(empty, 'split-work')!.time, null)
  const invalid = structuredClone(original)
  const extra = invalid.entities.find((e) => e.kind === 'event' && e.id === middle.id)!
  ;(extra.data.content as Record<string, unknown>).taskId = 'missing'
  assert.throws(() => validateDocument(invalid), /calendar task reference/)
  return doc
}

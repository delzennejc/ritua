import { detachInactiveReferences, restoreInactiveReferences, restoreProject } from '../domain/workspace-organization'
import { syncAccomplishedObjectiveTasks } from '../domain/weekly-review'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openDatabase } from '../main/db/database'
import { recoveryFiles, readBackup } from '../main/recovery-files'
import { FlushCoordinator } from '../main/flush-coordinator'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project, changes, type Data } from '../domain/workspace'
import { mergeWorkspace } from '../domain/workspace-recovery'
import { extendRecurrences, rememberRecurrenceProgress } from '../domain/recurring-workspace'
import { recurrenceDateKeys, recurrenceForPreset } from '../domain/recurrence'

export async function testRecovery() {
  let requestId = ''
  const coordinator = new FlushCoordinator(id => { requestId = id }, 15)
  const pending = coordinator.request()
  assert.equal(coordinator.request(), pending)
  assert.equal(await pending, false, 'An unresponsive renderer has a bounded wait')
  assert.equal(coordinator.acknowledge(requestId, true), false, 'Late acknowledgements cannot close a newer request')
  const crashed = coordinator.request(); coordinator.rendererGone(); assert.equal(await crashed, false)
  const acknowledged = coordinator.request(); coordinator.acknowledge(requestId, true); assert.equal(await acknowledged, true)
  const base = emptyWorkspace('2026-09-07')
  const local = structuredClone(base); local.fields.view = 'week'
  const remote = structuredClone(base); remote.fields.planningStep = 2
  assert.equal(mergeWorkspace(base, local, remote).conflicts, 0)
  remote.fields.view = 'calendar'
  assert.ok(mergeWorkspace(base, local, remote).conflicts)
  assert.equal(mergeWorkspace(base, local, remote, 'remote').document.fields.view, 'calendar')
  assert.equal(mergeWorkspace(base, local, remote, 'local').document.fields.view, 'week')

  const rule = recurrenceForPreset('daily', '2026-01-01')
  const dates = recurrenceDateKeys('2026-01-01', rule as never, '2028-01-01')
  assert.ok(dates.length > 500, 'Ongoing recurrence cannot silently stop at occurrence 500')
  const fields = project(base)
  fields.tasks = [{ id: 'repeat', title: 'Recurring work', minutes: 30, complete: true, notes: 'Historical notes', actualMinutes: 18, comments: [{ id: 'c', text: 'History' }], recurrence: rule, recurrenceSeriesId: 'series', recurrenceIndex: 0, recurrenceStartDateKey: '2026-09-07' }]
  const remembered = rememberRecurrenceProgress(normalize(fields))
  const extended = extendRecurrences(remembered, '2027-09-08')
  const historical = extended.entities.find(e => e.id === 'repeat')!
  assert.equal((historical.data.content as Data).notes, 'Historical notes')
  assert.equal((historical.data.content as Data).complete, true)
  const generated = extended.entities.filter(e => e.kind === 'task' && e.id !== 'repeat')
  assert.ok(generated.length > 500)
  assert.ok(generated.every(e => !(e.data.content as Data).complete && !(e.data.content as Data).notes && !(e.data.content as Data).actualMinutes))
  const deleted = structuredClone(extended); deleted.entities = deleted.entities.filter(e => e.id !== generated[0]!.id)
  assert.ok(!extendRecurrences(deleted, '2027-09-09').entities.some(e => e.id === generated[0]!.id), 'Deleted occurrences never regenerate')
  const moved = structuredClone(remembered); moved.entities.find(e => e.id === 'repeat')!.data.lane = 'date:2030-01-01'
  assert.equal(rememberRecurrenceProgress(moved).fields.recurrenceProgress && (rememberRecurrenceProgress(moved).fields.recurrenceProgress as Data).series, '2026-09-07', 'Rescheduling cannot advance logical generation progress')
  const renamed = structuredClone(remembered); (renamed.entities.find(e => e.id === 'repeat')!.data.content as Data).title = 'Individual change'
  assert.equal((rememberRecurrenceProgress(renamed, remembered).entities.find(e => e.id === 'repeat')!.data.content as Data).recurrenceEdited, true)
  const soleDeleted = structuredClone(remembered); soleDeleted.entities = soleDeleted.entities.filter(e => e.id !== 'repeat')
  assert.ok(extendRecurrences(soleDeleted, '2027-09-08').entities.some(e => e.kind === 'task'), 'Deleting the only materialized occurrence must retain the independent series definition')
  const stopped = { ...remembered, fields: { ...remembered.fields, recurrenceStops: { series: true } } }
  assert.equal(extendRecurrences(stopped, '2030-01-01').entities.length, remembered.entities.length)
  const finite = { ...rule, end: { type: 'after', count: 600 } }
  assert.equal(recurrenceDateKeys('2026-01-01', finite as never, '2028-01-01').length, 600)
  assert.equal(recurrenceDateKeys('2026-01-01', { ...rule, end: { type: 'on', date: '2026-01-03' } } as never, '2028-01-01').length, 3)

  const exception = structuredClone(extended)
  const lastOccurrence = exception.entities.filter(e => e.kind === 'task').at(-1)!
  ;(lastOccurrence.data.content as Data).title = 'Only this occurrence'
  ;(lastOccurrence.data.content as Data).minutes = 99
  const renewed = extendRecurrences(rememberRecurrenceProgress(exception, extended), '2028-09-08')
  assert.ok(renewed.entities.filter(e => e.kind === 'task' && !exception.entities.some(old => old.id === e.id)).every(e => (e.data.content as Data).title === 'Recurring work' && (e.data.content as Data).minutes === 30), 'Last occurrence exceptions must not contaminate later renewal')
  const organization = project(base)
  organization.tasks = [{ id: 'same-1', title: 'Same title', minutes: 15 }]
  organization.archivedObjectives = [{ id: 'archived', channel: 'Work', title: 'Archived', archivePosition: 0, archiveWeeklyOrderIndex: 0, archivedSeriesIds: ['series'], tasks: [{ id: 'mirror', taskId: 'same-1', title: 'Same title' }] }]
  organization['weekly.accomplishedObjectives'] = structuredClone(organization.archivedObjectives)
  organization.recurrenceDefinitions = { series: { task: { id: 'template' }, event: null } }
  const detached = detachInactiveReferences(organization, ['same-1'])
  detached.fields.tasks = []
  assert.ok(!normalize(detached.fields).entities.some(e => e.kind === 'task' && e.id === 'same-1'), 'Inactive references cannot resurrect deleted tasks')
  const undone = restoreInactiveReferences(detached.fields, detached.removed)
  assert.ok(normalize(undone).entities.some(e => e.id === 'same-1'), 'Undo restores inactive project references')
  const work = (organization.areas as Data[]).find(area => area.label === 'Work')!
  organization.areas = (organization.areas as Data[]).filter(area => area !== work)
  organization.archivedAreas = [{ area: work, position: 0 }]
  const restoredProject = restoreProject(organization, 'archived')
  assert.ok((restoredProject.areas as Data[]).some(area => area.id === work.id))
  assert.equal((restoredProject.tasks as Data[])[0]!.objectiveId, 'archived')
  assert.equal((((restoredProject.recurrenceDefinitions as Data).series as Data).task as Data).objectiveId, 'archived')
  assert.ok((restoredProject.weeklyObjectiveOrder as string[]).includes('archived'))
  const review = syncAccomplishedObjectiveTasks([{ tasks: [{ taskId: 'a', title: 'Same', minutes: 1 }, { taskId: 'b', title: 'Same', minutes: 2 }] }], [{ tasks: [{ id: 'a', title: 'Renamed', complete: true, minutes: 30 }, { id: 'b', title: 'Same', complete: true, minutes: 60 }] }])
  assert.deepEqual((review[0]!.tasks as Data[]).map(task => [task.title, task.minutes]), [['Renamed', 30], ['Same', 60]], 'Identical titles and renamed tasks keep canonical identity')

  const directory = await mkdtemp(join(tmpdir(), 'ritua-recovery-test-'))
  const db = openDatabase(join(directory, 'workspace.sqlite'))
  try {
    const service = recoveryFiles(directory, db)
    const start = db.loadWorkspace()
    const invalid = structuredClone(start); (invalid.entities[0]!.data.content as Data).notes = 'x'.repeat(200001)
    assert.throws(() => db.commitWorkspace(changes(start, invalid, 'invalid')), /Text is too long/)
    const corrected = structuredClone(start); (corrected.entities[0]!.data.content as Data).notes = 'Corrected'
    const command = changes(start, corrected, 'valid')
    const saved = db.commitWorkspace(command)
    assert.deepEqual(db.commitWorkspace(command), saved, 'Unknown acknowledgements can retry idempotently')
    await service.writeRecovery({ base, local, savedAt: new Date().toISOString() })
    const recovered = await service.readRecovery()
    assert.deepEqual(recovered?.local, local)
    await writeFile(join(directory, 'pending-edits.json'), '{broken')
    await assert.rejects(service.readRecovery(), /preserved/)
    await service.writeRecovery(null)
    const preserved = (await readdir(directory)).find(name => name.startsWith('pending-edits.json.preserved-'))!
    assert.equal(await readFile(join(directory, preserved), 'utf8'), '{broken')
    const bytes = Buffer.from('Real attachment bytes\0\xff')
    db.addAttachment({ id: 'file-one', name: 'sample.bin', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes })
    const backup = await service.createBackup()
    assert.deepEqual(readBackup(service.backupPath(backup.id)).attachments[0]!.content, bytes)
    const before = db.loadWorkspace()
    const changed = structuredClone(before); changed.fields.view = 'week'
    db.commitWorkspace(changes(before, changed, 'after-backup'))
    await service.restoreBackup(service.backupPath(backup.id))
    assert.equal(db.loadWorkspace().fields.view, before.fields.view)
    assert.deepEqual(db.readAttachment('file-one')?.content, bytes)
    assert.ok((await service.listBackups()).some(item => item.id.endsWith('-before-restore.sqlite')))
    const stored = db.loadWorkspace(), profiled = structuredClone(stored)
    profiled.fields.profile = { displayName: 'Test Person', avatar: '' }
    db.commitWorkspace(changes(stored, profiled, 'profile-save'))
    assert.equal((db.loadWorkspace().fields.profile as Data).displayName, 'Test Person')
    const badProfile = structuredClone(db.loadWorkspace()); badProfile.fields.profile = { displayName: ' ', avatar: 'https://tracking.invalid/avatar' }
    assert.throws(() => db.commitWorkspace(changes(db.loadWorkspace(), badProfile, 'profile-invalid')))
    const addFile = (id: string) => db.addAttachment({ id, name: 'draft.bin', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes })
    addFile('canceled'); db.discardAttachment('canceled'); assert.equal(db.readAttachment('canceled'), undefined)
    addFile('saved-file')
    const attachmentBase = db.loadWorkspace(), withFile = structuredClone(attachmentBase)
    ;(withFile.entities[0]!.data.content as Data).comments = [{ attachment: { id: 'saved-file', name: 'draft.bin', size: bytes.length } }]
    db.commitWorkspace(changes(attachmentBase, withFile, 'attach-file'))
    db.discardAttachment('saved-file'); assert.ok(db.readAttachment('saved-file'), 'Discard must not delete a saved attachment')
    addFile('old-orphan'); addFile('open-draft'); addFile('recovery-file')
    const later = Date.now() + 25 * 60 * 60 * 1000
    db.collectAttachments(new Set(['open-draft', 'recovery-file']), later)
    assert.equal(db.readAttachment('old-orphan'), undefined, 'Expired unused bytes are reclaimed')
    assert.ok(db.readAttachment('saved-file') && db.readAttachment('open-draft') && db.readAttachment('recovery-file'), 'Saved, active drafts and pending recovery bytes survive collection')
    const restored = db.loadWorkspace()
    const bad = join(directory, 'bad.sqlite'); await writeFile(bad, 'not a database')
    await assert.rejects(service.restoreBackup(bad))
    assert.deepEqual(db.loadWorkspace(), restored, 'A damaged backup cannot change saved work')
  } finally { db.close(); await rm(directory, { recursive: true, force: true }) }
}

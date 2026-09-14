import { executeTaskCommand } from '../domain/task-commands'
import type { RecoveryDraft } from '../domain/workspace-recovery'
import type { WorkspaceCommit } from '../domain/workspace-types'
import type { WorkspaceBridge } from '../renderer/src/desktop/workspace-session'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceSession } from '../renderer/src/desktop/workspace-session'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, applyChanges } from '../domain/workspace'

function storage() {
  let saved = emptyWorkspace()
  let recovery: RecoveryDraft | null = null
  const commands: WorkspaceCommit[] = []
  const receipts = new Map<string, number>()
  const bridge: WorkspaceBridge = {
    async loadWorkspace() {
      return structuredClone(saved)
    },
    async readRecovery() {
      return recovery
    },
    async writeRecovery(value) {
      recovery = value
    },
    async saveWorkspace(command) {
      commands.push(command)
      if (receipts.has(command.requestId)) return { ok: true, revision: receipts.get(command.requestId)! }
      saved = applyChanges(saved, command)
      receipts.set(command.requestId, saved.revision)
      return { ok: true, revision: saved.revision }
    },
  }
  return { bridge, commands, read: () => saved, recovery: () => recovery }
}

test('commands publish one canonical update and derive every task view', async () => {
  const db = storage(),
    session = createWorkspaceSession(db.bridge)
  try {
    await session.initializeWorkspace()
    const context = { today: String(session.getFields().workspaceDate), now: new Date(), actor: 'Test' }
    session.replaceWorkspaceDocument(
      executeTaskCommand(
        session.getDocument(),
        { type: 'task.create', tasks: [{ task: { id: 'task', title: 'First' }, lane: 'today' }] },
        context,
      ),
    )
    session.setField('weeklyObjectives', [
      { id: 'project', title: 'Project', tasks: [{ id: 'member', taskId: 'task', title: 'First' }] },
    ])
    await session.flushWorkspace()
    let updates = 0
    const unsubscribe = session.workspaceStore.subscribe(() => {
      updates++
    })
    session.replaceWorkspaceDocument(
      executeTaskCommand(
        session.getDocument(),
        {
          type: 'task.move',
          taskId: 'task',
          lane: 'date:2027-01-01',
          preparedTask: { id: 'task', title: 'Moved' },
        },
        context,
      ),
    )
    await Promise.resolve()
    assert.equal(updates, 1, 'No intermediate half-move reaches subscribers')
    unsubscribe()
    const state = session.workspaceStore.getState()
    assert.equal(state.document!.entities.filter((entity) => entity.kind === 'task').length, 1)
    assert.equal(
      (session.getFields().weeklyObjectives as { tasks: { title: string }[] }[])[0]!.tasks[0]!.title,
      'Moved',
    )
    await session.flushWorkspace()
  } finally {
    session.dispose()
  }
})

test('a lost acknowledgement retries the same command without duplicating a commit', async () => {
  const db = storage()
  const save = db.bridge.saveWorkspace
  let lose = false
  db.bridge.saveWorkspace = async (command) => {
    const result = await save(command)
    if (lose) {
      lose = false
      throw new Error('Lost acknowledgement')
    }
    return result
  }
  const session = createWorkspaceSession(db.bridge)
  try {
    await session.initializeWorkspace()
    await session.flushWorkspace()
    session.setField('view', 'backlog')
    lose = true
    await assert.rejects(session.flushWorkspace(), /Lost acknowledgement/)
    const revision = db.read().revision
    await session.flushWorkspace()
    assert.equal(db.read().revision, revision)
    assert.equal(db.commands.at(-1)!.requestId, db.commands.at(-2)!.requestId)
    assert.equal(session.workspaceStore.getState().error, null)
  } finally {
    session.dispose()
  }
})

test('close restores an unfinished gesture before saving and waits for pending media', async () => {
  const db = storage()
  let prepared = false
  const session = createWorkspaceSession(db.bridge, {
    async prepareClose() {
      prepared = true
    },
  })
  try {
    await session.initializeWorkspace()
    await session.flushWorkspace()
    const before = structuredClone(session.getFields())
    session.beginWorkspaceGesture()
    session.setField('view', 'backlog')
    await session.flushBeforeClose()
    assert.equal(prepared, true)
    assert.deepEqual(session.getFields(), before)
    assert.equal(db.recovery(), null)
  } finally {
    session.dispose()
  }
})

test('projections are immutable and invalid commands cannot replace the valid document', async () => {
  const db = storage(),
    session = createWorkspaceSession(db.bridge)
  try {
    await session.initializeWorkspace()
    await session.flushWorkspace()
    const before = session.workspaceStore.getState().document
    const fields = session.getFields()
    assert.ok(Object.isFrozen(fields))
    assert.throws(() => {
      ;(fields.tasks as unknown[]).push({ id: 'rogue' })
    }, TypeError)
    assert.throws(
      () =>
        session.replaceWorkspaceDocument(
          normalize({
            ...fields,
            tasks: [{ id: 'invalid', title: 'Bad duration', minutes: -5 }],
          }),
        ),
      /duration/,
    )
    assert.equal(session.workspaceStore.getState().document, before)
    assert.equal(session.getFields(), fields)
    await session.flushWorkspace()
    assert.equal(
      db.read().entities.some((e) => e.id === 'invalid'),
      false,
    )
  } finally {
    session.dispose()
  }
})

test('edits made while a save is awaiting acknowledgement are committed afterward', async () => {
  const db = storage(),
    session = createWorkspaceSession(db.bridge)
  try {
    await session.initializeWorkspace()
    await session.flushWorkspace()
    const original = db.bridge.saveWorkspace
    let release!: () => void
    let entered!: () => void
    const saving = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hold = true
    db.bridge.saveWorkspace = async (command) => {
      if (hold) {
        hold = false
        entered()
        await gate
      }
      return original(command)
    }
    session.setField('view', 'backlog')
    const flushing = session.flushWorkspace()
    await saving
    session.setField('navigationOpen', false)
    release()
    await flushing
    assert.equal(db.read().fields.view, 'backlog')
    assert.equal(db.read().fields.navigationOpen, false)
    assert.equal(session.getFields().navigationOpen, false)
  } finally {
    session.dispose()
  }
})

test('recovery writes are ordered, deduplicated and retain the newest checkpoint', async () => {
  const db = storage(),
    session = createWorkspaceSession(db.bridge)
  try {
    await session.initializeWorkspace()
    await session.flushWorkspace()
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve
      })
    const writes: (RecoveryDraft | null)[] = []
    let active = 0,
      maxActive = 0,
      hold = true
    db.bridge.writeRecovery = async (draft) => {
      active++
      maxActive = Math.max(maxActive, active)
      if (hold) {
        hold = false
        entered()
        await gate
      }
      writes.push(draft)
      active--
    }
    session.setField('view', 'backlog')
    const first = session.checkpointRecovery()
    await started
    session.setField('navigationOpen', false)
    const second = session.checkpointRecovery()
    release()
    await Promise.all([first, second])
    assert.equal(maxActive, 1)
    assert.equal(writes.at(-1)!.local.fields.navigationOpen, false)
    const count = writes.length
    await session.checkpointRecovery()
    assert.equal(writes.length, count, 'An unchanged checkpoint is not serialized and written again')
    await session.flushBeforeClose()
    assert.equal(writes.at(-1), null)
  } finally {
    session.dispose()
  }
})

test('a failed checkpoint is retried and does not suppress the next recovery copy', async () => {
  const db = storage(),
    session = createWorkspaceSession(db.bridge)
  try {
    await session.initializeWorkspace()
    await session.flushWorkspace()
    let calls = 0
    db.bridge.writeRecovery = async () => {
      if (++calls === 1) throw new Error('Disk unavailable')
    }
    session.setField('navigationOpen', false)
    await assert.rejects(session.checkpointRecovery(), /Disk unavailable/)
    await session.checkpointRecovery()
    assert.equal(calls, 2)
    assert.equal(session.workspaceStore.getState().recoveryWarning, null)
  } finally {
    session.dispose()
  }
})

test('opening existing sessions arranges and saves their shared board order', async () => {
  const db = storage()
  const first = createWorkspaceSession(db.bridge)
  try {
    await first.initializeWorkspace()
    const fields = first.getFields()
    first.replaceWorkspaceDocument(
      normalize(
        {
          ...fields,
          tasks: [
            { id: 'free', title: 'Unscheduled' },
            { id: 'second', title: 'Second' },
            { id: 'nine', title: 'At nine', time: '09:00' },
            { id: 'first', title: 'First' },
          ],
          events: [
            {
              id: 'session',
              title: 'Focus',
              kind: 'session',
              dateKey: fields.workspaceDate,
              start: 600,
              end: 750,
              taskIds: ['first', 'second'],
            },
          ],
        },
        first.getDocument().revision,
      ),
    )
    await first.flushWorkspace()
  } finally {
    first.dispose()
  }
  const reopened = createWorkspaceSession(db.bridge)
  try {
    await reopened.initializeWorkspace()
    const tasks = reopened.getFields().tasks as { id: string }[]
    assert.deepEqual(
      tasks.map((task) => task.id),
      ['nine', 'first', 'second', 'free'],
    )
    await reopened.flushWorkspace()
    const persisted = db
      .read()
      .entities.filter((entity) => entity.kind === 'task')
      .sort((a, b) => Number(a.data.position) - Number(b.data.position))
    assert.deepEqual(
      persisted.map((task) => task.id),
      ['nine', 'first', 'second', 'free'],
    )
  } finally {
    reopened.dispose()
  }
})

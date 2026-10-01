import assert from 'node:assert/strict'
import test from 'node:test'
import { COMPLETION_PAUSE_MS, createCompletionQueue } from '../renderer/src/desktop/pending-completions'
import { readCompletionTarget } from '../renderer/src/desktop/completion-target'
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'

test('completion targets resolve canonical tasks, subtasks and projects with prefixed entity identities', () => {
  const task = {
    id: 'task',
    title: 'Task',
    complete: false,
    subtasks: [{ id: 'subtask', title: 'Step', complete: true }],
  }
  const document = normalize({
    ...project(emptyWorkspace('2026-10-01')),
    tasks: [task],
    weeklyObjectives: [{ id: 'project', title: 'Project', complete: false, tasks: [task] }],
  })
  assert.equal(readCompletionTarget(document, { taskId: 'task' }), false)
  assert.equal(readCompletionTarget(document, { taskId: 'task', subtaskId: 'subtask' }), true)
  assert.equal(readCompletionTarget(document, { projectId: 'project' }), false)
  assert.equal(readCompletionTarget(document, { taskId: 'deleted' }), undefined)
  assert.equal(readCompletionTarget(document, { projectId: 'deleted' }), undefined)
})

function fixture() {
  let time = 0
  const timers = new Map<ReturnType<typeof setTimeout>, { due: number; callback: () => void }>()
  let serial = 0
  const errors: unknown[] = []
  const queue = createCompletionQueue({
    schedule(callback, delay) {
      const id = ++serial as unknown as ReturnType<typeof setTimeout>
      timers.set(id, { due: time + delay, callback })
      return id
    },
    cancel: (id) => {
      timers.delete(id)
    },
    onError: (error) => errors.push(error),
  })
  const advance = (elapsed: number) => {
    time += elapsed
    for (const [id, timer] of [...timers]) {
      if (timer.due > time) continue
      timers.delete(id)
      timer.callback()
    }
  }
  return { queue, advance, errors }
}

test('a completion stays in its canonical location for 800ms and applies once after the check animation', () => {
  const { queue, advance } = fixture()
  let complete = false
  let calls = 0
  queue.enqueue('task', {
    read: () => complete,
    apply: () => {
      complete = true
      calls++
    },
  })
  queue.enqueue('task', {
    read: () => complete,
    apply: () => {
      calls++
    },
  })
  assert.equal(queue.isPending('task'), true)
  advance(COMPLETION_PAUSE_MS - 1)
  assert.equal(complete, false)
  advance(1)
  assert.equal(complete, true)
  assert.equal(calls, 1)
  assert.equal(queue.hasPending(), false)
})

test('unchecking during the pause cancels without applying a completion later', () => {
  const { queue, advance } = fixture()
  let calls = 0
  queue.enqueue('task', {
    read: () => false,
    apply: () => {
      calls++
    },
  })
  advance(200)
  queue.cancel('task')
  advance(1000)
  assert.equal(calls, 0)
  assert.equal(queue.hasPending(), false)
})

test('save and close flush every pending completion exactly once, while external changes supersede stale clicks', () => {
  const { queue, advance } = fixture()
  let calls = 0
  for (const key of ['task', 'project'])
    queue.enqueue(key, {
      read: () => false,
      apply: () => {
        calls++
      },
    })
  queue.enqueue('already-complete', {
    read: () => true,
    apply: () => {
      throw new Error('Must not reopen')
    },
  })
  queue.enqueue('deleted', {
    read: () => undefined,
    apply: () => {
      throw new Error('Must not resurrect')
    },
  })
  queue.flush()
  assert.equal(calls, 2)
  assert.equal(queue.hasPending(), false)
  advance(1000)
  assert.equal(calls, 2)
})

test('a rejected delayed command clears its pending state and close reports the rejection', () => {
  const { queue, advance, errors } = fixture()
  const apply = () => {
    throw new Error('Rejected completion')
  }
  queue.enqueue('task', { read: () => false, apply })
  advance(COMPLETION_PAUSE_MS)
  assert.equal(errors.length, 1)
  assert.equal(queue.hasPending(), false)
  queue.enqueue('project', { read: () => false, apply })
  assert.throws(() => queue.flush(), /Rejected completion/)
  assert.equal(errors.length, 2)
  assert.equal(queue.hasPending(), false)
})

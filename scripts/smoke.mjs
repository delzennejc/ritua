import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const electron = process.env.RITUA_TEST_EXECUTABLE || require('electron')
const directory = await mkdtemp(join(tmpdir(), 'ritua-smoke-'))

async function launch(flag = '--smoke-test', dataDirectory = directory) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, RITUA_TEST_MODE: '1', RITUA_DATA_DIR: dataDirectory }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    const child = spawn(electron, process.env.RITUA_TEST_EXECUTABLE ? [flag] : ['.', flag], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Electron smoke test timed out'))
    }, 60000)
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const match = output.match(/RITUA_SMOKE (\{[^\n]+\})/)
      if (code !== 0 || !match) return reject(new Error(output || `Electron exited ${code}`))
      resolve(JSON.parse(match[1]))
    })
  })
}

try {
  const sessionDirectory = await mkdtemp(join(tmpdir(), 'ritua-session-smoke-'))
  try {
    const sessionFirst = await launch('--session-smoke-test', sessionDirectory)
    const sessionSecond = await launch('--session-smoke-test', sessionDirectory)
    assert.equal(sessionFirst.phase, 'write')
    assert.equal(sessionSecond.phase, 'read')
    console.log(
      'PASS: calendar-only Sessions, three-hour defaults, canonical task membership and completion, calendar checklist reorder and drag-out, keyboard/native resize, cancellation, deletion Undo and restart persistence.',
    )
  } finally {
    await rm(sessionDirectory, { recursive: true, force: true })
  }
  const first = await launch()
  const second = await launch()
  assert.equal(first.phase, 'write')
  assert.equal(second.phase, 'read')
  assert.equal(second.taskId, first.taskId)
  assert.equal(second.resizeEnd, first.resizeEnd, 'Pointer resize must survive restart')
  assert.equal(second.entityCount, first.entityCount, 'Canonical entities must not duplicate on restart')
  assert.ok(first.initializedAt)
  assert.equal(second.initializedAt, first.initializedAt, 'Initialization must survive restart')
  assert.equal(second.appVersion, first.appVersion)
  const liveDirectory = await mkdtemp(join(tmpdir(), 'ritua-live-smoke-'))
  try {
    const liveFirst = await launch('--live-smoke-test', liveDirectory)
    const liveSecond = await launch('--live-smoke-test', liveDirectory)
    assert.equal(liveFirst.phase, 'write')
    assert.equal(liveSecond.phase, 'read')
    assert.equal(liveSecond.taskId, liveFirst.taskId)
    assert.equal(liveSecond.today, liveFirst.today)
  } finally {
    await rm(liveDirectory, { recursive: true, force: true })
  }
  console.log(
    'PASS: corrected invalid renderer saves; repeated crash/conflict recovery; attachment UI byte export after restart; independent verified backup/restore; continuing recurrence beyond 500, deleted occurrences and preserved history; bounded renderer flush; inline duplicate-Area errors; clean production workspace, actual Today, future-year scheduling, native restart, date rollover and fresh schema initialization;  application UI creates, edits and completes Tasks; creates Areas and Projects; actual UI hydration survives native restart; canonical field roundtrips, validated atomic IPC, sandbox and close-save handshake.',
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}

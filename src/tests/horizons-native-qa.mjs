// Run explicitly after `npm run qa -- start`; uses only that session's isolated database.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const session = JSON.parse(await readFile('build/qa/session.json', 'utf8'))
assert.match(session.dataDirectory, /ritua-qa-/)
const targets = await (await fetch(`http://127.0.0.1:${session.controlPort}/json/list`)).json()
const target = targets.find((item) => item.type === 'page' && item.url.startsWith(session.origin))
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let serial = 0
const pending = new Map()
const errors = []
socket.onmessage = ({ data }) => {
  const result = JSON.parse(data)
  if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.text)
  const call = pending.get(result.id)
  if (!call) return
  pending.delete(result.id)
  if (result.error) call.reject(new Error(JSON.stringify(result.error)))
  else call.resolve(result.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++serial
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const check = async (expression) => {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(expression)) return
    await delay(50)
  }
  throw new Error(`Check failed: ${expression}`)
}
const fixture = `await import(${JSON.stringify(`/@fs${resolve('src/tests/horizons-performance-qa.js')}`)})`
const store = fixture
const row = (id) => `document.querySelector('[data-task-layout-id="${id}"]')`
const clickNav = (label) =>
  evaluate(
    `[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`,
  )
const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`build/qa/shots/${name}.png`, Buffer.from(result.data, 'base64'))
}
const key = async (key, code, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    windowsVirtualKeyCode: code,
    modifiers,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: key,
    windowsVirtualKeyCode: code,
    modifiers,
  })
}
const drag = async (id, nextId, cancel = false) => {
  const from = await evaluate(
    `(()=>{const r=${row(id)}.getBoundingClientRect();return {x:r.left+220,y:r.top+r.height/2}})()`,
  )
  const to = await evaluate(
    `(()=>{const r=${row(nextId)}.getBoundingClientRect();return {x:r.left+220,y:r.bottom-2}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...from,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  for (let step = 1; step <= 12; step++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + ((to.x - from.x) * step) / 12,
      y: from.y + ((to.y - from.y) * step) / 12,
      button: 'left',
      buttons: 1,
    })
    await delay(20)
  }
  if (cancel) await key('Escape', 27)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...to,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await delay(100)
}

try {
  await send('Runtime.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const initialLoad = await evaluate('performance.timeOrigin')
  await send('Page.reload')
  await check(`performance.timeOrigin!==${initialLoad} && Boolean(document.querySelector('.app-shell'))`)
  const measurements = []
  for (const [count, horizon, projectSize = 0] of [
    [2000, 'Anytime'],
    [10000, 'Anytime'],
    [10000, 'Someday'],
    [10000, 'Scheduled'],
    [2000, 'Anytime', 50],
  ]) {
    const seeded = await evaluate(
      `(async()=>(${fixture}).seedHorizonsPerformance(${count},${JSON.stringify(horizon)},${projectSize}))()`,
    )
    assert.equal(seeded.horizon, horizon)
    assert.equal(
      await evaluate(
        `(async()=>{const fields=(${store}).getWorkspaceFields();return ${horizon === 'Scheduled' ? 'Object.values(fields.datedTasksByDate).flat().length' : `fields.backlogGroups.find(g=>g.label===${JSON.stringify(horizon)}).items.length`}})()`,
      ),
      count,
    )
    const times = await evaluate(
      `(async()=>(${fixture}).measureHorizonsNavigation(5,${JSON.stringify(horizon)}))()`,
    )
    measurements.push({ count, horizon, projectSize, times })
    console.log(JSON.stringify(measurements.at(-1)))
    assert.ok(
      times.every((time) => time.ms < 200),
      `${horizon} exceeded 200ms`,
    )
    if (projectSize) {
      await clickNav(horizon)
      await check(`Boolean(${row('qa-horizon-0')})`)
      assert.ok(await evaluate(`document.querySelectorAll('.backlog-row').length < 80`))
      await shot('horizons-many-projects')
    }
  }
  await writeFile('build/qa/horizons-performance.json', JSON.stringify(measurements, null, 2))
  await evaluate(`(async()=>(${fixture}).seedHorizonsPerformance(10000))()`)
  await clickNav('Anytime')
  await check(`Boolean(${row('qa-horizon-0')})`)
  assert.ok(await evaluate(`document.querySelectorAll('.backlog-row').length < 80`))
  await shot('horizons-large-top')
  // A portal picker must retain its source while the window scrolls.
  await evaluate(
    `(()=>{const button=${row('qa-horizon-0')}.querySelector('.backlog-project-trigger');button.focus();button.click()})()`,
  )
  await check(`Boolean(document.querySelector('.dropdown-menu'))`)
  await evaluate(`document.querySelector('.backlog-view').scrollTop=45000`)
  await check(`Boolean(${row('qa-horizon-1000')})`)
  assert.ok(await evaluate(`Boolean(${row('qa-horizon-0')})`))
  await key('Escape', 27)
  await check(`!document.querySelector('.dropdown-menu')`)
  // Native Tab reaches the next unmounted task, and Shift+Tab returns to its predecessor.
  const last = await evaluate(
    `(()=>{const list=document.querySelector('[data-task-window-count]');const rows=[...list.querySelectorAll('[data-task-layout-id]')];return rows.at(-1).dataset.taskLayoutId})()`,
  )
  const nextId = `qa-horizon-${Number(last.split('-').at(-1)) + 1}`
  await evaluate(`${row(last)}.querySelector('.backlog-task-title').focus({preventScroll:true})`)
  await key('Tab', 9)
  await check(
    `document.activeElement.closest('[data-task-layout-id]')?.dataset.taskLayoutId===${JSON.stringify(nextId)}`,
  )
  await key('Tab', 9, 8)
  await check(
    `document.activeElement.closest('[data-task-layout-id]')?.dataset.taskLayoutId===${JSON.stringify(last)}`,
  )
  // Reordering uses canonical indices far beyond the initial mounted window.
  await evaluate(`document.activeElement.blur();document.querySelector('.backlog-view').scrollTop=46000`)
  await delay(150)
  const [first, second] = await evaluate(
    `(()=>{const root=document.querySelector('.backlog-view');const bounds=root.getBoundingClientRect();return [...document.querySelectorAll('.backlog-row')].filter(e=>{const r=e.getBoundingClientRect();return r.top>bounds.top+70&&r.bottom<bounds.bottom-70}).slice(0,2).map(e=>e.dataset.taskLayoutId)})()`,
  )
  assert.ok(first && second)
  await shot('horizons-large-middle')
  const order = await evaluate(
    `(async()=>(${store}).getWorkspaceFields().backlogGroups[0].items.map(t=>t.id))()`,
  )
  await drag(first, second)
  await check(
    `(async()=>{const ids=(${store}).getWorkspaceFields().backlogGroups[0].items.map(t=>t.id);return ids.indexOf(${JSON.stringify(first)})===${order.indexOf(first) + 1}})()`,
  )
  const reordered = await evaluate(
    `(async()=>(${store}).getWorkspaceFields().backlogGroups[0].items.map(t=>t.id))()`,
  )
  await drag(second, first, true)
  assert.deepEqual(
    await evaluate(`(async()=>(${store}).getWorkspaceFields().backlogGroups[0].items.map(t=>t.id))()`),
    reordered,
  )
  // Selection includes the full collection, including unmounted rows.
  await evaluate(`document.querySelector('.backlog-toolbar button[aria-pressed]').click()`)
  await evaluate(
    `[...document.querySelectorAll('.backlog-toolbar button')].find(e=>e.textContent==='Select all').click()`,
  )
  await check(`document.querySelector('.backlog-selection-count').textContent.includes('10000 selected')`)
  await evaluate(`document.querySelector('.backlog-toolbar button[aria-pressed]').click()`)
  // The final row is reachable, opens details, and gets focus back on close.
  await evaluate(
    `document.activeElement.blur();const root=document.querySelector('.backlog-view');root.scrollTop=root.scrollHeight`,
  )
  await check(`Boolean(${row('qa-horizon-9999')})`)
  await shot('horizons-large-bottom')
  await evaluate(`${row('qa-horizon-9999')}.querySelector('.backlog-task-title').click()`)
  await check(`Boolean(document.querySelector('[aria-label="Close task details"]'))`)
  await evaluate(`document.querySelector('[aria-label="Close task details"]').click()`)
  await check(`document.activeElement.dataset.taskTitleId==='qa-horizon-9999'`)
  // Reflow measures wrapped titles again and keeps adjacent rows contiguous.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1050,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await delay(150)
  assert.ok(
    await evaluate(
      `(()=>{const root=document.querySelector('.backlog-view');const rows=[...root.querySelectorAll('.backlog-row')];return rows.every((e,i)=>!i||Math.abs(e.getBoundingClientRect().top-rows[i-1].getBoundingClientRect().bottom)<1)})()`,
    ),
  )
  await shot('horizons-large-narrow')
  await evaluate(`(async()=>(${store}).flushWorkspace())()`)
  const previous = await evaluate('performance.timeOrigin')
  await send('Page.reload')
  await check(`performance.timeOrigin!==${previous} && Boolean(document.querySelector('.backlog-view'))`)
  assert.deepEqual(
    await evaluate(`(async()=>(${store}).getWorkspaceFields().backlogGroups[0].items.map(t=>t.id))()`),
    reordered,
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS: bounded rows, wrapped heights, focus, full selection, native reorder/cancel, SQLite reload, and all navigation <200ms.',
  )
} finally {
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  socket.close()
}

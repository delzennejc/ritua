// Run explicitly against the isolated session created by `npm run qa -- start`.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
const fixtureUrl = `/@fs${resolve('src/tests/daily-review-qa.js')}`
const datesUrl = `/@fs${resolve('src/domain/calendar-dates.ts')}`
const session = JSON.parse(await readFile('build/qa/session.json', 'utf8'))
const targets = await (await fetch(`http://127.0.0.1:${session.controlPort}/json/list`)).json()
const target = targets.find((item) => item.type === 'page' && item.url.startsWith(session.origin))
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let serial = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const result = JSON.parse(data)
  const call = pending.get(result.id)
  if (!call) return
  pending.delete(result.id)
  if (result.error) call.reject(new Error(JSON.stringify(result.error)))
  else call.resolve(result.result)
}
const send = (method, params) =>
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
  for (let i = 0; i < 50; i++) {
    if (await evaluate(expression)) return
    await delay(50)
  }
  throw new Error(`Check failed: ${expression}`)
}
const selector = (id) => `[data-collection-item-id="${id}"]`
const card = (id) => `document.querySelector(${JSON.stringify(selector(id))})`
const task = (id) =>
  `(await window.ritua.loadWorkspace()).entities.find(e=>e.kind==='task'&&e.id===${JSON.stringify(id)}).data.content`
const click = async (expression) => {
  await evaluate(`${expression}.click()`)
  await delay(70)
}
const rect = (expression) =>
  evaluate(
    `(()=>{const e=${expression};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+Math.min(r.width*.7,r.width-20),y:r.y+14}})()`,
  )
const drag = async (id, targetExpression, cancel = false, revealCollapsedLane = false) => {
  const from = await rect(card(id))
  let to = await rect(targetExpression)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...from,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  if (revealCollapsedLane) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + 12,
      y: from.y,
      button: 'left',
      buttons: 1,
    })
    await delay(300)
    to = await rect(targetExpression)
  }
  for (let step = 1; step <= 24; step++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + ((to.x - from.x) * step) / 24,
      y: from.y + ((to.y - from.y) * step) / 24,
      button: 'left',
      buttons: 1,
    })
    await delay(25)
  }
  if (cancel) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    })
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...to,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await delay(120)
}
const lane = (label) => `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`
try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await evaluate(
    `(async()=>{const m=await import(${JSON.stringify(fixtureUrl)});await m.seedDailyReview()})()`,
  )
  await check(`document.querySelectorAll('.daily-review-area').length===5`)
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.daily-review-groups')).gridTemplateColumns.split(' ').length`,
    ),
    3,
  )
  // Shared card controls and retrospective completion.
  await click(`${card('qa-unfinished')}.querySelector('.subtask-toggle')`)
  await check(`(async()=>(${task('qa-unfinished')}).subtasks[0].complete)()`)
  await click(`${card('qa-personal-open')}.querySelector('.completion-toggle')`)
  await check(`(async()=>(${task('qa-personal-open')}).complete)()`)
  assert.equal(
    await evaluate(`(async()=>(${task('qa-personal-open')}).completedDateKey)()`),
    await evaluate(
      `(async()=>{const d=await import(${JSON.stringify(datesUrl)});return d.addDays(d.localDateKey(),-1)})()`,
    ),
  )
  await click(`document.querySelector('.undo-snackbar-action')`)
  await check(`(async()=>!(${task('qa-personal-open')}).complete)()`)
  // Actual pointer drag across area columns, then Undo.
  await drag('qa-personal-open', lane('Health To review'))
  await check(`(async()=>(${task('qa-personal-open')}).channel==='Health')()`)
  await click(`document.querySelector('.undo-snackbar-action')`)
  await check(`(async()=>(${task('qa-personal-open')}).channel==='Personal')()`)
  // Canceling a cross-area drag leaves canonical state unchanged.
  await drag('qa-personal-open', lane('Health To review'), true)
  assert.equal(await evaluate(`(async()=>(${task('qa-personal-open')}).channel)()`), 'Personal')
  // Actual drag to Done persists a retrospective completion.
  await drag('qa-health-0', lane('Health Done'))
  await check(`(async()=>(${task('qa-health-0')}).complete)()`)
  assert.equal(await evaluate(`(async()=>(${task('qa-health-0')}).completedAtMinute)()`), null)
  // Project-linked area drops retain the established confirmation.
  await drag('qa-unfinished', lane('Personal To review'))
  await check(`Boolean(document.querySelector('#daily-review-area-confirm'))`)
  assert.equal(await evaluate(`(async()=>(${task('qa-unfinished')}).channel)()`), 'Work')
  await click(`document.querySelector('#daily-review-area-confirm .secondary-button')`)
  await check(`!document.querySelector('#daily-review-area-confirm')`)
  // Reload verifies SQLite, then continue the ritual.
  await evaluate(`(async()=> (await import('/src/desktop/workspace-store.ts')).flushWorkspace())()`)
  const previousLoad = await evaluate('performance.timeOrigin')
  await send('Page.reload', {})
  await check(`performance.timeOrigin !== ${previousLoad} && Boolean(${card('qa-health-0')})`)
  await check(`(async()=>(${task('qa-health-0')}).complete)()`)
  assert.equal(
    await evaluate(`${card('qa-health-0')}.closest('.daily-review-lane').getAttribute('aria-label')`),
    'Health Done',
  )
  // Only the area under the pointer reveals its empty review lane.
  const healthShell = `${lane('Health To review')}.closest('.daily-review-lane-collapse')`
  await check(`${healthShell}.getBoundingClientRect().height < 0.5`)
  await click(`${card('qa-personal-open')}.querySelector('.completion-toggle')`)
  const personalShell = `${lane('Personal To review')}.closest('.daily-review-lane-collapse')`
  await check(`${personalShell}.getBoundingClientRect().height < 0.5`)
  const from = await rect(card('qa-health-0'))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...from,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: from.x + 12,
    y: from.y,
    button: 'left',
    buttons: 1,
  })
  await check(`${healthShell}.getBoundingClientRect().height > 80`)
  assert.ok(await evaluate(`${personalShell}.getBoundingClientRect().height < 0.5`))
  const personalHeader = await rect(`document.querySelector('[aria-label="Personal yesterday"] h3')`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...personalHeader,
    button: 'left',
    buttons: 1,
  })
  await check(`${personalShell}.getBoundingClientRect().height > 80`)
  await check(`${healthShell}.getBoundingClientRect().height < 0.5`)
  const hoverShot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-review-hover-personal.png', Buffer.from(hoverShot.data, 'base64'))
  const workHeader = await rect(`document.querySelector('[aria-label="Work yesterday"] h3')`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...workHeader,
    button: 'left',
    buttons: 1,
  })
  await check(`${personalShell}.getBoundingClientRect().height < 0.5`)
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...workHeader,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await delay(120)
  await check(`${healthShell}.getBoundingClientRect().height < 0.5`)
  assert.equal(await evaluate(`(async()=>(${task('qa-health-0')}).channel)()`), 'Health')
  // The revealed lane still accepts drops to reopen a task.
  await drag('qa-health-0', lane('Health To review'), false, true)
  await check(`(async()=>!(${task('qa-health-0')}).complete)()`)
  await check(`${healthShell}.getBoundingClientRect().height > 80`)
  // Sample geometry while the last card completes and Done takes its place.
  const motion = await evaluate(`(async()=>{
    const shell = ${healthShell}; const done = ${lane('Health Done')};
    const read = () => ({height:shell.getBoundingClientRect().height, top:done.getBoundingClientRect().top});
    const before = read(); ${card('qa-health-0')}.querySelector('.completion-toggle').click();
    const samples = []; const until = performance.now() + 350;
    while (performance.now() < until) { await new Promise(r=>requestAnimationFrame(r)); samples.push(read()); }
    return {before, after:read(), intermediate:samples.some(s=>s.height>1&&s.height<before.height-1)};
  })()`)
  assert.equal(motion.intermediate, true)
  assert.ok(motion.after.height < 0.5)
  assert.ok(Math.abs(motion.before.top - motion.before.height - motion.after.top) < 1)
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await click(`${card('qa-health-0')}.querySelector('.completion-toggle')`)
  assert.ok(await evaluate(`${healthShell}.getBoundingClientRect().height > 80`))
  assert.equal(await evaluate(`${healthShell}.getAnimations({subtree:true}).length`), 0)
  await click(`${card('qa-health-0')}.querySelector('.completion-toggle')`)
  assert.ok(await evaluate(`${healthShell}.getBoundingClientRect().height < 0.5`))
  await send('Emulation.setEmulatedMedia', { features: [] })
  console.log(
    'PASS: five areas / three columns; shared subtask and completion controls; cross-area drag; Undo; Escape cancellation; Done drop; project protection; native reload persistence; animated empty-lane collapse; hovered-area-only reveal; drag reopening; reduced motion.',
  )
} finally {
  await send('Emulation.setEmulatedMedia', { features: [] })
  socket.close()
}

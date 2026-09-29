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
const planIds = () =>
  evaluate(
    '[...document.querySelectorAll(".daily-plan-scroll [data-collection-item-id]")].map(n=>n.dataset.collectionItemId)',
  )
const availableIds = () =>
  evaluate(
    '[...document.querySelectorAll(".daily-source-scroll [data-collection-item-id]")].map(n=>n.dataset.collectionItemId)',
  )
const savedSelection = () =>
  evaluate('(async()=> (await window.ritua.loadWorkspace()).fields["daily.selection"])()')
const press = async (key, code = key) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code })
  await delay(150)
}
// The floating card must retain the source card's content, styling, and geometry.
const appearance = (expression) =>
  evaluate(`(()=>{
  const card=${expression}; const origin=card.getBoundingClientRect();
  const selectors=['.task-title','.task-meta','.daily-task-project','.daily-plan-task-controls','.daily-star'];
  const measure=(node)=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return {
    text:node.textContent, width:r.width,height:r.height,x:r.x-origin.x,y:r.y-origin.y,
    fontSize:s.fontSize,padding:s.padding,borderLeft:s.borderLeft,color:s.color
  }};
  return {card:measure(card),parts:selectors.map(selector=>{const node=card.querySelector(selector);return node?measure(node):null})};
})()`)
const checkDragAppearance = async (id) => {
  const from = await rect(card(id))
  const before = await appearance(card(id))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...from,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  const to = { x: from.x + 30, y: from.y + 10 }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1 })
  await check('Boolean(document.querySelector(".dnd-task-card-preview"))')
  await delay(200)
  const during = await appearance('document.querySelector(".dnd-task-card-preview")')
  assert.deepEqual(during, before, `${id}: dragging must preserve the card appearance`)
  assert.equal(await evaluate('document.querySelector(".dnd-task-card-preview").inert'), true)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`build/qa/shots/daily-plan-preview-${id}.png`, Buffer.from(shot.data, 'base64'))
  await press('Escape')
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
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await evaluate(
    `(async()=>{const m=await import(${JSON.stringify(fixtureUrl)});await m.seedDailyReview()})()`,
  )
  await check('Boolean(document.querySelector(".yesterday-review"))')
  await click('document.querySelectorAll(".daily-ritual-topline > button")[1]')
  assert.deepEqual(await planIds(), ['qa-draft', 'qa-review'])
  assert.equal(await evaluate('document.querySelectorAll("[data-collection-item-id=qa-draft]").length'), 1)
  const initialAvailable = await availableIds()
  await drag('qa-unfinished', card('qa-health-0'))
  assert.notDeepEqual(await availableIds(), initialAvailable)
  assert.ok((await availableIds()).indexOf('qa-unfinished') > (await availableIds()).indexOf('qa-health-0'))
  const reorderedAvailable = await availableIds()
  await drag('qa-unfinished', card('qa-personal-open'), true)
  assert.deepEqual(await availableIds(), reorderedAvailable)
  await delay(300)
  await evaluate(`${card('qa-unfinished')}.focus()`)
  await press(' ', 'Space')
  await press('ArrowUp')
  await press(' ', 'Space')
  assert.equal(
    (await availableIds()).indexOf('qa-unfinished'),
    reorderedAvailable.indexOf('qa-unfinished') - 1,
  )
  await drag('qa-unfinished', 'document.querySelector(".daily-plan-scroll")')
  await check('Boolean(document.querySelector(".daily-plan-scroll [data-collection-item-id=qa-unfinished]"))')
  assert.deepEqual((await savedSelection()).taskIds, ['qa-unfinished', 'qa-draft', 'qa-review'])
  assert.equal(
    await evaluate(
      '(async()=> (await window.ritua.loadWorkspace()).entities.find(e=>e.id==="qa-unfinished").data.lane)()',
    ),
    await evaluate(
      `(async()=>{const d=await import(${JSON.stringify(datesUrl)});return "date:"+d.addDays(d.localDateKey(),-1)})()`,
    ),
  )
  await drag('qa-unfinished', card('qa-review'))
  assert.equal((await planIds()).at(-1), 'qa-unfinished')
  await drag('qa-unfinished', card('qa-draft'))
  assert.equal((await planIds())[0], 'qa-unfinished')
  await click(`${card('qa-unfinished')}.querySelector('.daily-star')`)
  await checkDragAppearance('qa-draft')
  await checkDragAppearance('qa-unfinished')
  const beforeCancel = await savedSelection()
  await drag('qa-unfinished', 'document.querySelector(".daily-source-scroll")', true)
  assert.deepEqual(await savedSelection(), beforeCancel)
  await drag('qa-unfinished', 'document.querySelector(".daily-source-scroll")')
  assert.equal((await savedSelection()).highlightId, null)
  assert.equal((await savedSelection()).taskIds.includes('qa-unfinished'), false)
  assert.equal(
    await evaluate(
      'document.querySelector(".daily-source-group[aria-label=Anytime] [data-collection-item-id]").dataset.collectionItemId',
    ),
    'qa-unfinished',
  )
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".daily-source-group h3")].some(n=>n.textContent.includes("Already"))',
    ),
    false,
  )
  assert.equal(await evaluate('document.activeElement.dataset.collectionItemId'), 'qa-unfinished')
  // Filtering sources must not discard hidden tasks or selected cards.
  await evaluate(
    '(()=>{const n=document.querySelector(".daily-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(n,"dentist");n.dispatchEvent(new Event("input",{bubbles:true}))})()',
  )
  await delay(100)
  await drag('qa-personal-open', 'document.querySelector(".daily-plan-scroll")')
  assert.deepEqual((await savedSelection()).taskIds, ['qa-personal-open', 'qa-draft', 'qa-review'])
  await click('document.querySelector(".daily-search .icon-button")')
  await evaluate(`${card('qa-personal-open')}.focus()`)
  await press(' ', 'Space')
  await press('ArrowDown')
  await press(' ', 'Space')
  assert.deepEqual(await planIds(), ['qa-draft', 'qa-personal-open', 'qa-review'])
  await evaluate(`${card('qa-personal-open')}.focus()`)
  await press(' ', 'Space')
  await press('ArrowLeft')
  await press('Escape')
  assert.deepEqual(await planIds(), ['qa-draft', 'qa-personal-open', 'qa-review'])
  // Both empty panes remain usable drop destinations.
  for (const id of await planIds()) {
    await drag(id, 'document.querySelector(".daily-source-scroll")')
    assert.equal(
      await evaluate(
        'document.querySelector(".daily-source-group[aria-label=Anytime] [data-collection-item-id]").dataset.collectionItemId',
      ),
      id,
    )
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll(".daily-source-group h3")].some(n=>n.textContent.includes("Already"))',
      ),
      false,
    )
  }
  assert.deepEqual(await planIds(), [])
  await drag('qa-personal-open', 'document.querySelector(".daily-plan-scroll")')
  assert.deepEqual(await planIds(), ['qa-personal-open'])
  await drag('qa-unfinished', card('qa-personal-open'))
  const finalSelection = await savedSelection()
  const finalAvailable = await availableIds()
  await evaluate('(async()=> (await import("/src/desktop/workspace-store.ts")).flushWorkspace())()')
  const load = await evaluate('performance.timeOrigin')
  await send('Page.reload', {})
  await check(
    `performance.timeOrigin !== ${load} && Boolean(document.querySelector('.daily-plan-scroll [data-collection-item-id]'))`,
  )
  assert.deepEqual(await savedSelection(), finalSelection)
  assert.deepEqual(await availableIds(), finalAvailable)
  assert.equal(
    await evaluate(
      'document.querySelector(".daily-source-group[aria-label=Anytime] [data-collection-item-id]").dataset.collectionItemId',
    ),
    'qa-review',
  )
  assert.deepEqual(await planIds(), finalSelection.taskIds)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-plan-drag.png', Buffer.from(shot.data, 'base64'))
  console.log(
    'PASS: returns to top of Anytime with no redundant category, available-task pointer/keyboard reorder and cancellation, persisted source order, identical regular/highlight drag previews, pointer add/remove/reorder, Escape cancellation, highlight removal, unique cards, focus return, filtered-source drop, keyboard sorting, and reload persistence.',
  )
} finally {
  socket.close()
}

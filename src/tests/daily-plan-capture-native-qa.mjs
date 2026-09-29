// Run against the isolated, seeded Electron QA session.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const session = JSON.parse(await readFile('build/qa/session.json', 'utf8'))
const targets = await (await fetch(`http://127.0.0.1:${session.controlPort}/json/list`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith(session.origin))
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => {
  socket.onopen = resolve
})
let serial = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  if (message.error) call.reject(new Error(JSON.stringify(message.error)))
  else call.resolve(message.result)
}
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++serial
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
const nav = 'document.querySelectorAll(".daily-ritual-topline > button")'
const click = async (expression) => {
  const point = await evaluate(
    `(()=>{const node=(${expression});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  await delay(100)
}
const press = async (key) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    ...(key === 'Enter' ? { text: '\r', windowsVirtualKeyCode: 13 } : {}),
  })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
  await delay(100)
}
const titles = () =>
  evaluate('[...document.querySelectorAll(".daily-selected-task .task-title")].map(n=>n.textContent)')
try {
  await evaluate(
    '(async()=>{const m=await import("/@fs/Users/jc/ritua/src/tests/daily-review-qa.js");await m.seedDailyReview()})()',
  )
  await evaluate(
    '(async()=>{const s=await import("/src/desktop/workspace-store.ts");const {normalize}=await import("/@fs/Users/jc/ritua/src/domain/workspace.ts");const fields=structuredClone(s.getWorkspaceFields());fields.backlogGroups=fields.backlogGroups.map(g=>g.id==="anytime"?{...g,items:[]}:g);s.replaceWorkspaceDocument(normalize(fields))})()',
  )
  await delay(120)
  await click(`${nav}[1]`)
  await click('document.querySelector(".daily-star")')
  const initial = await titles()
  await click('document.querySelector(".daily-plan-scroll .inline-task-area-trigger")')
  await click(
    '[...document.querySelectorAll("[role=menuitemradio]")].find(n=>n.textContent.includes("Personal"))',
  )
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'New task')
  await send('Input.insertText', { text: 'Shared capture Enter' })
  await press('Enter')
  assert.deepEqual(await titles(), ['Shared capture Enter', ...initial])
  const created = await evaluate(
    '(async()=>{const s=await import("/src/desktop/workspace-store.ts");const d=s.getWorkspaceDocument();const e=d.entities.find(e=>e.kind==="task"&&e.data.content.title==="Shared capture Enter");return {lane:e.data.lane,area:e.data.content.channel,selected:d.fields["daily.selection"].taskIds.filter(id=>id===e.id).length,highlight:d.fields["daily.selection"].highlightId===e.id}})()',
  )
  assert.deepEqual(created, { lane: 'today', area: 'Personal', selected: 1, highlight: false })
  assert.equal(
    await evaluate('document.querySelector(".daily-selected-task").getAnimations().length > 0'),
    true,
  )
  await delay(300)
  await click('document.querySelector(".daily-plan-scroll .inline-task-start")')
  await send('Input.insertText', { text: 'Canceled capture' })
  await press('Escape')
  assert.deepEqual(await titles(), ['Shared capture Enter', ...initial])
  await click('document.querySelector(".daily-plan-scroll .inline-task-start")')
  await send('Input.insertText', { text: 'Shared capture blur' })
  await click('document.querySelector("#daily-plan-title")')
  assert.deepEqual(await titles(), ['Shared capture blur', 'Shared capture Enter', ...initial])
  await click('document.querySelector(".daily-plan-scroll .inline-task-start")')
  await send('Input.insertText', { text: '   ' })
  await press('Enter')
  const expected = await titles()
  assert.equal(expected.length, initial.length + 2)
  // The same capture mechanism must work in an empty Anytime section.
  const anytime = 'document.querySelector(".daily-source-group[aria-label=Anytime]")'
  const anytimeTitles = () =>
    evaluate(`[...${anytime}.querySelectorAll(".task-title")].map(n=>n.textContent)`)
  assert.deepEqual(await anytimeTitles(), [])
  await click(`${anytime}.querySelector(".inline-task-area-trigger")`)
  await click(
    '[...document.querySelectorAll("[role=menuitemradio]")].find(n=>n.textContent.includes("Personal"))',
  )
  await send('Input.insertText', { text: 'Anytime capture Enter' })
  await press('Enter')
  assert.deepEqual(await anytimeTitles(), ['Anytime capture Enter'])
  assert.equal(await evaluate(`${anytime}.querySelector("li").getAnimations().length > 0`), true)
  const anytimeCreated = await evaluate(
    '(async()=>{const d=await window.ritua.loadWorkspace();const e=d.entities.find(e=>e.kind==="task"&&e.data.content.title==="Anytime capture Enter");return {lane:e.data.lane,area:e.data.content.channel,selected:d.fields["daily.selection"].taskIds.includes(e.id)}})()',
  )
  assert.deepEqual(anytimeCreated, { lane: 'backlog:anytime', area: 'Personal', selected: false })
  await click(`${anytime}.querySelector(".inline-task-start")`)
  await send('Input.insertText', { text: 'Canceled Anytime capture' })
  await press('Escape')
  assert.deepEqual(await anytimeTitles(), ['Anytime capture Enter'])
  await click(`${anytime}.querySelector(".inline-task-start")`)
  await send('Input.insertText', { text: 'Anytime capture blur' })
  await click('document.querySelector("#daily-plan-title")')
  assert.deepEqual(await anytimeTitles(), ['Anytime capture blur', 'Anytime capture Enter'])
  assert.deepEqual(await titles(), expected)
  await evaluate(
    '(async()=>{const s=await import("/src/desktop/workspace-store.ts");await s.flushWorkspace()})()',
  )
  await send('Page.reload', {})
  for (let i = 0; i < 50; i++) {
    await delay(100)
    if (await evaluate('Boolean(document.querySelector(".daily-selected-task"))')) break
  }
  assert.deepEqual(await titles(), expected)
  assert.deepEqual(await anytimeTitles(), ['Anytime capture blur', 'Anytime capture Enter'])
  await evaluate(`${anytime}.scrollIntoView({block:'nearest'})`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-plan-shared-capture.png', Buffer.from(shot.data, 'base64'))
  console.log(
    'PASS: empty Anytime capture, correct backlog storage without selecting, source top insertion and animation, Enter/blur/Escape, shared area picker, Enter, blur, Escape, whitespace, top insertion and animation, Today storage, no duplicate selection, highlight retained, and reload persistence.',
  )
} finally {
  socket.close()
}

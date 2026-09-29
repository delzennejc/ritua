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
    `(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  await delay(100)
}
try {
  await click(`${nav}[1]`)
  assert.equal(await evaluate('document.querySelector(".daily-ritual-heading h1").textContent'), 'Plan today')
  assert.equal(await evaluate(`${nav}[1].getAttribute('aria-current')`), 'step')
  await click('document.querySelector(".daily-add-task")')
  await click('document.querySelector(".daily-star")')
  const selected = await evaluate('document.querySelector(".daily-selected-tasks").textContent')
  await click(`${nav}[0]`)
  assert.equal(await evaluate('document.querySelector(".daily-ritual-heading h1").textContent'), 'Yesterday')
  await evaluate(`${nav}[1].focus()`)
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  })
  await delay(100)
  assert.equal(await evaluate('document.querySelector(".daily-selected-tasks").textContent'), selected)
  assert.equal(await evaluate('document.querySelector(".daily-star").getAttribute("aria-pressed")'), 'true')
  assert.equal(
    await evaluate('document.activeElement === document.querySelector(".daily-ritual-heading h1")'),
    true,
  )
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-clickable-steps.png', Buffer.from(shot.data, 'base64'))
  console.log(
    'PASS: both header steps clickable, keyboard activation, active-step state, heading focus, selection and highlight retained.',
  )
} finally {
  socket.close()
}

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
const chart = 'document.querySelector(".daily-review-time-summary .weekly-folder-chart")'
const tooltip = 'document.querySelector(".time-breakdown-tooltip")'
try {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 400 })
  await delay(100)
  assert.equal(
    await evaluate('document.querySelector(".daily-review-time-summary .weekly-folder-legend") === null'),
    true,
  )
  for (const [index, label, detail] of [
    [0, 'Work', '2 tasks · 4 hr'],
    [1, 'Personal', '2 tasks · 0.8 hr'],
  ]) {
    const point = await evaluate(
      `(()=>{const p=${chart}.querySelectorAll('path')[${index}];const c=p.getPointAtLength(p.getTotalLength()/2).matrixTransform(p.getScreenCTM());return {x:c.x,y:c.y}})()`,
    )
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await delay(100)
    assert.equal(await evaluate(`${tooltip}.querySelector('strong').textContent`), label)
    assert.equal(await evaluate(`${tooltip}.querySelector('span').textContent`), detail)
    assert.ok(await evaluate(`${tooltip}.getBoundingClientRect().bottom <= ${point.y} - 10`))
    assert.ok(
      await evaluate(
        `(()=>{const r=${tooltip}.getBoundingClientRect();const center=Math.max(r.width/2+8,Math.min(innerWidth-r.width/2-8,${point.x}));return Math.abs(r.left+r.width/2-center)<1 && r.width<150})()`,
      ),
    )
    assert.equal(await evaluate(`${chart}.querySelectorAll('path')[${index}].style.opacity`), '1')
    assert.equal(
      await evaluate(`${chart}.querySelectorAll('path')[${index === 0 ? 1 : 0}].style.opacity`),
      '0.35',
    )
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-time-chart-hover.png', Buffer.from(shot.data, 'base64'))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 400 })
  await delay(100)
  assert.equal(await evaluate(`${tooltip} === null`), true)
  assert.equal(await evaluate(`[...${chart}.querySelectorAll('path')].every(p=>p.style.opacity==='1')`), true)
  await evaluate(`${chart}.querySelector('path').focus()`)
  await delay(100)
  assert.equal(await evaluate(`${tooltip}.querySelector('strong').textContent`), 'Work')
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
  await delay(100)
  assert.equal(await evaluate(`${tooltip} === null`), true)
  console.log(
    'PASS: hidden legend; per-area task/time tooltip above pointer; segment highlighting; pointer exit reset; keyboard focus and Escape dismissal.',
  )
} finally {
  socket.close()
}

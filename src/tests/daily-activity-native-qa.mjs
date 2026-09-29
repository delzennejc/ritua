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
const cells = 'document.querySelectorAll(".daily-activity-day:not([data-current-day])")'
const currentDay = 'document.querySelector(".daily-activity-day[data-current-day]")'
const tooltip = 'document.querySelector(".daily-activity-tooltip")'
try {
  await evaluate('document.querySelectorAll(".daily-ritual-topline > button")[1].click()')
  await delay(100)
  const dayCount = await evaluate(`${cells}.length`)
  assert.ok(dayCount >= 175 && dayCount <= 184)
  assert.equal(await evaluate(`${cells}[0].style.gridRow`), '1')
  assert.equal(await evaluate(`${cells}[6].style.gridRow`), '7')
  assert.equal(await evaluate(`${cells}[6].style.gridColumn === ${cells}[0].style.gridColumn`), true)
  const monthGaps = await evaluate(
    `(()=>{const monthForWeek=(cell)=>{const counts={};for(let offset=0;offset<7;offset++){const date=new Date(cell.dataset.date+'T12:00:00');date.setDate(date.getDate()+offset);const month=date.getFullYear()+'-'+date.getMonth();counts[month]=(counts[month]||0)+1}return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]};const mondays=[...${cells}].filter(c=>c.style.gridRow==='1').reverse();return mondays.slice(1).map((cell,index)=>({gap:cell.getBoundingClientRect().left-mondays[index].getBoundingClientRect().right,changed:monthForWeek(cell)!==monthForWeek(mondays[index])}))})()`,
  )
  assert.ok(monthGaps.some((gap) => gap.changed))
  for (const gap of monthGaps) assert.ok(Math.abs(gap.gap - (gap.changed ? 6 : 2)) < 1)
  assert.equal(await evaluate(`${currentDay}.style.gridColumn`), '1')
  assert.equal(await evaluate(`getComputedStyle(${currentDay}, '::before').backgroundColor`), 'rgb(0, 0, 0)')
  assert.equal(await evaluate(`getComputedStyle(${currentDay}).transform`), 'matrix(1.2, 0, 0, 1.2, 0, 0)')
  assert.equal(
    await evaluate(`getComputedStyle(${currentDay}, '::after').backgroundColor`),
    'rgb(255, 255, 255)',
  )
  const point = await evaluate(
    `(()=>{const r=${cells}[${dayCount - 1}].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await delay(100)
  assert.match(await evaluate(`${tooltip}.textContent`), /6.5 hr logged/)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-activity-hover.png', Buffer.from(shot.data, 'base64'))
  const previousHeight = await evaluate(
    `(window.__activityTooltip = ${tooltip}).getBoundingClientRect().height`,
  )
  const nextPoint = await evaluate(
    `(()=>{const r=${cells}[${dayCount - 3}].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...nextPoint })
  await delay(50)
  const morph = await evaluate(
    `({same:window.__activityTooltip === ${tooltip},height:${tooltip}.getBoundingClientRect().height,target:parseFloat(${tooltip}.style.height)})`,
  )
  assert.equal(morph.same, true, 'The tooltip stays mounted between days')
  assert.ok(morph.height < previousHeight && morph.height > morph.target, 'Height smoothly interpolates')
  await delay(220)
  assert.ok(
    await evaluate(
      `Math.abs(${tooltip}.getBoundingClientRect().height - parseFloat(${tooltip}.style.height)) < 1`,
    ),
  )
  const settled = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/daily-activity-morphed.png', Buffer.from(settled.data, 'base64'))
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  assert.equal(await evaluate(`getComputedStyle(${tooltip}).transitionDuration`), '0s')
  assert.equal(await evaluate(`getComputedStyle(${tooltip}.firstElementChild).animationName`), 'none')
  await send('Emulation.setEmulatedMedia', { features: [] })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 400 })
  await delay(100)
  assert.equal(await evaluate(`${tooltip} === null`), true)
  await evaluate(`${cells}[0].focus()`)
  await delay(100)
  assert.match(await evaluate(`${tooltip}.textContent`), /0 tasks · 0 hr logged/)
  await evaluate(`${currentDay}.focus()`)
  await delay(100)
  assert.match(await evaluate(`${tooltip}.textContent`), /Today · In progress/)
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await delay(100)
  assert.equal(await evaluate(`${tooltip} === null`), true)
  const todayDate = await evaluate(`${currentDay}.dataset.date`)
  const yesterdayDate = await evaluate(`${cells}[${dayCount - 1}].dataset.date`)
  const yesterdayColor = await evaluate(`getComputedStyle(${cells}[${dayCount - 1}], '::before').backgroundColor`)
  await evaluate('document.querySelectorAll(".daily-ritual-topline > button")[0].click()')
  await delay(100)
  assert.equal(await evaluate(`${currentDay} === null`), true)
  assert.equal(await evaluate(`document.querySelector('[data-date="${todayDate}"]') === null`), true)
  const yesterday = 'document.querySelector(".daily-activity-day[data-highlighted-day]")'
  assert.equal(await evaluate(`${yesterday}.dataset.date`), yesterdayDate)
  assert.equal(await evaluate(`getComputedStyle(${yesterday}, '::before').backgroundColor`), yesterdayColor)
  assert.equal(await evaluate(`getComputedStyle(${yesterday}).transform`), 'matrix(1.2, 0, 0, 1.2, 0, 0)')
  assert.equal(
    await evaluate(`getComputedStyle(${yesterday}, '::after').backgroundColor`),
    'rgb(255, 255, 255)',
  )
  await evaluate(`${yesterday}.focus()`)
  await delay(100)
  assert.match(await evaluate(`${tooltip}.textContent`), /6.5 hr logged/)
  assert.doesNotMatch(await evaluate(`${tooltip}.textContent`), /In progress/)
  const reviewShot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('build/qa/shots/yesterday-activity-highlight.png', Buffer.from(reviewShot.data, 'base64'))
  console.log(
    'PASS: Yesterday omits today and highlights yesterday with logged totals, Plan today retains today, day details, continuous tooltip resizing, reduced motion, empty day, pointer exit, keyboard focus and Escape.',
  )
} finally {
  socket.close()
}

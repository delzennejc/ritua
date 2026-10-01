import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { connectNativeQa } from './native-qa-client.mjs'

const qa = await connectNativeQa()
const { evaluate, check, send, shot } = qa
const fixtureUrl = `/@fs${resolve('src/tests/home-scrolling-qa.js')}`
const fixture = `await import(${JSON.stringify(fixtureUrl)})`
const fields = `(${fixture}).homeQaFields()`
const profiling = process.argv.includes('--profile')
const tasksPerDay = process.argv.includes('--large') ? 60 : 20
const report = []
const key = async (key, code, modifiers = 0) => {
  const name = key === ' ' ? 'Space' : key
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key, code: name, windowsVirtualKeyCode: code, modifiers })
}
const measure = async (name, selector, axis, steps, distance) => {
  if (profiling) {
    await send('Profiler.enable')
    await send('Profiler.start')
  }
  const result = await evaluate(
    `(async()=>(${fixture}).measureHomeScroll(${JSON.stringify(selector)},${JSON.stringify(axis)},${steps},${distance}))()`,
  )
  report.push({ name, ...result })
  console.log(JSON.stringify(report.at(-1)))
  if (profiling) {
    const { profile } = await send('Profiler.stop')
    await writeFile(`build/qa/${name}.cpuprofile`, JSON.stringify(profile))
    const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]))
    const times = new Map()
    profile.samples.forEach((id, index) => {
      const frame = nodes.get(id)
      const label = `${frame.functionName || '(anonymous)'} ${frame.url.replace(qa.session.origin, '').split('?')[0]}:${frame.lineNumber + 1}`
      times.set(label, (times.get(label) || 0) + profile.timeDeltas[index] / 1000)
    })
    console.log(
      [...times]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([frame, ms]) => ({ ms: Math.round(ms), frame })),
    )
  }
}

try {
  const load = await evaluate('performance.timeOrigin')
  await send('Page.reload')
  await check(`performance.timeOrigin!==${load} && Boolean(document.querySelector('.app-shell'))`)
  qa.errors.length = 0
  const accessibility = await evaluate(`(async()=>(${fixture}).verifyDragAccessibilityBatching())()`)
  assert.ok(accessibility.initialScans <= 2, 'Mounting 40 controls must coalesce the accessible DOM scans')
  assert.ok(
    accessibility.initialAttributes &&
      accessibility.replacedHandle &&
      accessibility.reenabled &&
      accessibility.destroyed,
  )
  console.log(await evaluate(`(async()=>(${fixture}).seedHomeScrolling(${tasksPerDay}))()`))
  await check(`Boolean(document.querySelector('.week-calendar-grid-scroll'))`)
  await check(`document.querySelectorAll('.week-calendar-days .calendar-timeline-scroll').length === 21`)
  await delay(300)
  await measure(
    'home-calendar-vertical',
    '[data-week-calendar-page]:nth-child(2) .calendar-timeline-scroll',
    'y',
    40,
    15,
  )
  await measure('home-calendar-horizontal', '.week-calendar-grid-scroll', 'x', 40, 45)
  const retainedTime = report[0].endPosition
  await check(
    `[...document.querySelectorAll('.week-calendar-days .calendar-timeline-scroll')].every(e=>e.scrollTop===${retainedTime})`,
  )
  assert.notDeepEqual(report[1].startWeekPages, report[1].endWeekPages, 'The scroll must change weeks')
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-calendar-event-id="qa-home-overnight"]').length`),
    2,
  )
  await delay(300)
  await shot('home-calendar-scrolling')
  await evaluate(`document.querySelector('[aria-label="Show board view"]').click()`)
  await check(`Boolean(document.querySelector('.board-columns'))`)
  await delay(300)
  await measure('home-board-horizontal', '.board-columns', 'x', 40, 35)
  await measure('home-board-vertical', '.board-columns', 'y', 40, 35)
  assert.ok(report[2].endPosition - report[2].startPosition > 1000)
  assert.ok(report[3].endPosition - report[3].startPosition > 1000)
  assert.equal(
    report[2].startScrollHeight,
    report[2].endScrollHeight,
    'Offscreen lists retain their full height',
  )
  assert.equal(report[3].startScrollHeight, report[3].endScrollHeight)
  assert.ok(
    await evaluate(`document.querySelectorAll('.board-columns [data-board-interactive="true"]').length <= 8`),
  )
  await shot('home-board-scrolling')
  const reportFile = `build/qa/home-scrolling-performance${tasksPerDay > 20 ? '-large' : ''}.json`
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  assert.ok(
    report.every((item) => item.maxMs < 200),
    'All scroll and settle frames must stay below 200 ms',
  )
  const logicalPosition = await evaluate(
    `document.querySelector('.board-columns').scrollLeft / document.querySelector('.board-columns .day-column').offsetWidth`,
  )
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await delay(250)
  assert.ok(
    Math.abs(
      (await evaluate(
        `document.querySelector('.board-columns').scrollLeft / document.querySelector('.board-columns .day-column').offsetWidth`,
      )) - logicalPosition,
    ) < 0.02,
    'Resizing retains the same day and clipped-column offset',
  )
  await shot('home-board-narrow')
  await send('Emulation.clearDeviceMetricsOverride')
  await delay(250)
  // Focusing an offscreen card mounts its drag binding without replacing the
  // article or focused title. A dialog must keep its return target too.
  await evaluate(
    `(()=>{const column=[...document.querySelectorAll('.board-columns .day-column')].find(e=>e.dataset.boardInteractive==='false');window.qaFocusCard=column.querySelector('.task-card');window.qaFocusTitle=window.qaFocusCard.querySelector('.task-title');window.qaFocusTitle.focus({preventScroll:true})})()`,
  )
  await check(
    `window.qaFocusCard.closest('.day-column').dataset.boardInteractive === 'true' && window.qaFocusCard.hasAttribute('aria-describedby')`,
  )
  assert.ok(await evaluate(`document.activeElement===window.qaFocusTitle && window.qaFocusTitle.isConnected`))
  await evaluate(`window.qaFocusTitle.click()`)
  await check(`Boolean(document.querySelector('[aria-label="Close task details"]'))`)
  await evaluate(`document.querySelector('[aria-label="Close task details"]').click()`)
  await check(`document.activeElement===window.qaFocusTitle`)
  // Keyboard pickup and cancellation retain the source while it scrolls away.
  await evaluate(`window.qaFocusCard.focus({preventScroll:true})`)
  await key(' ', 32)
  await check(`window.qaFocusCard.classList.contains('dragging')`)
  assert.equal(await evaluate(`window.qaFocusCard.getAttribute('aria-pressed')`), 'true')
  await evaluate(`document.querySelector('.board-columns').scrollLeft+=1800`)
  await delay(150)
  assert.ok(
    await evaluate(`window.qaFocusCard.isConnected && window.qaFocusCard.classList.contains('dragging')`),
  )
  await key('Escape', 27)
  await check(`!window.qaFocusCard.classList.contains('dragging')`)
  // Real pointer reorder uses the same retained article and registered drop target.
  const dragDay = await evaluate(
    `(()=>{const root=document.querySelector('.board-columns');root.scrollTop=0;const column=[...root.querySelectorAll('.day-column')][Math.ceil(root.scrollLeft/270)];window.qaPointerCards=[...column.querySelectorAll('.task-card')];return column.dataset.dateKey})()`,
  )
  await delay(150)
  const previousOrder = await evaluate(
    `(async()=>${fields}.datedTasksByDate[${JSON.stringify(dragDay)}].map(t=>t.id))()`,
  )
  const pointerIds = await evaluate(`window.qaPointerCards.slice(1,3).map(e=>e.dataset.boardTaskId)`)
  const from = await evaluate(
    `(()=>{const r=window.qaPointerCards[1].getBoundingClientRect();return {x:r.right-24,y:r.top+8}})()`,
  )
  const to = await evaluate(
    `(()=>{const r=window.qaPointerCards[2].getBoundingClientRect();return {x:r.right-24,y:r.bottom-3}})()`,
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
  await check(`window.qaPointerCards[1].classList.contains('dragging')`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...to,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await check(
    `(async()=>{const ids=${fields}.datedTasksByDate[${JSON.stringify(dragDay)}].map(t=>t.id);return ids.indexOf(${JSON.stringify(pointerIds[0])})>ids.indexOf(${JSON.stringify(pointerIds[1])})})()`,
  )
  const savedOrder = await evaluate(
    `(async()=>${fields}.datedTasksByDate[${JSON.stringify(dragDay)}].map(t=>t.id))()`,
  )
  assert.notDeepEqual(savedOrder, previousOrder)
  // Area filtering still uses the canonical task identity in every day column.
  await evaluate(`document.querySelector('[aria-label="Filter by area"]').click()`)
  await check(`Boolean(document.querySelector('[role="menuitemcheckbox"]'))`)
  await evaluate(
    `[...document.querySelectorAll('[role="menuitemcheckbox"]')].find(e=>e.textContent.trim()==='Work').click()`,
  )
  await check(
    `document.querySelectorAll('.board-columns .task-card').length===${91 * (tasksPerDay - Math.ceil(tasksPerDay / 3))}`,
  )
  await shot('home-board-work-filter')
  await evaluate(`(async()=>{await (${fixture}).flushHomeQa()})()`)
  const beforeReload = await evaluate('performance.timeOrigin')
  await send('Page.reload')
  await check(`performance.timeOrigin!==${beforeReload} && Boolean(document.querySelector('.app-shell'))`)
  await check(`(async()=>Boolean(${fields}.datedTasksByDate[${JSON.stringify(dragDay)}]))()`)
  assert.deepEqual(
    await evaluate(`(async()=>${fields}.datedTasksByDate[${JSON.stringify(dragDay)}].map(t=>t.id))()`),
    savedOrder,
  )
  assert.deepEqual(qa.errors, [])
} finally {
  qa.close()
}

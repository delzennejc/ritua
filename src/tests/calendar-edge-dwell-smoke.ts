import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

export async function verifyCalendarEdgeDwell(window: BrowserWindow, targetId: string, moveExisting = false) {
  const evaluate = (script: string) => window.webContents.executeJavaScript(script)
  const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))
  const sourceId = await evaluate(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    if (!${moveExisting}) {
      [...document.querySelectorAll('.today-layout button')].find(b => b.textContent.trim() === 'Add task').click();
      await pause();
      const input = document.querySelector('textarea[aria-label="New task"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Edge dwell task');
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      const task = doc.entities.find(e => e.kind === 'task' && e.data.content.title === 'Edge dwell task');
      if (task) return task.id;
      await pause();
    }
    throw new Error('Missing edge dwell task');
  })()`)
  if (moveExisting) {
    await evaluate(
      `document.querySelector('[data-calendar-event-id="${sourceId}"] [data-resize-handle]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`,
    )
    await pause(300)
  }
  const savedSource = await evaluate(
    `(async () => (await window.ritua.loadWorkspace()).entities.find(e => e.kind === 'event' && e.data.taskId === '${sourceId}') || null)()`,
  )
  const startDrag = async (fromCalendar = moveExisting, cardOverlap = true) => {
    const points = await evaluate(`(() => {
      const target = document.querySelector('[data-calendar-event-id="${targetId}"]');
      const scroll = target.closest('.calendar-timeline-scroll');
      scroll.scrollTop = Math.max(0, target.offsetTop - 100);
      const source = document.querySelector(${JSON.stringify(fromCalendar ? `[data-calendar-event-id="${sourceId}"] .calendar-event-drag-surface` : `[data-board-task-id="${sourceId}"]`)});
      const rect = source.getBoundingClientRect();
      const timeline = target.closest('.timeline').getBoundingClientRect();
      const viewport = target.closest('.calendar-timeline-scroll').getBoundingClientRect();
      const block = target.getBoundingClientRect();
      return { from: { x: Math.round(${cardOverlap} ? rect.right - 6 : rect.left + rect.width / 2), y: Math.round(rect.top + 15) },
        to: { x: Math.round(timeline.right + (${cardOverlap} ? Math.min(rect.width / 2, 40) : 6)),
          y: Math.round(${cardOverlap} ? block.top - 8 : Math.max(viewport.top + 70, block.top + 30)) },
        start: Number(target.dataset.calendarStart), end: Number(target.dataset.calendarEnd) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...points.from })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...points.from, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 10; step++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(points.from.x + ((points.to.x - points.from.x) * step) / 10),
        y: Math.round(points.from.y + ((points.to.y - points.from.y) * step) / 10),
        button: 'left',
      })
      await pause(20)
    }
    return points
  }
  const finish = async (point: { x: number; y: number }, cancel = false) => {
    if (cancel) window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    if (cancel) window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await pause(350)
  }
  const armed = () => evaluate(`Boolean(document.querySelector('[data-calendar-shared-slot="true"]'))`)
  let points = await startDrag()
  await pause(100)
  assert.equal(await armed(), false, 'A short edge hover must not share the slot')
  const geometry = await evaluate(`(() => {
    const target = document.querySelector('[data-calendar-event-id="${targetId}"]');
    const timeline = target.closest('.timeline').getBoundingClientRect();
    const viewport = target.closest('.calendar-timeline-scroll').getBoundingClientRect();
    const block = target.getBoundingClientRect();
    const card = document.querySelector('.dnd-overlay').getBoundingClientRect();
    return { cursorOutside: ${points.to.x} > viewport.right && ${points.to.y} < block.top,
      cardOverlaps: card.left < timeline.right && card.right > timeline.right - 40 && card.bottom > block.top };
  })()`)
  assert.equal(geometry.cursorOutside, true, 'Regression must keep the cursor outside the target')
  assert.equal(geometry.cardOverlaps, true, 'Regression must overlap the target with the dragged card')
  await pause(1200)
  assert.equal(
    await armed(),
    true,
    'Card overlap must arm sharing even with the cursor outside the calendar and above the event',
  )
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: points.to.x - 12,
    y: points.to.y,
    button: 'left',
  })
  await pause()
  assert.equal(await armed(), true, 'Moving the card slightly must keep sharing active')
  window.webContents.sendInputEvent({ type: 'mouseMove', ...points.to, button: 'left' })
  await pause()
  assert.equal(await armed(), true, 'Returning the card must keep sharing active')
  await evaluate(
    `Promise.all([...document.querySelectorAll('.calendar-event')].flatMap(element => element.getAnimations()).map(animation => animation.finished.catch(() => {})))`,
  )
  const preview = await evaluate(`(() => {
    const p = document.querySelector('[data-calendar-shared-slot="true"]');
    const target = document.querySelector('[data-calendar-event-id="${targetId}"]');
    return { start: Number(p.dataset.dropStart), end: Number(p.dataset.dropEnd), beside: target.getBoundingClientRect().right <= p.getBoundingClientRect().left };
  })()`)
  assert.equal(preview.start, points.start)
  assert.equal(preview.end, points.end)
  assert.equal(preview.beside, true, 'Armed preview must leave space beside the occupied slot')
  if (process.env.RITUA_TEST_SCREENSHOT_DIR) {
    const screenshot = await window.webContents.capturePage()
    await writeFile(
      join(
        process.env.RITUA_TEST_SCREENSHOT_DIR,
        `calendar-edge-card-${moveExisting ? 'calendar' : 'board'}.png`,
      ),
      screenshot.toPNG(),
    )
  }
  assert.deepEqual(
    await evaluate(
      `(async () => (await window.ritua.loadWorkspace()).entities.find(e => e.kind === 'event' && e.data.taskId === '${sourceId}') || null)()`,
    ),
    savedSource,
    'Hover must not save a schedule',
  )
  await finish(points.to, true)
  assert.equal(await armed(), false)
  assert.deepEqual(
    await evaluate(
      `(async () => (await window.ritua.loadWorkspace()).entities.find(e => e.kind === 'event' && e.data.taskId === '${sourceId}') || null)()`,
    ),
    savedSource,
    'Escape must preserve the schedule',
  )
  points = await startDrag()
  await pause(1300)
  assert.equal(await armed(), true)
  await finish(points.to)
  const saved = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      const events = doc.entities.filter(e => e.kind === 'event' && e.data.taskId === '${sourceId}');
      if (events.length === 1 && events[0].data.content.start === ${points.start} && events[0].data.content.end === ${points.end}) return events;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Edge drop did not persist the exact shared slot');
  })()`)
  assert.equal(saved.length, 1)
  const joined = await evaluate(
    `(async () => (await window.ritua.loadWorkspace()).entities.some(e => e.kind === 'event' && e.data.content.kind === 'session' && e.data.content.taskIds.includes('${sourceId}')))()`,
  )
  assert.equal(joined, false, 'Sharing a slot must not add session membership')
  if (!moveExisting) return
  // A quick release in the same gutter must still move the block normally,
  // rather than treating the calendar's visible edge as a drop outside it.
  points = await startDrag(true, false)
  await pause(100)
  assert.equal(await armed(), false)
  const quickPreview = await evaluate(`(() => {
    const p = document.querySelector('[data-calendar-drop-preview="true"]');
    return { start: Number(p?.dataset.dropStart), end: Number(p?.dataset.dropEnd) };
  })()`)
  assert.ok(Number.isFinite(quickPreview.start), 'The gutter must show a normal preview before the dwell')
  await finish(points.to)
  await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      const event = doc.entities.find(e => e.kind === 'event' && e.data.taskId === '${sourceId}');
      if (event?.data.content.start === ${quickPreview.start} && event?.data.content.end === ${quickPreview.end}) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Quick gutter drop must retain the calendar block at its previewed time');
  })()`)
}

import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'

/** Native edge hover and click must create overlaps without dragging the existing block. */
export async function verifyCalendarOverlapCreation(window: BrowserWindow, sessionId: string) {
  const evaluate = async (script: string) => {
    const result = await window.webContents.executeJavaScript(
      `(async () => { try { return await (${script}); } catch (error) { return { testError: String(error) }; } })()`,
    )
    if (result?.testError) throw new Error(result.testError)
    return result
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 60))
  const original = await evaluate(`(async () => {
    const doc = await window.ritua.loadWorkspace();
    return doc.entities.find(e => e.kind === 'event' && e.id === ${JSON.stringify(sessionId)}).data.content;
  })()`)
  const originalWidth = await evaluate(
    `document.querySelector('[data-calendar-event-id="${sessionId}"]').getBoundingClientRect().width`,
  )
  const hover = async (id: string) => {
    const point = await evaluate(`(() => {
      const block = document.querySelector('[data-calendar-event-id="${id}"]');
      block.scrollIntoView({ block: 'center', behavior: 'instant' });
      const timeline = block.closest('.timeline').getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      return { x: Math.round(timeline.right - 6), y: Math.round(rect.top + 24), centerX: Math.round(rect.left + rect.width / 2) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.centerX, y: point.y })
    await pause()
    assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-overlap-add'))`), false)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    await pause()
    const button = await evaluate(`(() => {
      const button = document.querySelector('.calendar-overlap-add');
      if (!button) throw new Error('Occupied calendar edge must expose the add button: ' + JSON.stringify({ point: ${JSON.stringify(point)}, hit: document.elementFromPoint(${point.x}, ${point.y})?.outerHTML.slice(0, 800) }));
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', ...button, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...button, button: 'left', clickCount: 1 })
    await pause()
    assert.equal(
      await evaluate(`Boolean(document.querySelector('[aria-label="Create from calendar selection"]'))`),
      true,
    )
    const sharedSpace = await evaluate(`(() => {
      const preview = document.querySelector('.calendar-selection').getBoundingClientRect();
      const block = document.querySelector('[data-calendar-event-id="${id}"]').getBoundingClientRect();
      return { beside: block.right <= preview.left, sameTime: Math.abs(block.top - preview.top) < 1, width: preview.width };
    })()`)
    assert.equal(sharedSpace.beside, true, 'Creation preview must sit beside the existing event')
    assert.equal(sharedSpace.sameTime, true, 'Creation preview must retain the same start time')
    assert.ok(sharedSpace.width > 0)
  }
  await hover(sessionId)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await pause()
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-selection'))`), false)
  assert.equal(
    await evaluate(
      `document.querySelector('[data-calendar-event-id="${sessionId}"]').getBoundingClientRect().width`,
    ),
    originalWidth,
    'Canceling creation must restore the existing event width',
  )
  const create = async (kind: 'task' | 'session') =>
    evaluate(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const wait = async fn => { for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await pause(); } throw new Error('Overlap creation timed out'); };
    document.querySelector('[data-task-context-item="create-${kind}"]').click();
    const input = await wait(() => document.querySelector('[aria-label="${kind === 'task' ? 'Task' : 'Session'} title"]'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Overlapping ${kind}');
    input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    [...document.querySelectorAll('.calendar-task-editor button')].find(b => b.textContent.trim() === 'Create ${kind}').click();
    return wait(async () => { const doc = await window.ritua.loadWorkspace(); return doc.entities.find(e => e.kind === 'event' && ${kind === 'session' ? "e.data.content.title === 'Overlapping session'" : "e.data.taskId && doc.entities.some(t => t.kind === 'task' && t.id === e.data.taskId && t.data.content.title === 'Overlapping task')"}); });
  })()`)
  await hover(sessionId)
  const taskEvent = await create('task')
  await hover(taskEvent.id)
  const sessionEvent = await create('session')
  for (const event of [taskEvent, sessionEvent]) {
    assert.equal(event.data.content.start, original.start)
    assert.equal(event.data.content.end, original.end)
    assert.equal(event.data.content.dateKey, original.dateKey)
  }
  const unchanged = await evaluate(`(async () => {
    const doc = await window.ritua.loadWorkspace();
    return doc.entities.find(e => e.kind === 'event' && e.id === ${JSON.stringify(sessionId)}).data.content;
  })()`)
  assert.deepEqual(unchanged, original)
}

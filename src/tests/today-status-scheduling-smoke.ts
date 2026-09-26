import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'
import { addDays, localDateKey } from '../domain/calendar-dates'

/** Calendar drag-out removes only the dragged block, even over Today status columns. */
export async function verifyTodayStatusScheduling(window: BrowserWindow, taskId: string) {
  const eventId = 'today-status-scheduling-block'
  const future = addDays(localDateKey(), 1)
  await window.webContents.executeJavaScript(`(async () => {
    const doc = await window.ritua.loadWorkspace();
    const task = doc.entities.find(e => e.kind === 'task' && e.id === ${JSON.stringify(taskId)});
    const response = await window.ritua.saveWorkspace({
      revision: doc.revision, requestId: crypto.randomUUID(), remove: [], fields: { ...doc.fields, dateKeys: [...new Set([...doc.fields.dateKeys, ${JSON.stringify(future)}])] },
      put: [
        { ...task, data: { ...task.data, lane: 'date:' + ${JSON.stringify(future)}, position: doc.entities.filter(e => e.kind === 'task' && e.data.lane === 'date:' + ${JSON.stringify(future)}).length, content: { ...task.data.content, time: '09:00', minutes: 60 } } },
        { kind: 'event', id: ${JSON.stringify(eventId)}, data: { position: doc.entities.filter(e => e.kind === 'event').length, taskId: task.id, derived: ['title', 'complete'], content: { id: ${JSON.stringify(eventId)}, taskId: task.id, dateKey: doc.fields.workspaceDate, start: 540, end: 600, color: 'violet' } } }
      ]
    });
    if (!response.ok) throw new Error('Status scheduling fixture failed');
  })()`)
  await new Promise<void>((resolve) => {
    window.webContents.once('did-finish-load', () => resolve())
    window.webContents.reload()
  })
  const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
  const withoutActivity = (content: Record<string, unknown>) => {
    const copy: Record<string, unknown> = { ...content }
    delete copy.activity
    return copy
  }
  const read = () =>
    window.webContents.executeJavaScript(`(async () => {
      const doc = await window.ritua.loadWorkspace();
      return {
        task: doc.entities.find(e => e.kind === 'task' && e.id === ${JSON.stringify(taskId)}).data,
        event: doc.entities.find(e => e.kind === 'event' && e.id === ${JSON.stringify(eventId)})?.data
      };
    })()`)
  const waitForToday = () =>
    window.webContents.executeJavaScript(`(async () => {
    const wait = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('Status scheduling UI timed out'); };
    await wait(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Today'));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Today').click();
    await wait(() => document.querySelector('[data-calendar-event-id="${eventId}"]'));
    await wait(() => document.querySelector('[data-board-task-id="${taskId}"]'));
  })()`)
  await waitForToday()
  const original = await read()
  // The visible day's card can refer to a task whose canonical lane is another day.
  // Dropping that card back onto itself must not move its calendar block.
  const boardPoint = await window.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-board-task-id="${taskId}"]');
    card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const rect = card.getBoundingClientRect();
    return { x: Math.round(rect.right - 22), y: Math.round(rect.top + 18) };
  })()`)
  window.webContents.sendInputEvent({ type: 'mouseMove', ...boardPoint })
  window.webContents.sendInputEvent({ type: 'mouseDown', ...boardPoint, button: 'left', clickCount: 1 })
  for (let offset = 1; offset <= 12; offset++) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: boardPoint.x,
      y: boardPoint.y + offset,
      button: 'left',
    })
    await pause(20)
  }
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: boardPoint.x,
    y: boardPoint.y + 12,
    button: 'left',
    clickCount: 1,
  })
  await pause(250)
  assert.deepEqual(await read(), original, 'Dropping a shared board card onto itself preserves scheduling')
  const dragCalendarTo = async (status: string, cancel = false) => {
    const points = await window.webContents.executeJavaScript(`(async () => {
      const source = document.querySelector('[data-calendar-event-id="${eventId}"] .calendar-event-drag-surface');
      source.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const target = document.querySelector('.today-layout [data-board-drop-zone][data-today-status="${status}"]');
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 80));
      const s = source.getBoundingClientRect(), t = target.getBoundingClientRect();
      const x = Math.round(s.left + s.width / 2), y = Math.round(s.top + s.height / 2);
      const hit = document.elementFromPoint(x, y)?.closest('[data-calendar-event-id]')?.getAttribute('data-calendar-event-id');
      if (hit !== '${eventId}') throw new Error('Calendar drag source is obscured: ' + JSON.stringify({ x, y, hit, s: s.toJSON(), t: t.toJSON() }));
      return { x, y, tx: Math.round(t.left + t.width / 2), ty: Math.round(t.top + 180) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: points.x, y: points.y })
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      x: points.x,
      y: points.y,
      button: 'left',
      clickCount: 1,
    })
    for (let i = 1; i <= 18; i++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(points.x + ((points.tx - points.x) * i) / 18),
        y: Math.round(points.y + ((points.ty - points.y) * i) / 18),
        button: 'left',
      })
      await pause(20)
    }
    if (cancel) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      await pause(80)
    }
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      x: points.tx,
      y: points.ty,
      button: 'left',
      clickCount: 1,
    })
    if (cancel) window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await pause(250)
  }
  const restore = async () => {
    await window.webContents.executeJavaScript(`(async () => {
      const doc = await window.ritua.loadWorkspace();
      const response = await window.ritua.saveWorkspace({
        revision: doc.revision, requestId: crypto.randomUUID(), remove: [], fields: doc.fields,
        put: [
          { kind: 'task', id: ${JSON.stringify(taskId)}, data: ${JSON.stringify(original.task)} },
          { kind: 'event', id: ${JSON.stringify(eventId)}, data: ${JSON.stringify(original.event)} }
        ]
      });
      if (!response.ok) throw new Error('Calendar drag-out fixture restoration failed');
    })()`)
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve())
      window.webContents.reload()
    })
    await waitForToday()
  }
  for (const status of ['to-review', 'in-progress', 'done']) {
    await dragCalendarTo(status, true)
    assert.deepEqual(await read(), original, 'Escape preserves the calendar block and task')
    await dragCalendarTo(status)
    for (let i = 0; i < 150 && (await read()).event; i++) await pause()
    const changed = await read()
    assert.equal(changed.event, undefined, 'Dragging onto ' + status + ' removes the calendar block')
    assert.equal(changed.task.lane, original.task.lane, 'Drag-out preserves the task date')
    assert.deepEqual(
      withoutActivity(changed.task.content),
      { ...withoutActivity(original.task.content), time: null, minutes: 0 },
      'Drag-out clears block timing without changing task status or completion',
    )
    assert.equal(
      changed.task.content.activity?.at(-1)?.label,
      'You removed this from the calendar',
      'Drag-out records the removal in task history',
    )
    await restore()
  }
  console.log('PASS: Calendar drag-out over Today columns removes the block; Escape preserves scheduling.')
}

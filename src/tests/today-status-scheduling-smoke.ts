import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'

/** Regression: changing workflow status must not act as unscheduling. */
export async function verifyTodayStatusScheduling(window: BrowserWindow, taskId: string) {
  const eventId = 'today-status-scheduling-block'
  await window.webContents.executeJavaScript(`(async () => {
    const doc = await window.ritua.loadWorkspace();
    const task = doc.entities.find(e => e.kind === 'task' && e.id === ${JSON.stringify(taskId)});
    const response = await window.ritua.saveWorkspace({
      revision: doc.revision, requestId: crypto.randomUUID(), remove: [], fields: doc.fields,
      put: [
        { ...task, data: { ...task.data, content: { ...task.data.content, time: '09:00', minutes: 60 } } },
        { kind: 'event', id: ${JSON.stringify(eventId)}, data: { position: 999, taskId: task.id, derived: ['title', 'complete'], content: { id: ${JSON.stringify(eventId)}, taskId: task.id, dateKey: doc.fields.workspaceDate, start: 540, end: 600, color: 'violet' } } }
      ]
    });
    if (!response.ok) throw new Error('Status scheduling fixture failed');
  })()`)
  await new Promise<void>((resolve) => {
    window.webContents.once('did-finish-load', () => resolve())
    window.webContents.reload()
  })
  const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
  const read = () =>
    window.webContents.executeJavaScript(`(async () => {
      const doc = await window.ritua.loadWorkspace();
      return {
        task: doc.entities.find(e => e.kind === 'task' && e.id === ${JSON.stringify(taskId)}).data,
        event: doc.entities.find(e => e.kind === 'event' && e.id === ${JSON.stringify(eventId)})?.data
      };
    })()`)
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('Status scheduling UI timed out'); };
    await wait(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Today'));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Today').click();
    await wait(() => document.querySelector('[data-calendar-event-id="${eventId}"]'));
  })()`)
  const original = await read()
  const dragCalendarTo = async (status: string) => {
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
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      x: points.tx,
      y: points.ty,
      button: 'left',
      clickCount: 1,
    })
    await pause(250)
  }
  const expectStatus = async (status: string) => {
    for (let i = 0; i < 150; i++) {
      const { task } = await read()
      if ((task.content.complete ? 'done' : task.content.todayStatus || 'todo') === status) return
      await pause()
    }
    throw new Error('Status scheduling transition failed: ' + status + ' ' + JSON.stringify(await read()))
  }
  const undo = async () => {
    await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('.undo-snackbar-action');
      if (!button) throw new Error('Status change must offer Undo');
      button.click();
    })()`)
  }
  await dragCalendarTo('in-progress')
  await expectStatus('in-progress')
  let changed = await read()
  assert.deepEqual(changed.event, original.event, 'Calendar status drop must preserve its event')
  assert.equal(changed.task.content.minutes, 60, 'Status drop preserves planned duration')
  assert.equal(changed.task.content.time, '09:00', 'Status drop preserves planned time')
  await undo()
  await expectStatus('to-review')
  assert.deepEqual(await read(), original, 'Undo restores status without removing the Calendar block')
  await dragCalendarTo('to-review')
  assert.deepEqual(await read(), original, 'Same-status Calendar drop must not unschedule')
  await dragCalendarTo('done')
  await expectStatus('done')
  changed = await read()
  assert.ok(changed.event, 'Done retains the Calendar block')
  await undo()
  await expectStatus('to-review')
  assert.deepEqual(await read(), original, 'Done Undo restores completion and calendar timing together')
  console.log(
    'PASS: Native Calendar-to-status drops preserve scheduling; status and Done Undo restore canonical data.',
  )
}

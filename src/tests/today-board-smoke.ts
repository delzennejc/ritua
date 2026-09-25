import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'
import { verifyTodayStatusScheduling } from './today-status-scheduling-smoke'

/** Native pointer gestures exercise the actual Today drop targets and SQLite saves. */
export async function verifyTodayBoards(window: BrowserWindow) {
  const bounds = window.getBounds()
  window.setSize(1680, 1000)
  window.show()
  window.focus()
  const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    const setup = await window.webContents.executeJavaScript(`(async () => {
      const pause = () => new Promise(resolve => setTimeout(resolve, 40));
      const wait = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(); } throw new Error('Today board setup timed out: ' + predicate); };
      await wait(() => document.querySelector('.today-layout'));
      const columns = [...document.querySelectorAll('.today-layout [data-today-status]')].filter(node => node.matches('[data-board-drop-zone]'));
      if (columns.map(node => node.querySelector('h2')?.textContent).join('|') !== 'Todo|In Progress|To Review|Done') throw new Error('Today must show four status boards');
      const panel = document.querySelector('.today-layout .right-panel');
      if (!panel || panel.querySelector('.calendar-rail') || !panel.querySelector('.calendar-content')) throw new Error('Today must expose only Calendar');
      if (panel.getBoundingClientRect().right > columns[0].getBoundingClientRect().left + 1) throw new Error('Today Calendar must be left of the boards');
      const saved = await window.ritua.loadWorkspace();
      const existing = saved.entities.find(e => e.kind === 'task' && e.data.content.title === 'Today board workflow');
      if (existing) {
        if (existing.data.content.todayStatus !== 'to-review' || existing.data.content.complete) throw new Error('Today board status must survive restart');
        await wait(() => document.querySelector('[data-today-status="to-review"] [data-board-task-id="' + existing.id + '"]'));
        return { id: existing.id, existing: true };
      }
      const add = columns[0].querySelector('.inline-task-start');
      if (!add) throw new Error('Todo must allow task creation');
      add.click();
      await wait(() => columns[0].querySelector('textarea'));
      const input = columns[0].querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Today board workflow');
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      let task;
      await wait(async () => { task = (await window.ritua.loadWorkspace()).entities.find(e => e.kind === 'task' && e.data.content.title === 'Today board workflow'); return task; });
      await wait(() => columns[0].querySelector('[data-board-task-id="' + task.id + '"]'));
      return { id: task.id, existing: false };
    })()`)
    if (setup.existing) return
    const read = () =>
      window.webContents.executeJavaScript(`(async () => {
        const doc = await window.ritua.loadWorkspace();
        return doc.entities.find(e => e.kind === 'task' && e.id === ${JSON.stringify(setup.id)}).data.content;
      })()`)
    const drag = async (status: string, cancel = false) => {
      const points = await window.webContents.executeJavaScript(`(async () => {
        const target = document.querySelector('.today-layout [data-board-drop-zone][data-today-status="${status}"]');
        target.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 80));
        const source = document.querySelector('.today-layout [data-board-task-id="${setup.id}"]');
        const s = source.getBoundingClientRect(), t = target.getBoundingClientRect();
        return { x: Math.round(s.right - 22), y: Math.round(s.top + 18), tx: Math.round(t.left + t.width / 2), ty: Math.round(t.top + 180) };
      })()`)
      window.webContents.sendInputEvent({ type: 'mouseMove', x: points.x, y: points.y })
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        x: points.x,
        y: points.y,
        button: 'left',
        clickCount: 1,
      })
      for (let step = 1; step <= 18; step++) {
        window.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(points.x + ((points.tx - points.x) * step) / 18),
          y: Math.round(points.y + ((points.ty - points.y) * step) / 18),
          button: 'left',
        })
        await pause(20)
      }
      if (cancel) window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
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
    const expect = async (status: string) => {
      for (let i = 0; i < 100; i++) {
        const task = await read()
        const savedStatus = task.complete ? 'done' : task.todayStatus || 'todo'
        const visible = await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.today-layout [data-board-drop-zone][data-today-status="${status}"] [data-board-task-id="${setup.id}"]'))`,
        )
        if (savedStatus === status && visible) return
        await pause()
      }
      throw new Error('Today drag must persist and render ' + status + ': ' + JSON.stringify(await read()))
    }
    await expect('todo')
    const original = await read()
    await drag('done', true)
    assert.deepEqual(await read(), original, 'Canceled Done drop must preserve all task fields')
    await drag('in-progress')
    await expect('in-progress')
    await drag('to-review')
    await expect('to-review')
    await drag('done')
    await expect('done')
    assert.ok((await read()).completedDateKey, 'Done uses canonical completion metadata')
    await drag('to-review')
    await expect('to-review')
    assert.equal((await read()).completedDateKey, null, 'Moving out of Done reopens the task')
    await verifyTodayStatusScheduling(window, setup.id)
    console.log(
      'PASS: Today status columns, left Calendar, canceled Done drag, native status transitions, completion and reopening.',
    )
  } finally {
    window.setBounds(bounds)
  }
}

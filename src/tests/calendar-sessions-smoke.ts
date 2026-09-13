import { testCalendarSessions } from "./calendar-session-tests"
import type { BrowserWindow } from 'electron'

export async function verifyCalendarSessions(window: BrowserWindow, phase: 'write' | 'read') {
  window.show(); window.focus()
  const setup = await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 150; i++) { if (await predicate()) return; await pause(); } throw new Error('Session timeout: ' + predicate.toString() + ' ' + document.body.innerText.slice(-1000)); };
    const click = (label, root = document) => { const node = [...root.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent.trim() === label); check(node, 'Missing ' + label); node.click(); };
    const fill = (label, text) => { const node = document.querySelector('input[aria-label="' + label + '"]'); check(node, 'Missing field ' + label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); };
    const load = () => window.ritua.loadWorkspace();
    const session = async () => (await load()).entities.find(entity => entity.kind === 'event' && entity.data.content.title === 'Session persistence check');
    click('Today');
    await wait(() => document.querySelector('.today-layout'));
    const calendarTab = document.querySelector('[id="right-panel-tab-calendar"]');
    if (calendarTab) calendarTab.click();
    if (document.querySelector('[aria-label="Open right panel"]')) click('Open right panel');
    await wait(() => document.querySelector('.right-panel .timeline'));
    if (${JSON.stringify(phase)} === 'read') {
      const saved = await session();
      check(saved && saved.data.content.end - saved.data.content.start === 245, 'Resized session must survive Electron restart');
      check(saved.data.content.taskIds.length === 2, 'Session task references must survive restart');
      const doc = await load();
      check(doc.entities.find(entity => entity.id === saved.data.content.taskIds[0] && entity.kind === 'task').data.content.complete, 'Session completion must survive restart');
      await wait(() => document.querySelector('[data-calendar-event-id="' + saved.id + '"] .session-progress')?.value === 1);
      return { id: saved.id, phase: 'read' };
    }
    const before = (await load()).entities.filter(entity => entity.kind === 'task').length;
    const timeline = document.querySelector('.right-panel .timeline');
    timeline.focus(); timeline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(() => document.querySelector('[aria-label="Create a session from this calendar time"]'));
    check(!document.querySelector('[aria-label="Session area"]'), 'Sessions do not offer an Area');
    fill('Session title', 'Session persistence check'); await pause(); click('Create session');
    await wait(session);
    const created = await session();
    check(created.data.content.channel === undefined, 'Sessions persist independently of Areas');
    check(created.data.content.end - created.data.content.start === 180, 'Default session is three hours');
    check((await load()).entities.filter(entity => entity.kind === 'task').length === before, 'Session creation cannot create a task');
    const card = document.querySelector('[data-calendar-event-id="' + created.id + '"]');
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    check(!card.querySelector('.session-add-link'), 'Calendar session cards have no Add tasks button');
    card.querySelector('.calendar-event-drag-surface').click();
    await wait(() => document.querySelector('dialog.session-details[open]'));
    check(document.querySelector('dialog.session-details').matches(':modal'), 'Session details trap focus natively');
    click('Add tasks', document.querySelector('dialog.session-details'));
    await pause();
    for (const title of ['Session first task', 'Session second task']) {
      fill('Search or create a task', title); await pause();
      document.querySelector('[aria-label="Search or create a task"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait(async () => (await load()).entities.some(entity => entity.kind === 'task' && entity.data.content.title === title));
    }
    const details = document.querySelector('.session-details');
    click('Remove Session second task from session', details);
    await wait(async () => (await session()).data.content.taskIds.length === 1);
    check((await load()).entities.filter(entity => entity.kind === 'task').length === before + 2, 'Removing membership retains the task');
    fill('Search or create a task', 'Session second task'); await pause();
    const existing = [...details.querySelectorAll('.session-task-options button')].find(button => button.textContent.includes('Session second task'));
    check(existing, 'Existing task can be added back'); existing.click();
    await wait(async () => (await session()).data.content.taskIds.length === 2);
    click('Move Session second task up', details); await pause();
    click('Complete Session second task', details);
    await wait(() => details.querySelector('progress').value === 1);
    await wait(async () => {
      const doc = await load();
      const event = doc.entities.find(entity => entity.id === created.id && entity.kind === 'event');
      const first = doc.entities.find(entity => entity.id === event.data.content.taskIds[0] && entity.kind === 'task');
      return first.data.content.title === 'Session second task' && first.data.content.complete;
    });
    check(document.querySelector('.right-panel .completion-marker'), 'Session check-off shows a green calendar completion marker');
    const beforeDelete = await session();
    click('Delete session', details);
    await wait(async () => !(await session()));
    click('Undo');
    await wait(session);
    check(JSON.stringify((await session()).data.content) === JSON.stringify(beforeDelete.data.content), 'Delete session Undo restores time and membership');
    check((await load()).entities.filter(entity => entity.kind === 'task').length === before + 2, 'Session references must never duplicate tasks');
    const taskTitle = document.querySelector('[data-calendar-event-id="' + created.id + '"] .session-task-drag-handle');
    taskTitle.click();
    await wait(() => document.querySelector('[aria-label="Task title"]'));
    check(document.querySelector('[aria-label="Task title"]').value === 'Session second task', 'Clicking a session title opens canonical task details');
    click('Close task details');
    await wait(() => !document.querySelector('[aria-label="Task title"]'));
    check(document.activeElement === taskTitle, 'Closing task details returns focus to the session task');
    const handle = document.querySelector('[data-calendar-event-id="' + created.id + '"] [data-resize-handle]');
    handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await wait(async () => (await session()).data.content.end === created.data.content.end + 5);
    return { id: created.id, phase: 'write', end: created.data.content.end + 5 };
  })()`)
  if (phase === 'read') return
  const point = async (selector: string) => window.webContents.executeJavaScript(`(async () => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('Missing session gesture handle');
    node.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`)
  const drag = async (selector: string, dx: number, dy: number, cancel = false, verifyAnimated = false) => {
    const start = await point(selector)
    let animated = false
    window.webContents.sendInputEvent({ type: 'mouseMove', ...start })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 12; step++) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + dx * step / 12), y: Math.round(start.y + dy * step / 12), button: 'left' })
      await new Promise(resolve => setTimeout(resolve, 20))
      if (verifyAnimated) animated ||= await window.webContents.executeJavaScript(`document.getAnimations().some(animation => animation.effect?.target?.closest('.session-checklist') && animation.effect.getKeyframes().some(frame => frame.translate || frame.transform))`)
    }
    if (verifyAnimated && !animated) throw new Error('Session rows did not animate during reordering')
    if (cancel) window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + dx, y: start.y + dy, button: 'left', clickCount: 1 })
    if (cancel) window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await new Promise(resolve => setTimeout(resolve, 200))
    if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('[aria-label="Task title"]'))`)) throw new Error('Dragging must not open task details')
  }
  const selector = `[data-calendar-event-id="${setup.id}"]`
  await drag(`${selector} [data-resize-handle]`, 0, 60)
  const saved = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const event = (await window.ritua.loadWorkspace()).entities.find(entity => entity.kind === 'event' && entity.id === ${JSON.stringify(setup.id)});
      if (event?.data.content.end === ${setup.end + 60}) return event;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Native session resize did not persist');
  })()`)
  const detached = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('${selector} .calendar-event-drag-surface').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    document.querySelector('[aria-label="Remove Session first task from session"]').click();
    await new Promise(resolve => setTimeout(resolve, 150));
    document.querySelector('[aria-label="Close session"]').click();
    const doc = await window.ritua.loadWorkspace();
    return { task: doc.entities.find(entity => entity.kind === 'task' && entity.data.content.title === 'Session first task'), events: doc.entities.filter(entity => entity.kind === 'event') };
  })()`)
  const taskSelector = `[data-board-task-id="${detached.task.id}"]`
  const targetPoint = await point(`${selector} .session-card-body`)
  const taskPoint = await point(taskSelector)
  await drag(taskSelector, targetPoint.x - taskPoint.x, targetPoint.y - taskPoint.y, true)
  const canceledDoc = await window.webContents.executeJavaScript(`window.ritua.loadWorkspace()`)
  if (JSON.stringify(canceledDoc.entities.filter((entity: { kind: string }) => entity.kind === 'event')) !== JSON.stringify(detached.events)) throw new Error('Canceled task drop changed session membership')
  await drag(taskSelector, targetPoint.x - taskPoint.x, targetPoint.y - taskPoint.y)
  const dropped = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      const event = doc.entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event');
      if (event.data.content.taskIds.length === 2) return doc;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Native task drag into session did not persist');
  })()`)
  if (JSON.stringify(dropped.entities.find((entity: { id: string; kind: string }) => entity.id === detached.task.id && entity.kind === 'task').data) !== JSON.stringify(detached.task.data)) throw new Error('Session drop changed task lane, Area, or schedule')
  if (dropped.entities.filter((entity: { kind: string }) => entity.kind === 'event').length !== detached.events.length) throw new Error('Session drop created an individual calendar block')
  await drag(taskSelector, targetPoint.x - taskPoint.x, targetPoint.y - taskPoint.y)
  const rowSelector = `${selector} [data-session-task-id="${detached.task.id}"] .session-task-drag-handle`
  const readSession = async () => window.webContents.executeJavaScript(`(async () => (await window.ritua.loadWorkspace()).entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event'))()`)
  await drag(rowSelector, 0, -25, false, true)
  if ((await readSession()).data.content.taskIds[0] !== detached.task.id) throw new Error('Dragging within calendar session did not reorder tasks')
  await drag(rowSelector, 0, 30)
  if ((await readSession()).data.content.taskIds[1] !== detached.task.id) throw new Error('Dragging down in calendar session did not reorder tasks')
  await drag(rowSelector, 0, -25, true)
  if ((await readSession()).data.content.taskIds[1] !== detached.task.id) throw new Error('Canceled animated reorder must restore the original order')
  await drag(rowSelector, -300, 0, true)
  if ((await readSession()).data.content.taskIds.length !== 2) throw new Error('Escape must cancel dragging out of a session')
  await drag(rowSelector, -300, 0)
  if ((await readSession()).data.content.taskIds.includes(detached.task.id)) throw new Error('Dragging out did not remove session membership')
  const removedDoc = await window.webContents.executeJavaScript(`window.ritua.loadWorkspace()`)
  if (JSON.stringify(removedDoc.entities.find((entity: { id: string; kind: string }) => entity.id === detached.task.id && entity.kind === 'task').data) !== JSON.stringify(detached.task.data)) throw new Error('Dragging out changed the canonical task')
  const returnTarget = await point(`${selector} .session-card-body`)
  const returnSource = await point(taskSelector)
  await drag(taskSelector, returnTarget.x - returnSource.x, returnTarget.y - returnSource.y)
  await drag(`${selector} [data-resize-handle]`, 0, 60, true)
  await drag(`${selector} .calendar-event-drag-surface`, -350, 30)
  const after = await window.webContents.executeJavaScript(`window.ritua.loadWorkspace()`)
  const event = after.entities.find((entity: { id: string; kind: string }) => entity.id === setup.id && entity.kind === 'event')
  if (JSON.stringify(event.data.content) !== JSON.stringify(saved.data.content)) throw new Error('Canceled resize or dropping outside the calendar changed the session')
}

export async function runCalendarSessionsSmoke(window: BrowserWindow) {
  testCalendarSessions()
  const phase = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 150; i++) {
      if (document.querySelector('nav button')) {
        const doc = await window.ritua.loadWorkspace();
        return doc.entities.some(entity => entity.kind === 'event' && entity.data.content.kind === 'session') ? 'read' : 'write';
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Session workspace did not open');
  })()`)
  await verifyCalendarSessions(window, phase)
  return { phase, sessions: true }
}

import { app, type BrowserWindow } from 'electron'
import { testCalendarSessionsPersistence as testCalendarSessions } from './calendar-session-persistence-tests'
import { verifyCalendarOverlapCreation } from './calendar-overlap-smoke'

export async function verifyCalendarSessions(window: BrowserWindow, phase: 'write' | 'read') {
  window.show()
  app.focus({ steal: true })
  window.focus()
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
      const taskDocument = await load();
      const selectedTask = taskDocument.entities.find(entity => entity.kind === 'task' && entity.data.content.title === 'Calendar selection task');
      check(selectedTask?.data.content.channel === 'Personal' && selectedTask.data.content.minutes === 45, 'Calendar-created task keeps Area and duration after restart');
      check(taskDocument.entities.some(entity => entity.kind === 'event' && entity.data.taskId === selectedTask.id && entity.data.content.start === 600 && entity.data.content.end === 645), 'Calendar-created task schedule survives restart');
      const saved = await session();
      check(saved && saved.data.content.end - saved.data.content.start === 245, 'Resized session must survive Electron restart');
      check(saved.data.content.taskIds.length === 2, 'Session task references must survive restart');
      const doc = await load();
      check(doc.entities.find(entity => entity.id === saved.data.content.taskIds[1] && entity.kind === 'task').data.content.complete, 'Session completion must survive restart');
      await wait(() => document.querySelector('[data-calendar-event-id="' + saved.id + '"] .project-progress-circle-value')?.getAttribute('stroke-dashoffset') === '50');
      check(document.querySelector('[aria-label="Unschedule Session first task"]')?.classList.contains('scheduled'), 'Session membership restores the active schedule button after restart');
      const boardOrder = [...document.querySelectorAll('.today-layout [data-board-task-id]')].map(card => card.dataset.boardTaskId).filter(id => saved.data.content.taskIds.includes(id));
      check(JSON.stringify(boardOrder) === JSON.stringify(saved.data.content.taskIds), 'Shared session and board order survives restart');
      return { id: saved.id, phase: 'read' };
    }
    const timelineForTask = document.querySelector('.right-panel .timeline');
    const selectTime = () => {
      timelineForTask.focus();
      timelineForTask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    };
    const initialCount = (await load()).entities.length;
    selectTime();
    await wait(() => document.querySelector('[aria-label="Create from calendar selection"]'));
    check(!document.querySelector('[aria-label="Session title"]') && !document.querySelector('[aria-label="Task title"]'), 'Range selection does not default to a Session or Task');
    check(document.activeElement === document.querySelector('[aria-label="Create from calendar selection"]'), 'Chooser starts with neutral focus');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(() => !document.querySelector('[aria-label="Create from calendar selection"]'));
    check((await load()).entities.length === initialCount, 'Canceling type selection creates nothing');
    selectTime();
    await wait(() => document.querySelector('[aria-label="Create from calendar selection"]'));
    click('Create Task', document.querySelector('[aria-label="Create from calendar selection"]'));
    await wait(() => document.querySelector('[aria-label="Create a task from this calendar time"]'));
    const selectedRange = document.querySelector('.calendar-selection').getAttribute('aria-label');
    const taskForm = document.querySelector('[aria-label="Create a task from this calendar time"]');
    check(taskForm.textContent.includes(selectedRange.slice(9, 14)), 'Task composer preserves selected start');
    fill('Task title', 'Calendar selection task'); await pause();
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const dateKey = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
    fill('Task date', dateKey); await pause();
    click('Task start time'); await pause(); click('10:00', document.querySelector('.dropdown-menu')); await pause();
    click('Task end time'); await pause(); click('10:45', document.querySelector('.dropdown-menu')); await pause();
    click('Task area'); await pause(); click('Personal', document.querySelector('.dropdown-menu')); await pause();
    click('Create task');
    await wait(async () => (await load()).entities.some(entity => entity.kind === 'task' && entity.data.content.title === 'Calendar selection task'));
    const taskDocument = await load();
    const selectedTask = taskDocument.entities.find(entity => entity.kind === 'task' && entity.data.content.title === 'Calendar selection task');
    check(selectedTask.data.lane === 'date:' + dateKey && selectedTask.data.content.channel === 'Personal' && selectedTask.data.content.minutes === 45, 'Task choice creates a canonical task on the selected date and Area');
    check(taskDocument.entities.filter(entity => entity.kind === 'event' && entity.data.taskId === selectedTask.id).length === 1, 'Task choice creates exactly one linked calendar block');
    check(!taskDocument.entities.some(entity => entity.kind === 'event' && entity.data.content.kind === 'session'), 'Task choice never creates a session');
    const before = (await load()).entities.filter(entity => entity.kind === 'task').length;
    const timeline = document.querySelector('.right-panel .timeline');
    timeline.focus(); timeline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(() => document.querySelector('[aria-label="Create from calendar selection"]'));
    click('Create Session', document.querySelector('[aria-label="Create from calendar selection"]'));
    await wait(() => document.querySelector('[aria-label="Create a session from this calendar time"]'));
    check(!document.querySelector('[aria-label="Session area"]'), 'Sessions do not offer an Area');
    const rangeTimes = document.querySelector('.calendar-selection').getAttribute('aria-label').match(/([0-9]{2}):([0-9]{2})/g);
    const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const rangeStart = toMinutes(rangeTimes[0]);
    check(toMinutes(rangeTimes[1]) - rangeStart === 5, 'Keyboard creation follows the calendar five-minute increment');
    // Explicitly choose a longer range to leave room for the native checklist drag regressions below.
    const fixtureEnd = rangeStart + 180;
    const fixtureEndLabel = String(Math.floor(fixtureEnd / 60)).padStart(2, '0') + ':' + String(fixtureEnd % 60).padStart(2, '0');
    click('Session end time'); await pause();
    click(fixtureEndLabel, document.querySelector('.dropdown-menu')); await pause();
    fill('Session title', 'Session persistence check'); await pause(); click('Create session');
    await wait(session);
    const created = await session();
    check(created.data.content.channel === undefined, 'Sessions persist independently of Areas');
    check(created.data.content.end - created.data.content.start === 180, 'Session preserves the explicitly selected range');
    check((await load()).entities.filter(entity => entity.kind === 'task').length === before, 'Session creation cannot create a task');
    const card = document.querySelector('[data-calendar-event-id="' + created.id + '"]');
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    check(!card.querySelector('.session-add-link'), 'Calendar session cards have no Add tasks button');
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 5, clientY: innerHeight - 5 }));
    await wait(() => document.querySelector('[data-task-context-item="add-tasks"]'));
    check(!document.querySelector('[data-task-context-item="area"]'), 'Session menu must not offer task-only actions');
    const menuBounds = document.querySelector('.task-context-menu').getBoundingClientRect();
    check(menuBounds.right <= innerWidth && menuBounds.bottom <= innerHeight, 'Calendar context menu stays inside viewport');
    document.querySelector('[data-task-context-item="add-tasks"]').click();
    await wait(() => document.querySelector('dialog.session-details[open]'));
    check(document.querySelector('dialog.session-details').matches(':modal'), 'Session details trap focus natively');
    check(document.querySelector('[aria-label="Search or create a task"]'), 'Context Add tasks opens the session picker');
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
    const autoTask = (await load()).entities.find(entity => entity.kind === 'task' && entity.data.content.title === 'Session second task');
    click('Remove Session second task from session', details);
    // Keep this regression independent of the wall clock, including the last minutes of the day.
    fill('Session start time', '00:00'); await pause();
    fill('Session end time', '00:00'); await pause();
    await wait(async () => { const event = await session(); return event.data.content.start === 0 && event.data.content.end === 1440 && event.data.content.taskIds.length === 1; });
    click('Done', details);
    await wait(() => !document.querySelector('dialog.session-details[open]'));
    const arrivalRow = () => document.querySelector('[data-calendar-event-id="' + created.id + '"] [data-session-task-id="' + autoTask.id + '"]');
    const arrivalSamples = [];
    let samplingArrival = true;
    const sampleArrival = () => {
      const row = arrivalRow();
      if (row) arrivalSamples.push(Number(getComputedStyle(row).opacity));
    };
    const arrivalObserver = new MutationObserver(sampleArrival);
    arrivalObserver.observe(card, { childList: true, subtree: true, attributes: true });
    const sampleArrivalFrame = () => {
      if (!samplingArrival) return;
      sampleArrival();
      requestAnimationFrame(sampleArrivalFrame);
    };
    requestAnimationFrame(sampleArrivalFrame);
    click('Auto schedule Session second task');
    await wait(() => arrivalRow()?.getAnimations().some(animation => animation.effect.getKeyframes().some(frame => frame.translate)));
    check(!card.getAnimations().length, 'Auto schedule animates the added task row, never the whole session');
    await wait(async () => (await session()).data.content.taskIds.includes(autoTask.id));
    await wait(() => !document.querySelector('[aria-label="Unschedule Session second task"]')?.disabled);
    samplingArrival = false;
    arrivalObserver.disconnect();
    sampleArrival();
    check(arrivalSamples[0] === 0, 'Session task must be hidden from its first insertion until arrival begins: ' + JSON.stringify(arrivalSamples));
    check(arrivalSamples.every((opacity, index) => index === 0 || opacity >= arrivalSamples[index - 1] - 0.001), 'Session task must fade in once without flashing or disappearing: ' + JSON.stringify(arrivalSamples));
    check(arrivalSamples.at(-1) === 1, 'Session task remains visible after arrival');
    check(document.querySelector('[aria-label="Unschedule Session second task"]')?.classList.contains('scheduled'), 'Session tasks use the active Auto Schedule button');
    check(document.querySelector('[data-calendar-event-id="' + created.id + '"] [data-session-task-id="' + autoTask.id + '"]'), 'Auto schedule reveals the task inside the ongoing session');
    const boardCard = document.querySelector('[data-board-task-id="' + autoTask.id + '"]');
    check(boardCard.querySelector('.time-chip').textContent === '00:00-24:00', 'Session task card shows its full time range');
    check(boardCard.querySelector('.task-session-name').textContent.length === 20 && boardCard.querySelector('.task-session-name').title === 'Session persistence check', 'Session name is limited to 20 characters with its full title available');
    const afterAutoSchedule = await load();
    check(JSON.stringify(afterAutoSchedule.entities.find(entity => entity.kind === 'task' && entity.id === autoTask.id).data.content) === JSON.stringify(autoTask.data.content), 'Joining an ongoing session retains canonical task content and duration');
    check(!afterAutoSchedule.entities.some(entity => entity.kind === 'event' && entity.data.taskId === autoTask.id), 'Joining a session must not create a separate calendar event');
    click('Unschedule Session second task'); await pause();
    click('Cancel'); await pause();
    check((await session()).data.content.taskIds.filter(id => id === autoTask.id).length === 1, 'Canceling session removal preserves membership');
    click('Unschedule Session second task'); await pause();
    click('Unschedule');
    await wait(async () => !(await session()).data.content.taskIds.includes(autoTask.id));
    check(document.querySelector('[aria-label="Auto schedule Session second task"]') && !arrivalRow(), 'Removing a task from sessions resets the button and checklist');
    click('Auto schedule Session second task');
    await wait(async () => (await session()).data.content.taskIds.includes(autoTask.id));
    await wait(() => !document.querySelector('[aria-label="Unschedule Session second task"]')?.disabled);
    card.querySelector('.calendar-event-drag-surface').click();
    await wait(() => document.querySelector('dialog.session-details[open]'));
    const timeValue = minute => String(Math.floor(minute / 60) % 24).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    fill('Session start time', timeValue(created.data.content.start)); await pause();
    fill('Session end time', timeValue(created.data.content.end)); await pause();
    await wait(async () => { const event = await session(); return event.data.content.start === created.data.content.start && event.data.content.end === created.data.content.end; });
    const currentDetails = document.querySelector('.session-details');
    click('Move Session second task up', currentDetails); await pause();
    click('Complete Session second task', currentDetails);
    await wait(() => currentDetails.querySelector('progress').value === 1);
    const rowMoving = () => [...card.querySelectorAll('[data-session-task-id]')].some(row => row.getAnimations().some(animation => animation.playState === 'running' && animation.effect.getKeyframes().some(frame => frame.translate)));
    await wait(rowMoving);
    check(card.querySelectorAll('[data-session-task-id]')[1].dataset.sessionTaskId === autoTask.id, 'Completion moves to the completed section with row animation');
    await wait(async () => {
      const doc = await load();
      const event = doc.entities.find(entity => entity.id === created.id && entity.kind === 'event');
      const first = doc.entities.find(entity => entity.id === event.data.content.taskIds[1] && entity.kind === 'task');
      return first.data.content.title === 'Session second task' && first.data.content.complete;
    });
    check(document.querySelector('.right-panel .completion-marker'), 'Session check-off shows a green calendar completion marker');
    click('Reopen Session second task', currentDetails);
    await wait(() => currentDetails.querySelector('progress').value === 0);
    await wait(async () => {
      const doc = await load();
      const saved = doc.entities.find(entity => entity.id === created.id && entity.kind === 'event');
      return saved.data.content.taskIds[0] === autoTask.id && !doc.entities.find(entity => entity.id === autoTask.id && entity.kind === 'task').data.content.complete;
    });
    const beforeDelete = await session();
    click('Delete session', currentDetails);
    await wait(async () => !(await session()));
    click('Undo');
    await wait(session);
    check(JSON.stringify((await session()).data.content) === JSON.stringify(beforeDelete.data.content), 'Delete session Undo restores time and membership');
    check((await load()).entities.filter(entity => entity.kind === 'task').length === before + 2, 'Session references must never duplicate tasks');
    const sessionCard = () => document.querySelector('[data-calendar-event-id="' + created.id + '"]');
    const sessionHandle = () => sessionCard().querySelector('.calendar-event-drag-surface');
    sessionHandle().focus();
    sessionHandle().dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await wait(() => document.querySelector('[data-task-context-item="delete"]'));
    document.querySelector('[data-task-context-item="delete"]').click();
    await wait(() => document.querySelector('[role="dialog"][aria-label="Delete this session?"]'));
    click('Cancel', document.querySelector('[aria-label="Delete this session?"]'));
    await wait(() => !document.querySelector('[aria-label="Delete this session?"]'));
    check(await session(), 'Canceling session context deletion preserves the session');
    document.querySelector('[data-task-context-item="delete"]').click();
    await wait(() => document.querySelector('[aria-label="Delete this session?"]'));
    click('Delete session', document.querySelector('[aria-label="Delete this session?"]'));
    await wait(async () => !(await session()));
    check((await load()).entities.filter(entity => entity.kind === 'task').length === before + 2, 'Context deletion preserves canonical tasks');
    click('Undo');
    await wait(session);
    check(JSON.stringify((await session()).data.content) === JSON.stringify(beforeDelete.data.content), 'Context Undo restores session time and membership');
    const taskTitle = document.querySelector('[data-calendar-event-id="' + created.id + '"] .session-task-drag-handle');
    taskTitle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 }));
    await wait(() => document.querySelector('[data-task-context-item="calendar"]'));
    check(!document.querySelector('[data-task-context-item="add-tasks"]'), 'Nested task menu must not open its parent session menu');
    document.querySelector('[data-task-context-item="open"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(() => !document.querySelector('.task-context-menu') && document.activeElement === taskTitle);
    taskTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
    await wait(() => document.querySelector('[data-task-context-item="open"]'));
    document.querySelector('[data-task-context-item="open"]').click();
    await wait(() => document.querySelector('[aria-label="Task title"]'));
    check(document.querySelector('[aria-label="Task title"]').value === 'Session second task', 'Clicking a session title opens canonical task details');
    check(!document.querySelector('.task-details-time-summary'), 'Session members hide task actual time and planned time');
    check(!document.querySelector('.task-card .duration-chip, .task-card .subtask-duration'), 'Task cards never show logged or planned durations');
    click('Close task details');
    await wait(() => !document.querySelector('[aria-label="Task title"]'));
    check(document.activeElement === taskTitle, 'Closing task details returns focus to the session task');
    const handle = document.querySelector('[data-calendar-event-id="' + created.id + '"] [data-resize-handle]');
    handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await wait(async () => (await session()).data.content.end === created.data.content.end + 5);
    return { id: created.id, phase: 'write', end: created.data.content.end + 5 };
  })()`)
  if (phase === 'read') return
  const point = async (selector: string) =>
    window.webContents.executeJavaScript(`(async () => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('Missing session gesture handle');
    node.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 100));
    await Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`)
  const drag = async (
    selector: string,
    dx: number,
    dy: number,
    cancel = false,
    verifyAnimated = false,
    verifySessionAfterDrop = false,
  ) => {
    app.focus({ steal: true })
    window.focus()
    const start = await point(selector)
    // Measuring can wait for pending animations; reacquire focus immediately before native input.
    app.focus({ steal: true })
    window.focus()
    if (!window.isFocused()) throw new Error('Native gesture requires the test window to have focus')
    const isSessionRow = selector.includes('[data-session-task-id=')
    const readBoard = () =>
      window.webContents.executeJavaScript(`({
      order: [...document.querySelectorAll('.today-layout [data-board-task-id]')].map(card => card.dataset.boardTaskId),
      animating: [...document.querySelectorAll('.today-layout [data-board-task-id]')].some(card => card.getAnimations().some(animation => animation.playState === 'running' && animation.effect.getKeyframes().some(frame => frame.transform || frame.translate))),
    })`)
    const beforeBoard = isSessionRow ? await readBoard() : null
    const readSessionRows = () =>
      window.webContents.executeJavaScript(`({
      order: [...document.querySelectorAll('[data-calendar-event-id="${setup.id}"] [data-session-task-id]')].map(row => row.dataset.sessionTaskId),
      animating: [...document.querySelectorAll('[data-calendar-event-id="${setup.id}"] [data-session-task-id]')].some(row => row.getAnimations().some(animation => animation.playState === 'running' && animation.effect.getKeyframes().some(frame => frame.translate || frame.transform))),
    })`)
    const beforeRows = verifySessionAfterDrop ? await readSessionRows() : null
    let animated = false
    window.webContents.sendInputEvent({ type: 'mouseMove', ...start })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 12; step++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(start.x + (dx * step) / 12),
        y: Math.round(start.y + (dy * step) / 12),
        button: 'left',
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      if (verifyAnimated)
        animated ||= await window.webContents.executeJavaScript(
          `document.getAnimations().some(animation => animation.effect?.target?.closest('.session-checklist') && animation.effect.getKeyframes().some(frame => frame.translate || frame.transform))`,
        )
      if (isSessionRow) {
        const board = await readBoard()
        if (board.animating || JSON.stringify(board.order) !== JSON.stringify(beforeBoard.order))
          throw new Error(
            'Board changed before the session task was dropped: ' +
              JSON.stringify({ beforeBoard, board, step }),
          )
      }
      if (verifySessionAfterDrop) {
        const rows = await readSessionRows()
        if (rows.animating || JSON.stringify(rows.order) !== JSON.stringify(beforeRows.order))
          throw new Error('Session rows changed before the board card was dropped')
      }
    }
    if (verifyAnimated && !animated) throw new Error('Session rows did not animate during reordering')
    if (cancel) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      // Let the renderer finish canceling before sending the separate pointer release.
      await window.webContents.executeJavaScript(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      )
    }
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      x: start.x + dx,
      y: start.y + dy,
      button: 'left',
      clickCount: 1,
    })
    if (cancel) window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    if (isSessionRow && verifyAnimated && !cancel) {
      let boardAnimated = false
      for (let frame = 0; frame < 20 && !boardAnimated; frame++) {
        boardAnimated = (await readBoard()).animating
        if (!boardAnimated) await new Promise((resolve) => setTimeout(resolve, 16))
      }
      if (!boardAnimated) throw new Error('Session drop did not animate the board reorder')
    }
    if (verifySessionAfterDrop && !cancel) {
      let sessionAnimated = false
      for (let frame = 0; frame < 20 && !sessionAnimated; frame++) {
        sessionAnimated = (await readSessionRows()).animating
        if (!sessionAnimated) await new Promise((resolve) => setTimeout(resolve, 16))
      }
      if (!sessionAnimated) throw new Error('Board drop did not animate the session rows')
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    if (isSessionRow && cancel) {
      const board = await readBoard()
      if (board.animating || JSON.stringify(board.order) !== JSON.stringify(beforeBoard.order))
        throw new Error('Canceling a session reorder changed or animated the board')
    }
    if (verifySessionAfterDrop && cancel) {
      const rows = await readSessionRows()
      if (rows.animating || JSON.stringify(rows.order) !== JSON.stringify(beforeRows.order))
        throw new Error('Canceling a board reorder changed or animated the session')
    }
    if (
      await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('[aria-label="Task title"]'))`,
      )
    )
      throw new Error('Dragging must not open task details')
  }
  const selector = `[data-calendar-event-id="${setup.id}"]`
  await drag(`${selector} [data-resize-handle]`, 0, 60)
  const saved = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const event = (await window.ritua.loadWorkspace()).entities.find(entity => entity.kind === 'event' && entity.id === ${JSON.stringify(setup.id)});
      if (event?.data.content.end === ${setup.end + 60}) return event;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Native session resize did not persist: ' + JSON.stringify({ expected: ${setup.end + 60}, session: (await window.ritua.loadWorkspace()).entities.find(entity => entity.kind === 'event' && entity.id === ${JSON.stringify(setup.id)}), focused: document.hasFocus() }));
  })()`)
  const detached = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('${selector} .calendar-event-drag-surface').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    document.querySelector('[aria-label="Remove Session first task from session"]').click();
    let removed = false;
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      const event = doc.entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event');
      if (event.data.content.taskIds.length === 1) { removed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (!removed) throw new Error('Session task removal did not persist before dragging');
    document.querySelector('[aria-label="Close session"]').click();
    const doc = await window.ritua.loadWorkspace();
    return { task: doc.entities.find(entity => entity.kind === 'task' && entity.data.content.title === 'Session first task'), events: doc.entities.filter(entity => entity.kind === 'event') };
  })()`)
  const taskSelector = `[data-board-task-id="${detached.task.id}"]`
  const targetPoint = await point(`${selector} .session-card-body`)
  const taskPoint = await point(taskSelector)
  await drag(taskSelector, targetPoint.x - taskPoint.x, targetPoint.y - taskPoint.y, true)
  const canceledDoc = await window.webContents.executeJavaScript(`window.ritua.loadWorkspace()`)
  if (
    JSON.stringify(canceledDoc.entities.filter((entity: { kind: string }) => entity.kind === 'event')) !==
    JSON.stringify(detached.events)
  )
    throw new Error(
      'Canceled task drop changed session membership: ' +
        JSON.stringify({
          before: detached.events,
          after: canceledDoc.entities.filter((entity: { kind: string }) => entity.kind === 'event'),
        }),
    )
  await drag(taskSelector, targetPoint.x - taskPoint.x, targetPoint.y - taskPoint.y)
  const dropped = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      const event = doc.entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event');
      if (event.data.content.taskIds.length === 2) return doc;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Native task drag into session did not persist: ' + JSON.stringify({ session: (await window.ritua.loadWorkspace()).entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event'), card: document.querySelector('${selector}')?.getBoundingClientRect(), task: document.querySelector(${JSON.stringify(taskSelector)})?.getBoundingClientRect() }));
  })()`)
  if (
    JSON.stringify(
      dropped.entities.find(
        (entity: { id: string; kind: string }) => entity.id === detached.task.id && entity.kind === 'task',
      ).data.content,
    ) !== JSON.stringify(detached.task.data.content)
  )
    throw new Error('Session drop changed task content')
  if (
    dropped.entities.filter((entity: { kind: string }) => entity.kind === 'event').length !==
    detached.events.length
  )
    throw new Error('Session drop created an individual calendar block')
  await drag(taskSelector, targetPoint.x - taskPoint.x, targetPoint.y - taskPoint.y)
  const rowSelector = `${selector} [data-session-task-id="${detached.task.id}"] .session-task-drag-handle`
  const readSession = async () =>
    window.webContents.executeJavaScript(
      `(async () => (await window.ritua.loadWorkspace()).entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event'))()`,
    )
  const checkSharedOrder = async () => {
    const state = await window.webContents.executeJavaScript(`(async () => {
      const doc = await window.ritua.loadWorkspace();
      const session = doc.entities.find(entity => entity.id === ${JSON.stringify(setup.id)} && entity.kind === 'event').data.content;
      const board = [...document.querySelectorAll('.today-layout [data-board-task-id]')].map(card => card.dataset.boardTaskId).filter(id => session.taskIds.includes(id));
      return { board, session: session.taskIds };
    })()`)
    if (JSON.stringify(state.board) !== JSON.stringify(state.session))
      throw new Error('Session order differs from board: ' + JSON.stringify(state))
  }
  await drag(rowSelector, 0, -25, false, true)
  if ((await readSession()).data.content.taskIds[0] !== detached.task.id)
    throw new Error('Dragging within calendar session did not reorder tasks')
  await checkSharedOrder()
  await drag(rowSelector, 0, 30, false, true)
  if ((await readSession()).data.content.taskIds[1] !== detached.task.id)
    throw new Error('Dragging down in calendar session did not reorder tasks')
  await checkSharedOrder()
  await drag(rowSelector, 0, -25, true)
  if ((await readSession()).data.content.taskIds[1] !== detached.task.id)
    throw new Error('Canceled animated reorder must restore the original order')
  await checkSharedOrder()
  const boardPeerId = (await readSession()).data.content.taskIds[0]
  const boardDragHandle = `${taskSelector} .task-card-topline`
  const boardPeerHandle = `[data-board-task-id="${boardPeerId}"] .task-card-topline`
  const boardSourcePoint = await point(boardDragHandle)
  const boardPeerPoint = await point(boardPeerHandle)
  await drag(boardDragHandle, 0, boardPeerPoint.y - boardSourcePoint.y, true, false, true)
  await checkSharedOrder()
  await drag(boardDragHandle, 0, boardPeerPoint.y - boardSourcePoint.y, false, false, true)
  if ((await readSession()).data.content.taskIds[0] !== detached.task.id)
    throw new Error('Board drag did not reorder the session')
  await checkSharedOrder()
  const boardReturnSource = await point(boardDragHandle)
  const boardReturnTarget = await point(boardPeerHandle)
  await drag(boardDragHandle, 0, boardReturnTarget.y - boardReturnSource.y, false, false, true)
  if ((await readSession()).data.content.taskIds[1] !== detached.task.id)
    throw new Error('Board drag back did not reorder the session')
  await checkSharedOrder()
  const sessionDragOut = async (cancel = false) => {
    const target = await point('.today-layout [data-board-drop-zone][data-today-status="in-progress"]')
    const source = await point(rowSelector)
    await drag(rowSelector, target.x - source.x, target.y - source.y, cancel)
  }
  await sessionDragOut(true)
  if ((await readSession()).data.content.taskIds.length !== 2)
    throw new Error('Escape must cancel dragging out of a session')
  await sessionDragOut()
  if ((await readSession()).data.content.taskIds.includes(detached.task.id))
    throw new Error('Dragging onto a Today status column did not remove session membership')
  const removedDoc = await window.webContents.executeJavaScript(`window.ritua.loadWorkspace()`)
  if (
    JSON.stringify(
      removedDoc.entities.find(
        (entity: { id: string; kind: string }) => entity.id === detached.task.id && entity.kind === 'task',
      ).data.content,
    ) !== JSON.stringify(detached.task.data.content)
  )
    throw new Error('Dragging out changed the canonical task')
  const returnTarget = await point(`${selector} .session-card-body`)
  const returnSource = await point(taskSelector)
  await drag(taskSelector, returnTarget.x - returnSource.x, returnTarget.y - returnSource.y)
  await drag(`${selector} [data-resize-handle]`, 0, 60, true)
  await drag(`${selector} .calendar-event-drag-surface`, -350, 30)
  const after = await window.webContents.executeJavaScript(`window.ritua.loadWorkspace()`)
  const event = after.entities.find(
    (entity: { id: string; kind: string }) => entity.id === setup.id && entity.kind === 'event',
  )
  if (JSON.stringify(event.data.content) !== JSON.stringify(saved.data.content))
    throw new Error('Canceled resize or dropping outside the calendar changed the session')
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('${selector} [aria-label="Complete Session second task"]').click();
    for (let i = 0; i < 100; i++) {
      const doc = await window.ritua.loadWorkspace();
      if (doc.entities.some(entity => entity.kind === 'task' && entity.data.content.title === 'Session second task' && entity.data.content.complete)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Final session completion did not persist');
  })()`)
  await checkSharedOrder()
  await verifyCalendarOverlapCreation(window, setup.id)
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

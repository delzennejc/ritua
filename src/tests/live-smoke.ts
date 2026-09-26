import type { BrowserWindow } from 'electron'

import { localDateKey, addDays, calendarDay, mondayOf } from '../domain/live-calendar'
import { verifyCalendarCompletion } from './calendar-completion-smoke'
import { verifyDailyPlanning } from './daily-planning-smoke'
import { verifyEmptyTaskTitleDeletion } from './task-title-deletion-smoke'
import { verifyPlanningEntry } from './planning-entry-smoke'
import { presentTestWindow } from './test-window'

export async function runLiveSmoke(window: BrowserWindow) {
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') console.error(details.message)
  })
  await presentTestWindow(window)
  const today = localDateKey()
  const future = addDays(today, 400)
  const result = await window.webContents.executeJavaScript(`(async () => {
    const today = ${JSON.stringify(today)}, future = ${JSON.stringify(future)}, label = ${JSON.stringify(calendarDay(today).date)};
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async predicate => { for(let i=0;i<150;i++) { if(await predicate()) return; await pause(); } throw new Error('Live test timeout: '+predicate.toString()+' '+document.body.innerText.slice(-800)); };
    const click = text => { const button = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === text || (() => { const copy = node.cloneNode(true); copy.querySelectorAll('svg,[aria-hidden="true"]').forEach(icon => icon.remove()); return copy.textContent.trim() === text; })()); check(button, 'Missing '+text); button.click(); };
    await wait(() => document.querySelector(${JSON.stringify(today === mondayOf(today) ? '.weekly-planning-view' : '.planning-surface')}));
    click('Today');
    await wait(() => document.querySelector('.today-layout'));
    const api = window.ritua;
    const initial = await api.loadWorkspace();
    check(initial.fields.workspaceDate === today, 'Workspace must use the local day');
    check(document.body.innerText.includes(label), 'Today must display the actual date');
    check(!document.body.innerText.includes('La fête nationale') || today.endsWith('07-14'), 'No fake holiday');
    let task = initial.entities.find(e => e.kind === 'task' && e.data.content.title === 'My first real task');
    if(task) {
      check(task.data.lane === 'today', 'Today task must retain its date on restart');
      check(initial.entities.some(e => e.kind === 'task' && e.data.lane === 'date:'+future), 'Future task must survive restart');
      check(initial.entities.find(e => e.kind === 'task' && e.data.content.title === 'Personal folder capture')?.data.content.channel === 'Personal', 'Inline folder assignment must survive restart');
      return { phase: 'read', today, taskId: task.id };
    }
    check(initial.entities.every(e => e.kind === 'area'), 'Clean first launch must have no demo work');
    check(JSON.stringify(initial.entities.filter(e => e.kind === 'area').sort((a,b) => a.data.position-b.data.position).map(e => e.data.content.label)) === JSON.stringify(['Work', 'Personal']), 'New users must start with exactly Work and Personal');
    check(document.querySelector('.today-layout [role="progressbar"]')?.getAttribute('aria-valuenow') === '0', 'An empty day must show zero progress');
    check(!document.querySelector('.nav-check'), 'Rituals must not be falsely marked done');
    const create = async title => {
      const button = [...document.querySelectorAll('.today-layout button')].find(node => node.textContent.trim().startsWith('Add task'));
      check(button, 'Missing original inline capture'); button.click();
      await wait(() => document.querySelector('textarea'));
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(async () => (await api.loadWorkspace()).entities.some(e => e.kind === 'task' && e.data.content.title === title));
    };
    await create('My first real task');
    const captureRow = () => document.querySelector('.today-layout .inline-task-add');
    captureRow().querySelector('.inline-task-start').click();
    await wait(() => captureRow().querySelector('textarea'));
    const areaDraft = captureRow().querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(areaDraft, 'Personal folder capture');
    areaDraft.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    const areaPicker = captureRow().querySelector('.inline-task-area-trigger');
    areaPicker.focus(); areaPicker.click();
    await wait(() => document.querySelector('[role="menu"][aria-label="Area for new task: Work"]'));
    check(captureRow().querySelector('textarea')?.value === 'Personal folder capture', 'Opening the folder picker must preserve the draft');
    check(!(await api.loadWorkspace()).entities.some(e => e.kind === 'task' && e.data.content.title === 'Personal folder capture'), 'Moving focus into the picker must not commit the draft');
    [...document.querySelectorAll('[role="menuitemradio"]')].find(node => node.textContent.trim() === 'Personal').click();
    await wait(() => document.activeElement === areaDraft);
    check(captureRow().querySelector('.inline-task-area-trigger').getAttribute('aria-label') === 'Area for new task: Personal', 'The picker must show the selected Area');
    areaDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(async () => (await api.loadWorkspace()).entities.some(e => e.kind === 'task' && e.data.content.title === 'Personal folder capture' && e.data.content.channel === 'Personal'));
    check((await api.loadWorkspace()).entities.filter(e => e.kind === 'task' && e.data.content.title === 'Personal folder capture').length === 1, 'Selecting an Area then pressing Enter must create exactly one task');
    captureRow().querySelector('.inline-task-start').click();
    await wait(() => captureRow().querySelector('textarea'));
    const leavingDraft = captureRow().querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(leavingDraft, 'Personal folder blur capture');
    leavingDraft.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    const leavingPicker = captureRow().querySelector('.inline-task-area-trigger');
    leavingPicker.focus(); leavingPicker.click();
    await wait(() => document.querySelector('[role="menu"][aria-label="Area for new task: Personal"]'));
    const outsideCapture = document.querySelector('.today-layout .day-column header');
    outsideCapture.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wait(async () => (await api.loadWorkspace()).entities.some(e => e.kind === 'task' && e.data.content.title === 'Personal folder blur capture' && e.data.content.channel === 'Personal'));
    check((await api.loadWorkspace()).entities.filter(e => e.kind === 'task' && e.data.content.title === 'Personal folder blur capture').length === 1, 'Leaving the open folder picker must save the draft exactly once');
    const beginBacklogDraft = async title => {
      const add = [...document.querySelectorAll('.backlog-view button')].find(node => node.textContent.trim().startsWith('Add task'));
      check(add, 'Missing task capture in Horizons or Areas'); add.click();
      await wait(() => document.activeElement?.matches('.backlog-new-task-row textarea'));
      const input = document.querySelector('.backlog-new-task-row textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      return input;
    };
    const leaveBacklogDraft = async () => {
      await wait(() => document.activeElement?.matches('.backlog-new-task-row textarea'));
      const outside = document.querySelector('.work-index-heading'); outside.tabIndex = -1; outside.focus();
      await wait(() => !document.querySelector('.backlog-new-task-row'));
      await pause(); check(document.activeElement === outside, 'Saving a draft must preserve outside focus');
    };
    for (const scope of ['Anytime', 'Someday', 'Work']) {
      click(scope); await pause(); await wait(() => document.querySelector('.backlog-view'));
      const title = 'Saved on blur in ' + scope;
      await beginBacklogDraft('  ' + title + '  ');
      await leaveBacklogDraft();
      await wait(async () => (await api.loadWorkspace()).entities.filter(e => e.kind === 'task' && e.data.content.title === title).length === 1);
      const continuedTitle = 'Saved before Add task in ' + scope;
      const input = await beginBacklogDraft('Unfinished title');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '  ' + continuedTitle + '  ');
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      const add = [...document.querySelectorAll('.backlog-view button')].find(node => node.textContent.trim().startsWith('Add task'));
      // A button click can run without a preceding blur on macOS.
      add.click();
      await wait(() => document.activeElement?.matches('.backlog-new-task-row textarea') && document.activeElement.value === '');
      await wait(async () => (await api.loadWorkspace()).entities.filter(e => e.kind === 'task' && e.data.content.title === continuedTitle).length === 1);
      const continuedDoc = await api.loadWorkspace();
      const continuedTask = continuedDoc.entities.find(e => e.kind === 'task' && e.data.content.title === continuedTitle);
      const expectedGroup = continuedDoc.fields.backlogGroups.find(group => group.label === (scope === 'Someday' ? 'Someday' : 'Anytime'));
      check(continuedTask.data.content.channel === 'Work' && continuedTask.data.lane === 'backlog:' + expectedGroup.id, 'Add task must save in the original Area and Horizon');
      // Empty repeated clicks must keep a fresh editor without creating another task.
      add.click(); await pause();
      await leaveBacklogDraft();
      check((await api.loadWorkspace()).entities.filter(e => e.kind === 'task' && e.data.content.title === continuedTitle).length === 1, 'Add task and the later blur must save exactly once');
    }
    const beforeEmptyDraft = (await api.loadWorkspace()).entities.filter(e => e.kind === 'task').length;
    await beginBacklogDraft('   '); await leaveBacklogDraft();
    const cancelledDraft = await beginBacklogDraft('Cancelled capture');
    cancelledDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(() => !document.querySelector('.backlog-new-task-row'));
    await pause();
    check((await api.loadWorkspace()).entities.filter(e => e.kind === 'task').length === beforeEmptyDraft, 'Empty and cancelled drafts must not create tasks');
    const submittedDraft = await beginBacklogDraft('Enter capture');
    submittedDraft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(() => document.querySelector('.backlog-new-task-row textarea')?.value === '');
    await pause(); await leaveBacklogDraft();
    await wait(async () => (await api.loadWorkspace()).entities.filter(e => e.kind === 'task' && e.data.content.title === 'Enter capture').length === 1);
    click('Daily planning'); await wait(() => document.body.innerText.includes('Yesterday in review'));
    check(document.querySelector('progress')?.value === 0, 'A new workspace must show zero logged time');
    check(!document.body.innerText.includes('4.5 hr'), 'No sample review totals');
    click('Today'); await wait(() => document.querySelector('.today-layout'));
    document.querySelector('.today-layout [aria-label="Choose a date"]').click();
    await wait(() => document.querySelector('input[type="date"]'));
    const date = document.querySelector('input[type="date"]');
    check(!date.min && !date.max, 'Date picker must not be limited to a prototype month');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(date, future);
    date.dispatchEvent(new Event('input', { bubbles: true })); date.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(() => document.querySelector('.today-layout .day-column')?.getAttribute('data-date-key') === future || document.querySelector('.today-layout').innerText.includes(${JSON.stringify(calendarDay(future).date)}));
    await create('A task next year');
    const saved = await api.loadWorkspace();
    check(saved.entities.some(e => e.kind === 'task' && e.data.lane === 'date:'+future), 'Native capture must persist the chosen future date');
    click('Home'); await pause(); click('Today'); await pause();
    task = saved.entities.find(e => e.kind === 'task' && e.data.content.title === 'My first real task');
    const RealDate = Date;
    const tomorrow = ${JSON.stringify(addDays(today, 1))};
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [tomorrow+'T12:00:00'])); } static now() { return new RealDate(tomorrow+'T12:00:00').getTime(); } };
    window.dispatchEvent(new Event('focus'));
    await wait(async () => (await api.loadWorkspace()).fields.workspaceDate === tomorrow);
    const rolled = await api.loadWorkspace();
    check(rolled.entities.find(e => e.id === task.id).data.lane === 'date:'+today, 'Midnight must preserve the previous day assignment');
    await wait(() => document.querySelector(${JSON.stringify(addDays(today, 1) === mondayOf(addDays(today, 1)) ? '.weekly-planning-view' : '.yesterday-review')}));
    click('Today'); await wait(() => document.querySelector('.today-layout'));
    check(document.querySelector('.today-layout').innerText.includes(${JSON.stringify(calendarDay(addDays(today, 1)).date)}), 'Rendered Today must advance after midnight');
    window.Date = RealDate;
    window.dispatchEvent(new Event('focus'));
    await wait(async () => (await api.loadWorkspace()).fields.workspaceDate === today);
    click('Today'); await wait(() => document.querySelector('.today-layout'));
    return { phase: 'write', today, taskId: task.id };
  })()`)
  await verifyCalendarCompletion(window, result.phase)
  await verifyDailyPlanning(window, result.phase)
  await verifyEmptyTaskTitleDeletion(window, result.phase)
  if (result.phase === 'write') await verifyPlanningEntry(window)
  return result
}

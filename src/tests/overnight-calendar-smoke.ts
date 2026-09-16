import type { BrowserWindow } from 'electron'

export async function verifyOvernightCalendar(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 150; i++) { if (await predicate()) return; await pause(); } throw new Error('Overnight timeout: ' + predicate.toString()); };
    const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
    const click = label => { check(button(label), 'Missing ' + label); button(label).click(); };
    const fill = (input, value) => {
      Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    click('Today');
    await wait(() => button('Add task'));
    click('Add task');
    await wait(() => document.querySelector('textarea[aria-label="New task"]'));
    const title = document.querySelector('textarea[aria-label="New task"]');
    fill(title, 'Overnight schedule check'); await pause();
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(() => button('Overnight schedule check'));
    click('Overnight schedule check');
    await wait(() => button('Schedule task')); click('Schedule task');
    await wait(() => document.querySelector('input[name="start"]'));
    fill(document.querySelector('input[name="start"]'), '23:45');
    fill(document.querySelector('input[name="end"]'), '02:00'); await pause();
    check(document.querySelector('.task-details-schedule-editor').textContent.includes('Ends (next day)'), 'Editor identifies overnight end');
    click('Save time');
    const api = window.ritua;
    let taskId;
    await wait(async () => {
      const doc = await api.loadWorkspace();
      taskId = doc.entities.find(e => e.kind === 'task' && e.data.content.title === 'Overnight schedule check')?.id;
      return doc.entities.some(e => e.kind === 'event' && e.data.taskId === taskId && e.data.content.start === 1425 && e.data.content.end === 1560);
    });
    const saved = await api.loadWorkspace();
    check(saved.entities.find(e => e.kind === 'task' && e.id === taskId).data.content.minutes === 135, 'Native save retains the full overnight duration');
    click('Close task details');
    const event = () => document.querySelector('[data-calendar-event-id="' + taskId + '"]');
    await wait(event);
    check(event().style.top === '1425px' && event().textContent.includes('24:00'), 'First-day block stops at midnight');
    check(!event().querySelector('[data-resize-handle]'), 'Continuation edge is not a resize handle');
    click('Next day');
    await wait(() => event()?.style.top === '0px');
    check(event().textContent.includes('02:00'), 'Following morning shows the same task through 02:00');
    event().querySelector('[data-resize-handle]').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
    await wait(async () => (await api.loadWorkspace()).entities.some(e => e.kind === 'event' && e.data.taskId === taskId && e.data.content.end === 1565));
    event().querySelector('.calendar-event-drag-surface').click();
    await wait(() => button('Schedule task')); click('Schedule task');
    await wait(() => document.querySelector('input[name="end"]'));
    check(document.querySelector('input[name="start"]').value === '23:45' && document.querySelector('input[name="end"]').value === '02:05', 'Editing the continuation opens the whole block');
    click('Remove block');
    await wait(async () => !(await api.loadWorkspace()).entities.some(e => e.kind === 'event' && e.data.taskId === taskId));
    click('More task actions'); await wait(() => button('Delete task')); click('Delete task');
    await wait(() => document.querySelector('.task-details-delete-confirmation .dropdown-option-danger'));
    document.querySelector('.task-details-delete-confirmation .dropdown-option-danger').click();
    await wait(async () => !(await api.loadWorkspace()).entities.some(e => e.kind === 'task' && e.id === taskId));
    click('Previous day');
  })()`)
}

import type { BrowserWindow } from 'electron'

// Runs only in the native smoke workspace, exercising actual controls and typed IPC saves.
export async function verifyCalendarCompletion(window: BrowserWindow, phase: 'write' | 'read') {
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Calendar completion timeout: ' + predicate.toString()); };
    const click = label => {
      const button = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
      check(button, 'Missing ' + label); button.click();
    };
    const api = window.ritua;
    const saved = await api.loadWorkspace();
    const ids = ['completion-first', 'completion-following', 'completion-later'];
    const block = (doc, id) => doc.entities.find(e => e.kind === 'event' && e.id === id)?.data.content;
    const task = (doc, id) => doc.entities.find(e => e.kind === 'task' && e.id === id)?.data.content;
    if (${JSON.stringify(phase)} === 'read') {
      check(task(saved, ids[0])?.complete && block(saved, ids[0]).end === 690, 'Adjusted completion must survive native restart');
      check(task(saved, ids[0]).actualMinutes === 90, 'Actual calendar duration must survive native restart');
      check(block(saved, ids[1]).start === 690 && task(saved, ids[1]).time === '11:30', 'Following task timing must survive native restart');
      return;
    }
    const dateKey = saved.fields.workspaceDate;
    const put = ids.flatMap((id, index) => {
      const start = [600, 660, 720][index], duration = [60, 30, 45][index];
      return [
        { kind: 'task', id, data: { lane: 'today', position: 100 + index, content: { id, title: id, channel: 'Work', minutes: duration, actualMinutes: index === 0 ? 10 : null, time: ['10:00', '11:00', '12:00'][index], complete: false } } },
        { kind: 'event', id, data: { position: 100 + index, taskId: id, derived: ['title', 'complete'], content: { id, dateKey, start, end: start + duration, color: 'violet' } } },
      ];
    });
    const response = await api.saveWorkspace({ revision: saved.revision, requestId: crypto.randomUUID(), put, remove: [], fields: saved.fields });
    check(response.ok, 'Completion fixture saves through validated IPC');
  })()`)
  if (phase === 'read') return
  await new Promise<void>((resolve) => {
    window.webContents.once('did-finish-load', () => resolve())
    window.webContents.reload()
  })
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Calendar completion timeout: ' + predicate.toString()); };
    const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
    await wait(() => button('Today'));
    button('Today').click();
    await wait(() => button('completion-first'));
    button('completion-first').click();
    await wait(() => button('Mark task complete'));
    const api = window.ritua;
    const dateKey = (await api.loadWorkspace()).fields.workspaceDate;
    const RealDate = Date;
    const at = minute => {
      const instant = new RealDate(dateKey + 'T00:00:00'); instant.setMinutes(minute);
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant.getTime()])); } static now() { return instant.getTime(); } };
    };
    const event = (doc, id) => doc.entities.find(e => e.kind === 'event' && e.id === id)?.data.content;
    try {
      at(645);
      button('Mark task complete').click();
      await wait(async () => event(await api.loadWorkspace(), 'completion-first')?.end === 645);
      let saved = await api.loadWorkspace();
      check(event(saved, 'completion-following').start === 645 && event(saved, 'completion-later').start === 705, 'Early completion must pull following calendar blocks earlier');
      button('Schedule task').click();
      await wait(() => document.querySelector('.task-details-schedule-editor input[name="end"]'));
      check(document.querySelector('.task-details-schedule-editor input[name="end"]').value === '10:45', 'The schedule editor must show the adjusted end time');
      button('Cancel').click();
      await wait(() => !document.querySelector('.task-details-schedule-editor'));
      check(saved.entities.find(e => e.kind === 'task' && e.id === 'completion-first').data.content.actualMinutes === 45, 'Early completion records the final calendar duration as Actual');
      check(button('Edit Task actual time, currently 0:45'), 'Task details must display recorded Actual');
      check(document.querySelectorAll('.task-details-time-summary dt').length === 1 && document.querySelector('.task-details-time-summary dt').textContent === 'Actual', 'Task details only offer actual time');
      check(!document.querySelector('.task-card .duration-chip, .task-card .subtask-duration'), 'Task cards hide durations');
      button('Mark task incomplete').click();
      await wait(() => button('Mark task complete'));
      at(690);
      button('Mark task complete').click();
      await wait(async () => event(await api.loadWorkspace(), 'completion-first')?.end === 690);
      saved = await api.loadWorkspace();
      check(event(saved, 'completion-following').start === 690 && event(saved, 'completion-following').end === 720 && event(saved, 'completion-later').start === 750, 'Late completion must push following blocks while preserving their durations and gaps');
      check(saved.entities.find(e => e.kind === 'task' && e.id === 'completion-first').data.content.actualMinutes === 90, 'Completing again updates Actual to the latest calendar duration');
      check(button('Edit Task actual time, currently 1:30'), 'Task details must display updated Actual');
      button('Close task details').click();
    } finally { window.Date = RealDate; }
  })()`)
}

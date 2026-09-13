import type { BrowserWindow } from 'electron'

export async function verifyEmptyTaskTitleDeletion(window: BrowserWindow, phase: 'write' | 'read') {
  await window.webContents.executeJavaScript(`(async () => {
    const api = window.ritua;
    const saved = await api.loadWorkspace();
    if (${JSON.stringify(phase)} === 'read') {
      const task = saved.entities.find(entity => entity.kind === 'task' && entity.id === 'empty-title-check');
      if (task?.data.content.title !== 'Undo restores this task' || !saved.entities.some(entity => entity.kind === 'event' && entity.id === task.id)) throw new Error('Empty-title deletion Undo must survive restart');
      return;
    }
    const id = 'empty-title-check', projectId = 'empty-title-project';
    const content = { id, title: 'Undo restores this task', channel: 'Work', objectiveId: projectId, minutes: 30, time: '15:00', complete: false, notes: 'Keep these notes', subtasks: [{ id: 'kept-subtask', title: 'Keep this subtask', minutes: 10, complete: false }] };
    const put = [
      { kind: 'task', id, data: { lane: 'today', position: 1000, content } },
      { kind: 'event', id, data: { position: 1000, taskId: id, derived: ['title', 'complete'], content: { id, dateKey: saved.fields.workspaceDate, start: 900, end: 930, color: 'violet' } } },
      { kind: 'project', id: 'weeklyObjectives:' + projectId, data: { collection: 'weeklyObjectives', position: 1000, content: { id: projectId, title: 'Deletion check project', channel: 'Work' }, hasTasks: true, links: [{ id: 'project-task-reference', taskId: id, keys: ['id', 'taskId', 'title', 'minutes', 'complete'], extra: {} }] } },
    ];
    const result = await api.saveWorkspace({ revision: saved.revision, requestId: crypto.randomUUID(), put, remove: [], fields: saved.fields });
    if (!result.ok) throw new Error('Failed to save the empty-title test fixture');
  })()`)
  if (phase === 'read') return
  await new Promise<void>(resolve => {
    window.webContents.once('did-finish-load', () => resolve())
    window.webContents.reload()
  })
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Empty-title test timeout: ' + predicate.toString()); };
    const button = label => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
    const click = label => { const target = button(label); check(target, 'Missing ' + label); target.click(); };
    const editTitle = value => {
      const input = document.querySelector('[aria-label="Task title"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const api = window.ritua, id = 'empty-title-check', title = 'Undo restores this task';
    const task = doc => doc.entities.find(entity => entity.kind === 'task' && entity.id === id);
    const event = doc => doc.entities.find(entity => entity.kind === 'event' && entity.id === id);
    const project = doc => doc.entities.find(entity => entity.id === 'weeklyObjectives:empty-title-project');
    await wait(() => button(title));
    click(title);
    await wait(() => document.querySelector('[aria-label="Task title"]'));
    const original = await api.loadWorkspace();
    editTitle(''); await pause();
    document.querySelector('[aria-label="Task notes"]').focus(); await pause();
    check(document.querySelector('[aria-label="Task title"]').value === '' && task(await api.loadWorkspace()), 'Moving focus within details must keep the empty draft editable');
    editTitle(title); await pause(); click('Close task details');
    await wait(() => !document.querySelector('.task-details'));
    check(task(await api.loadWorkspace()) && !button('Undo'), 'Replacing the title before leaving must keep the task');

    for (const exit of ['close', 'escape', 'backdrop', 'project']) {
      click(title); await wait(() => document.querySelector('[aria-label="Task title"]'));
      editTitle(exit === 'escape' ? '   ' : '');
      // An immediate Escape must see the latest draft, even before effects run.
      if (exit !== 'escape') await pause();
      if (exit === 'close') click('Close task details');
      if (exit === 'escape') document.querySelector('[aria-label="Task title"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      if (exit === 'backdrop') document.querySelector('.task-details-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      if (exit === 'project') click('Open project details for Deletion check project');
      await wait(() => !document.querySelector('.task-details'));
      await wait(async () => !task(await api.loadWorkspace()));
      const deleted = await api.loadWorkspace();
      check(!event(deleted) && !project(deleted).data.links.length, 'Deletion must remove the calendar block and project reference');
      const undo = button('Undo');
      check(undo, 'An empty title on exit must offer Undo');
      const style = getComputedStyle(undo.closest('.undo-snackbar'));
      check(style.position === 'fixed' && parseFloat(style.right) <= 16 && parseFloat(style.bottom) <= 16, 'Undo must appear at the bottom right');
      const bounds = undo.getBoundingClientRect();
      check(undo.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)), 'Undo must receive clicks above the project dialog');
      undo.click();
      await wait(async () => task(await api.loadWorkspace()));
      const restored = await api.loadWorkspace();
      check(JSON.stringify(task(restored).data.content) === JSON.stringify(task(original).data.content), 'Undo must restore the previous title and all task details');
      check(JSON.stringify(event(restored).data.content) === JSON.stringify(event(original).data.content), 'Undo must restore the schedule');
      check(JSON.stringify(project(restored).data.links) === JSON.stringify(project(original).data.links), 'Undo must restore the project reference');
      if (exit === 'project') {
        click('Close project details');
        await wait(() => !document.querySelector('.objective-details'));
        check(!document.querySelector('.task-details'), 'Closing the project must not reopen the deleted task after Undo');
      }
    }
  })()`)
}

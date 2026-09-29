import type { BrowserWindow } from 'electron'
import { ensureNavigation } from './navigation-smoke'

export async function verifyDailyPlanning(window: BrowserWindow, phase: 'write' | 'read') {
  await ensureNavigation(window)
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Daily planning timeout: ' + predicate.toString()); };
    const button = label => {
      const found = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || (() => {
        const copy = node.cloneNode(true); copy.querySelectorAll('svg,[aria-hidden="true"]').forEach(icon => icon.remove()); return copy.textContent.trim() === label;
      })());
      check(found, 'Missing daily-planning control: ' + label); return found;
    };
    const api = window.ritua;
    const highlightTitle = 'My deliberately chosen daily highlight';
    const optionalTitle = 'Another task added through shared capture';
    const task = (doc, title) => doc.entities.find(entity => entity.kind === 'task' && entity.data.content.title === title);
    const verify = doc => {
      check(task(doc, highlightTitle)?.data.lane === 'today', 'Selected task must persist on Today');
      check(task(doc, optionalTitle)?.data.lane === 'today', 'Captured tasks must persist on Today');
      check(doc.fields['daily.highlightTaskId'] === task(doc, highlightTitle)?.id, 'Daily highlight must persist');
    };
    if (${JSON.stringify(phase)} === 'read') { verify(await api.loadWorkspace()); return; }
    button('Daily planning').click();
    await wait(() => document.querySelector('.yesterday-review'));
    check(document.querySelector('.review-time-meter'), 'Planning review includes yesterday’s logged time');
    button('Plan today').click();
    await wait(() => document.querySelector('.daily-selection'));
    const create = async title => {
      document.querySelector('.daily-plan-scroll .inline-task-start').click();
      await wait(() => document.querySelector('textarea[aria-label="New task"]'));
      const input = document.querySelector('textarea[aria-label="New task"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(async () => task(await api.loadWorkspace(), title));
      await wait(() => document.querySelector('.daily-selected-tasks').innerText.includes(title));
    };
    await create(highlightTitle); await create(optionalTitle);
    check(task(await api.loadWorkspace(), highlightTitle).data.lane === 'today', 'Shared capture creates tasks directly on Today');
    check(document.querySelector('.daily-selected-task').innerText.includes(optionalTitle), 'New tasks appear at the top');
    const initialPlanOrder = [...document.querySelectorAll('.daily-selected-task')].map(n => n.dataset.taskLayoutId);
    button('Make ' + highlightTitle + ' the daily highlight').click();
    await wait(async () => (await api.loadWorkspace()).fields['daily.selection']?.highlightId === task(await api.loadWorkspace(), highlightTitle).id);
    button('Back to yesterday').click(); await wait(() => document.querySelector('.yesterday-review'));
    button('Plan today').click(); await wait(() => document.querySelector('.daily-selection'));
    check(button('Make ' + highlightTitle + ' the daily highlight').getAttribute('aria-pressed') === 'true', 'Going back preserves the highlight');
    check(document.querySelector('.daily-source-pane') && document.querySelector('.daily-plan-pane'), 'Task sources and the selected plan remain visible together');
    const search = document.querySelector('[aria-label="Search tasks"]');
    const searchFor = async value => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    };
    await searchFor(optionalTitle);
    check(document.querySelector('.daily-selected-tasks').innerText.includes(highlightTitle), 'Searching sources must not hide the chosen plan');
    button('Make ' + optionalTitle + ' the daily highlight').focus();
    button('Make ' + optionalTitle + ' the daily highlight').click(); await pause();
    check(JSON.stringify([...document.querySelectorAll('.daily-selected-task')].map(n => n.dataset.taskLayoutId)) === JSON.stringify(initialPlanOrder), 'Changing the highlight preserves task order');
    check(document.activeElement === button('Make ' + optionalTitle + ' the daily highlight'), 'Choosing a highlight preserves keyboard focus');
    button('Make ' + highlightTitle + ' the daily highlight').click(); await pause();
    check(JSON.stringify([...document.querySelectorAll('.daily-selected-task')].map(n => n.dataset.taskLayoutId)) === JSON.stringify(initialPlanOrder), 'Selecting a later highlight does not move it to the top');
    await searchFor('no-matching-daily-task');
    check(document.querySelector('.daily-source-pane').innerText.includes('No matching tasks'), 'Source search has a useful empty state');
    check(!button('Start my day').disabled, 'Search results do not affect the saved selection');
    button('Clear task search').click(); await pause();
    button('Start my day').click(); await wait(() => document.querySelector('.today-layout'));
    await wait(async () => (await api.loadWorkspace()).fields['daily.highlightTaskId'] === task(await api.loadWorkspace(), highlightTitle).id);
    verify(await api.loadWorkspace());
    check(document.querySelector('.today-highlight').innerText.includes(highlightTitle), 'Today shows the selected highlight');
  })()`)
}

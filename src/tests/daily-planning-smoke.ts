import type { BrowserWindow } from 'electron'

import { addDays, localDateKey } from '../domain/calendar-dates'

export async function verifyDailyPlanning(window: BrowserWindow, phase: 'write' | 'read') {
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Daily planning timeout: ' + predicate.toString()); };
    const button = label => {
      const found = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || (() => {
        const copy = node.cloneNode(true); copy.querySelectorAll('svg,[aria-hidden="true"]').forEach(icon => icon.remove()); return copy.textContent.trim() === label;
      })());
      check(found, 'Missing daily-planning control: ' + label);
      return found;
    };
    const api = window.ritua;
    const missedTitles = ['Carry over first missed task', 'Carry over second missed task'];
    const workedTitle = 'Keep reviewed work yesterday';
    const task = (doc, title) => doc.entities.find(entity => entity.kind === 'task' && entity.data.content.title === title);
    const verify = doc => {
      for (const title of missedTitles) {
        check(task(doc, title)?.data.lane === 'today', 'Every missed task must be saved to today');
        check(doc.entities.filter(entity => entity.kind === 'task' && entity.data.content.title === title).length === 1, 'Carryover must not duplicate tasks');
      }
      check(task(doc, workedTitle)?.data.lane === ${JSON.stringify('date:' + addDays(localDateKey(), -1))}, 'Worked-on tasks must stay yesterday');
    };
    if (${JSON.stringify(phase)} === 'read') {
      verify(await api.loadWorkspace());
      return;
    }
    button('Daily planning').click();
    await wait(() => document.querySelector('.yesterday-review'));
    const column = index => document.querySelectorAll('.review-task-column')[index];
    const create = async (index, title) => {
      column(index).querySelector('.inline-task-add').click();
      await wait(() => column(index).querySelector('textarea[aria-label="New task"]'));
      const input = column(index).querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(async () => task(await api.loadWorkspace(), title));
      await wait(() => column(index).innerText.includes(title) && !column(index).querySelector('textarea'));
    };
    await create(0, workedTitle);
    for (const title of missedTitles) await create(1, title);
    button('Filter by area').click();
    await wait(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')].some(node => node.textContent.trim() === 'Personal'));
    [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(node => node.textContent.trim() === 'Personal').click();
    await wait(() => !column(1).innerText.includes(missedTitles[0]));
    button('Next').click();
    await wait(() => document.querySelector('.planning-intro.step-0'));
    await wait(async () => task(await api.loadWorkspace(), missedTitles[0])?.data.lane === 'today');
    verify(await api.loadWorkspace());
    button('Filter by area, 1 selected').click();
    await wait(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')].some(node => node.textContent.trim() === 'All areas'));
    [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(node => node.textContent.trim() === 'All areas').click();
    await wait(() => missedTitles.every(title => document.querySelector('.planning-task-list').innerText.includes(title)));
    button('Back').click();
    await wait(() => document.querySelector('.yesterday-review'));
    check(!missedTitles.some(title => column(1).innerText.includes(title)), 'Moved tasks must leave yesterday review');
    button('Next').click();
    await wait(() => document.querySelector('.planning-intro.step-0'));
    verify(await api.loadWorkspace());
    button('Today').click();
    await wait(() => document.querySelector('.today-layout'));
  })()`)
}

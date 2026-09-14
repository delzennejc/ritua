import type { BrowserWindow } from 'electron'

import { addDays, localDateKey, mondayOf } from '../domain/calendar-dates'

export async function verifyPlanningEntry(window: BrowserWindow) {
  const monday = addDays(mondayOf(localDateKey()), 14)
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Planning entry timeout: ' + predicate.toString()); };
    const click = label => {
      const button = [...document.querySelectorAll('button')].find(node => {
        const copy = node.cloneNode(true); copy.querySelectorAll('svg,[aria-hidden="true"]').forEach(icon => icon.remove());
        return copy.textContent.trim() === label;
      });
      check(button, 'Missing planning entry control: ' + label); button.click();
    };
    const RealDate = Date;
    const setDay = day => {
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [day + 'T08:00:00'])); }
        static now() { return new RealDate(day + 'T08:00:00').getTime(); }
      };
      window.dispatchEvent(new Event('focus'));
    };
    try {
      setDay(${JSON.stringify(monday)});
      await wait(() => document.querySelector('.weekly-history-view'));
      click('Next'); await wait(() => document.querySelector('.weekly-review-step'));
      click('Wrap up'); await wait(() => document.querySelector('.weekly-objectives-view'));
      click('Next'); await wait(() => document.querySelector('.weekly-done-button'));
      click('Done'); await wait(() => document.querySelector('.yesterday-review'));
      await wait(async () => (await window.ritua.loadWorkspace()).fields['weekly.completedWeek'] === ${JSON.stringify(monday)});
      check((await window.ritua.loadWorkspace()).fields.view === 'planning', 'Weekly completion and daily handoff must save together');
      click('Next'); await wait(() => document.querySelector('.planning-intro.step-0'));
      click('Next'); await wait(() => document.querySelector('.planning-intro.step-2'));
      click('Looks good'); await wait(() => document.querySelector('.get-started'));
      click('Get started');
      await wait(async () => (await window.ritua.loadWorkspace()).fields['daily.completedDate'] === ${JSON.stringify(monday)});
      click('Today'); await wait(() => document.querySelector('.today-layout'));
      window.dispatchEvent(new Event('focus')); await pause();
      check(document.querySelector('.today-layout'), 'Same-day focus must not reopen completed planning');
      setDay(${JSON.stringify(addDays(monday, 1))});
      await wait(() => document.querySelector('.yesterday-review'));
    } finally {
      window.Date = RealDate;
      window.dispatchEvent(new Event('focus'));
      await wait(async () => (await window.ritua.loadWorkspace()).fields.workspaceDate === ${JSON.stringify(localDateKey())});
      click('Today'); await wait(() => document.querySelector('.today-layout'));
    }
  })()`)
}

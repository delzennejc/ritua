import type { BrowserWindow } from 'electron'
import { addDays, localDateKey } from '../domain/calendar-dates'
import { ensureNavigation } from './navigation-smoke'

export async function verifyHomeDayReviews(window: BrowserWindow, phase: 'write' | 'read') {
  await ensureNavigation(window)
  const today = localDateKey()
  const past = addDays(today, -2)
  const cleared = addDays(today, -3)
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 40));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await pause(); } throw new Error('Home review timeout: ' + predicate.toString()); };
    const click = label => {
      const node = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
      check(node, 'Missing Home control: ' + label); node.click();
    };
    click('Home'); await wait(() => document.querySelector('.week-calendar-surface'));
    const past = ${JSON.stringify(past)};
    const cleared = ${JSON.stringify(cleared)};
    const calendarDay = date => document.querySelector('[data-week-calendar-date="' + date + '"]');
    const checkbox = () => calendarDay(past).querySelector('.day-review-checkbox');
    await wait(() => checkbox());
    const savedReview = async () => (await window.ritua.loadWorkspace()).fields.ritualHistory?.[${JSON.stringify(addDays(past, 1))}]?.daily?.['daily.reviewedDate'];
    const savedClearedReview = async () => (await window.ritua.loadWorkspace()).fields.ritualHistory?.[${JSON.stringify(addDays(cleared, 1))}]?.daily?.['daily.reviewedDate'];
    if (${JSON.stringify(phase)} === 'write') {
      check(checkbox().getAttribute('aria-checked') === 'false', 'Past days start unchecked unless reviewed');
      const before = await window.ritua.loadWorkspace();
      checkbox().click();
      await wait(() => checkbox().getAttribute('aria-checked') === 'true');
      await wait(async () => await savedReview() === past);
      const after = await window.ritua.loadWorkspace();
      check(JSON.stringify(after.entities) === JSON.stringify(before.entities), 'Reviewing a day preserves tasks and calendar data');
      check(after.fields.view === 'home' && after.fields.planningStep === before.fields.planningStep, 'Manual review preserves navigation');
    } else {
      check(await savedReview() === past, 'The reviewed day survives a native restart');
      check(checkbox().getAttribute('aria-checked') === 'true', 'Calendar shows persisted review status after restart');
    }
    const today = calendarDay(${JSON.stringify(today)});
    check(today.querySelector('[role="progressbar"]'), 'Today uses the shared progress component');
    check(!today.querySelector('[role="checkbox"]'), 'Today remains a task progress indicator');
    check(!calendarDay(${JSON.stringify(addDays(today, 1))}).querySelector('.day-completion-indicator'), 'Future days have no completion control');
    click('Show board view'); await wait(() => document.querySelector('.board-surface:not(.single-day)'));
    const boardCheck = document.querySelector('.board-columns [data-day-completion-date="' + past + '"]');
    check(boardCheck?.getAttribute('aria-checked') === 'true', 'The board shares the calendar’s review state');
    const clearedCheck = document.querySelector('.board-columns [data-day-completion-date="' + cleared + '"]');
    check(clearedCheck, 'The board includes the day to uncheck');
    if (${JSON.stringify(phase)} === 'write') {
      boardCheck.click();
      await wait(() => boardCheck.getAttribute('aria-checked') === 'false');
      await wait(async () => await savedReview() === undefined);
      boardCheck.click();
      await wait(() => boardCheck.getAttribute('aria-checked') === 'true');
      await wait(async () => await savedReview() === past);
      if (clearedCheck.getAttribute('aria-checked') === 'false') clearedCheck.click();
      await wait(async () => await savedClearedReview() === cleared);
      clearedCheck.click();
      await wait(() => clearedCheck.getAttribute('aria-checked') === 'false');
      await wait(async () => await savedClearedReview() === undefined);
    } else {
      check(await savedClearedReview() === undefined, 'Unchecking survives a native restart');
      check(clearedCheck.getAttribute('aria-checked') === 'false', 'The board shows the persisted unchecked state');
    }
    check(document.querySelector('.board-columns [data-day-completion-date="${today}"]')?.getAttribute('role') === 'progressbar', 'Board Today uses the same progress component');
    click('Show week calendar view'); await wait(() => document.querySelector('.week-calendar-surface'));
    check(checkbox().getAttribute('aria-checked') === 'true', 'Calendar reflects the day checked again from the board');
    check(calendarDay(cleared).querySelector('.day-review-checkbox').getAttribute('aria-checked') === 'false', 'Calendar reflects the day unchecked from the board');
    if (!document.querySelector('.sidebar')) document.querySelector('.navigation-toggle').click();
    await wait(() => document.querySelector('.sidebar'));
    click('Today'); await wait(() => document.querySelector('.today-layout'));
  })()`)
}

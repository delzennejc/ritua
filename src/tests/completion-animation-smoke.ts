import type { BrowserWindow } from 'electron'

export async function verifyCompletionAnimation(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const check = (value, message) => { if (!value) throw new Error(message); };
    const wait = async predicate => { for (let i = 0; i < 150; i++) { if (await predicate()) return; await pause(40); } throw new Error('Completion animation timeout: ' + predicate.toString()); };
    const card = document.querySelector('.today-layout .board-surface.single-day .task-card:not(.complete)');
    check(card, 'Today includes an incomplete task for completion timing');
    const id = card.dataset.taskLayoutId;
    const lane = card.closest('[data-today-status]');
    const button = card.querySelector('.completion-toggle');
    const currentCard = () => [...document.querySelectorAll('.today-layout .task-card')].find(node => node.dataset.taskLayoutId === id);
    button.click();
    await pause(100);
    check(button.getAttribute('aria-checked') === 'true' && button.dataset.completionPending === 'true', 'The check responds before moving the card');
    check(button.getAnimations({subtree: true}).length === 8, 'Task checks share Home’s icon, ring and six sparks');
    check(card.isConnected && card.closest('[data-today-status]') === lane, 'The card stays in its original lane during the animation');
    button.click();
    await pause(900);
    check(card.isConnected && !card.classList.contains('complete'), 'Unchecking during the pause cancels completion and movement');
    const origin = card.getBoundingClientRect();
    const start = performance.now();
    button.click();
    await pause(650);
    check(card.isConnected && card.closest('[data-today-status]') === lane, 'The full 800ms presentation pause precedes the move');
    await wait(() => currentCard()?.classList.contains('complete'));
    check(performance.now() - start >= 800, 'Cards move only after the presentation pause');
    check(currentCard().closest('[data-today-status]').dataset.todayStatus === 'done', 'Completion moves to the canonical Done lane');
    const flight = [...document.querySelectorAll('[data-task-flight-id]')].find(node => node.dataset.taskFlightId === id);
    check(flight, 'The checked task physically travels between its original lane and Done');
    const movement = flight.getAnimations()[0];
    movement.pause();
    movement.currentTime = 0;
    const departure = flight.getBoundingClientRect();
    const destination = currentCard().getBoundingClientRect();
    check(Math.abs(departure.left - origin.left) < 1 && Math.abs(departure.top - origin.top) < 1, 'Movement starts at the original card position');
    movement.currentTime = movement.effect.getTiming().duration / 2;
    const halfway = flight.getBoundingClientRect();
    const totalDistance = Math.hypot(destination.left - origin.left, destination.top - origin.top);
    const travelled = Math.hypot(halfway.left - origin.left, halfway.top - origin.top);
    check(travelled > 1 && travelled < totalDistance - 1, 'The card visibly passes through an intermediate position instead of teleporting');
    check(getComputedStyle(currentCard()).opacity === '0' && flight.inert, 'There is one visible card during the flight and its visual copy is not interactive');
    movement.finish();
    await wait(() => !flight.isConnected);
    check(getComputedStyle(currentCard()).opacity === '1', 'The real destination card is revealed when movement ends');
    await wait(async () => Boolean((await window.ritua.loadWorkspace()).entities.find(entity => entity.id === id && entity.kind === 'task')?.data.content.complete));
    currentCard().querySelector('.completion-toggle').click();
    await wait(() => !currentCard()?.classList.contains('complete'));
    await wait(async () => !(await window.ritua.loadWorkspace()).entities.find(entity => entity.id === id && entity.kind === 'task')?.data.content.complete);
    await wait(() => !document.querySelector('[data-task-flight-id]'));
  })()`)
}

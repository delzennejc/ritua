import type { BrowserWindow } from 'electron'

// Tests can explicitly collapse navigation, so reopen it before sidebar-driven flows.
export async function ensureNavigation(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(resolve => setTimeout(resolve, 30));
    for (let i = 0; i < 200; i++) {
      if (document.querySelector('.sidebar')) return true;
      const toggle = document.querySelector('.navigation-toggle');
      if (toggle) {
        toggle.click();
        for (let j = 0; j < 100; j++) {
          if (document.querySelector('.sidebar')) return true;
          await pause();
        }
        throw new Error('Navigation did not open');
      }
      await pause();
    }
    throw new Error('Missing navigation toggle');
  })()`)
}

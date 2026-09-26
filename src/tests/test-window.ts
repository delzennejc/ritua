import type { BrowserWindow } from 'electron'
import { app } from 'electron'

const visibleRun = () => process.env.RITUA_TEST_VISIBLE === '1'

// Native gesture tests need a real composited window. Unless RITUA_TEST_VISIBLE=1 requests a
// watchable run, that window stays transparent, unfocused and click-through so the suite can run
// while the machine is in use. Focus emulation keeps focus and blur events real for a page whose
// window is not key, which the interface relies on for commit-on-blur behavior.
export async function presentTestWindow(window: BrowserWindow, options: { activate?: boolean } = {}) {
  if (!visibleRun()) {
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    window.setOpacity(0)
    window.setIgnoreMouseEvents(true)
    window.showInactive()
    return
  }
  window.setOpacity(1)
  window.setIgnoreMouseEvents(false)
  window.show()
  if (options.activate) app.focus({ steal: true })
  window.focus()
}

// Native gestures are only meaningful with OS focus in a watchable run. A background run keeps the
// window unfocused because injected input does not require focus and activating the test
// application would interrupt work on the same machine.
export async function focusTestWindow(window: BrowserWindow) {
  if (!visibleRun()) return
  app.focus({ steal: true })
  window.focus()
  if (!window.isFocused()) throw new Error('Native gesture requires the test window to have focus')
}

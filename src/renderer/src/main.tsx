import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import { App } from './app/App.jsx'
import './app/styles.css'
import { DesktopWorkspace } from './desktop/DesktopWorkspace'
import './desktop/window-chrome.css'

const hasMacWindowChrome = /Macintosh/.test(navigator.userAgent) && /Electron\//.test(navigator.userAgent)
document.documentElement.classList.toggle('mac-window-chrome', hasMacWindowChrome)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {hasMacWindowChrome && <div className="window-drag-region" aria-hidden="true" />}
    <DesktopWorkspace>
      <App />
    </DesktopWorkspace>
  </StrictMode>,
)

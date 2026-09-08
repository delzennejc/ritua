import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
export function reportActionError(message: string) { window.dispatchEvent(new CustomEvent('ritua-action-error', { detail: message })) }
export function ActionErrors() {
  const [error, setError] = useState<{ message: string; target: Element } | null>(null)
  useEffect(() => {
    const report = (event: Event) => {
      const target = document.activeElement?.closest('form,[role="dialog"]') || document.querySelector('main') || document.getElementById('root')!
      setError({ message: (event as CustomEvent<string>).detail, target })
    }
    window.addEventListener('ritua-action-error', report)
    return () => window.removeEventListener('ritua-action-error', report)
  }, [])
  if (!error || !error.target.isConnected) return null
  return createPortal(<div role="alert" style={{ flexBasis: '100%', padding: '8px 12px', background: '#fff4e8', color: '#7d3e14', borderRadius: 4, fontSize: 13 }}>
    {error.message} <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>Dismiss</button>
  </div>, error.target)
}

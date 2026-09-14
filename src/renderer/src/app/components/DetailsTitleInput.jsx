import { forwardRef, useLayoutEffect, useRef } from 'react'

const resizeToContent = (field) => {
  if (!field) return
  field.style.height = 'auto'
  field.style.height = `${field.scrollHeight}px`
}

export const AutoGrowingTextarea = forwardRef(function AutoGrowingTextarea(
  { className = '', rows = 1, value, ...props },
  forwardedRef,
) {
  const fieldRef = useRef(null)
  const setFieldRef = (field) => {
    fieldRef.current = field
    if (typeof forwardedRef === 'function') forwardedRef(field)
    else if (forwardedRef) forwardedRef.current = field
  }

  useLayoutEffect(() => {
    resizeToContent(fieldRef.current)
  }, [value])

  useLayoutEffect(() => {
    const field = fieldRef.current
    let previousWidth = field.clientWidth
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === previousWidth) return
      previousWidth = field.clientWidth
      resizeToContent(field)
    })
    observer.observe(field)

    let disposed = false
    document.fonts.ready.then(() => {
      if (!disposed) resizeToContent(field)
    })
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [])

  return (
    <textarea
      {...props}
      ref={setFieldRef}
      className={`auto-growing-textarea ${className}`.trim()}
      rows={rows}
      value={value}
    />
  )
})

export function DetailsTitleInput({ className = '', ...props }) {
  return (
    <AutoGrowingTextarea
      {...props}
      className={`details-title-input ${className}`.trim()}
      onKeyDown={(event) => {
        // Titles wrap visually but retain the input's single-line Enter behavior.
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault()
      }}
    />
  )
}

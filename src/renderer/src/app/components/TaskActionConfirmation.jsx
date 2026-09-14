import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Shared card popovers preserve the same anchoring, focus, and dismissal behavior.
export function TaskActionPopover({
  id,
  triggerRef,
  focusRef,
  role = 'dialog',
  label,
  labelledBy,
  describedBy,
  className = '',
  onClose,
  onKeyDown,
  children,
}) {
  const [position, setPosition] = useState(null)
  const popoverRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const placePopover = () => {
      const anchor = triggerRef.current?.getBoundingClientRect()
      const popover = popoverRef.current?.getBoundingClientRect()
      if (!anchor || !popover) return
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
        onCloseRef.current()
        return
      }
      const anchorCenter = anchor.left + anchor.width / 2
      const left = Math.max(
        8,
        Math.min(anchorCenter - popover.width / 2, window.innerWidth - popover.width - 8),
      )
      const fitsBelow = anchor.bottom + 8 + popover.height <= window.innerHeight - 8
      setPosition({
        left,
        top: fitsBelow ? anchor.bottom + 8 : Math.max(8, anchor.top - popover.height - 8),
        placement: fitsBelow ? 'bottom' : 'top',
        arrowX: anchorCenter - left,
      })
    }
    placePopover()
    const frame = requestAnimationFrame(() => focusRef.current?.focus({ preventScroll: true }))
    window.addEventListener('resize', placePopover)
    window.addEventListener('scroll', placePopover, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', placePopover)
      window.removeEventListener('scroll', placePopover, true)
    }
  }, [triggerRef, focusRef])

  useEffect(() => {
    const dismissOutside = (event) => {
      if (!triggerRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) {
        onCloseRef.current()
      }
    }
    const dismissEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current(true)
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('focusin', dismissOutside)
    document.addEventListener('keydown', dismissEscape, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('focusin', dismissOutside)
      document.removeEventListener('keydown', dismissEscape, true)
    }
  }, [triggerRef])

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      className={`toolbar-popover toolbar-popover-portal task-unschedule-popover ${className}`}
      style={
        position
          ? {
              left: position.left,
              top: position.top,
              '--unschedule-arrow-x': `${position.arrowX}px`,
            }
          : { visibility: 'hidden' }
      }
      data-placement={position?.placement || 'bottom'}
      role={role}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        event.stopPropagation()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

export function TaskActionConfirmation({
  id,
  triggerRef,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}) {
  const cancelRef = useRef(null)
  return (
    <TaskActionPopover
      id={id}
      triggerRef={triggerRef}
      focusRef={cancelRef}
      labelledBy={`${id}-title`}
      describedBy={description ? `${id}-description` : undefined}
      onClose={onClose}
    >
      <strong id={`${id}-title`}>{title}</strong>
      {description ? <p id={`${id}-description`}>{description}</p> : null}
      <div className="task-unschedule-actions">
        <button ref={cancelRef} className="secondary-button" type="button" onClick={() => onClose(true)}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            onClose(true)
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </TaskActionPopover>
  )
}

import { CheckCircle } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { completionQueue } from '../../desktop/pending-completions'
import { getWorkspaceDocument } from '../../desktop/workspace-store'
import { completionTargetKey, readCompletionTarget } from '../../desktop/completion-target'
import { ReviewCheckVisual } from './ReviewCheckVisual'
import { animateReviewCheck } from '../utils/review-check-animation'
import { captureTaskCompletionLayout } from './TaskReorderAnimator'

/** Every interactive completion control shares Home's burst, focus and cancellation. */
export function CompletionCheck({
  as: Element = 'button',
  complete,
  target,
  onClick,
  size = 19,
  pause = true,
  className = '',
  children,
  style,
  pendingColor = 'var(--green)',
  ...props
}) {
  const key = completionTargetKey(target)
  const pending = useSyncExternalStore(completionQueue.subscribe, () => completionQueue.isPending(key))
  const checked = pending || Boolean(complete)
  const rootRef = useRef(null)
  const handlerRef = useRef({ key, onClick })
  handlerRef.current = { key, onClick }
  const apply = (event) => {
    const current = handlerRef.current.key === key
    const root = current ? rootRef.current : null
    const focused = root && document.activeElement === root
    const handler = current ? handlerRef.current.onClick : onClick
    captureTaskCompletionLayout()
    handler?.(event)
    if (focused)
      requestAnimationFrame(() => {
        if (root.isConnected || document.activeElement !== document.body) return
        const replacement = [...document.querySelectorAll('[data-completion-key]')].find(
          (node) =>
            node.dataset.completionKey === key &&
            node.className === root.className &&
            node.offsetParent !== null,
        )
        replacement?.focus({ preventScroll: true })
      })
  }
  const previousRef = useRef({ key, checked })
  useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = { key, checked }
    if (key !== previous.key || !checked || previous.checked) return
    const animations = animateReviewCheck(rootRef.current)
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      animations.forEach((animation) => animation.cancel())
    })
    return () => animations.forEach((animation) => animation.cancel())
  }, [key, checked])
  return (
    <Element
      {...props}
      ref={rootRef}
      type={Element === 'button' ? 'button' : undefined}
      role={Element === 'button' ? 'checkbox' : undefined}
      aria-checked={Element === 'button' ? checked : undefined}
      className={`completion-check ${className}`.trim()}
      data-completion-key={key}
      data-completion-pending={pending || undefined}
      data-checked={checked}
      style={pending ? { ...style, color: pendingColor } : style}
      onClick={
        Element === 'button'
          ? (event) => {
              event.stopPropagation()
              if (pending) {
                completionQueue.cancel(key)
                return
              }
              if (!complete && pause && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                completionQueue.enqueue(key, {
                  read: () => readCompletionTarget(getWorkspaceDocument(), target),
                  apply: () => apply(),
                })
              } else apply(event)
            }
          : undefined
      }
    >
      <ReviewCheckVisual>
        {children ? children(checked) : <CheckCircle size={size} weight={checked ? 'fill' : 'regular'} />}
      </ReviewCheckVisual>
    </Element>
  )
}

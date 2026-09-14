import { useLayoutEffect, useRef } from 'react'

export function useSessionTaskReorderAnimation(sessionId, taskIds, previewing) {
  const previousLayoutsRef = useRef(new Map())
  const previousPreviewRef = useRef(false)
  const orderRevision = JSON.stringify(taskIds)

  useLayoutEffect(() => {
    const rows = document.querySelectorAll(
      `.calendar-session[data-calendar-event-id="${CSS.escape(sessionId)}"] [data-session-task-id]`,
    )
    const layouts = new Map(
      [...rows].map((element, index) => [
        element.dataset.sessionTaskId,
        { element, index, top: element.offsetTop, left: element.offsetLeft },
      ]),
    )
    const previous = previousLayoutsRef.current
    previousLayoutsRef.current = layouts
    const wasPreviewing = previousPreviewRef.current
    previousPreviewRef.current = previewing
    // Local session dragging is already animated by the sortable list. Only mirror committed changes.
    if (previewing || wasPreviewing || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return undefined

    const animations = []
    for (const [id, layout] of layouts) {
      const before = previous.get(id)
      if (!before || before.index === layout.index) continue
      const x = before.left - layout.left
      const y = before.top - layout.top
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
      const animation = layout.element.animate([{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], {
        duration: 280,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      })
      animation.onfinish = () => animation.cancel()
      animations.push(animation)
    }
    return () => animations.forEach((animation) => animation.cancel())
  }, [sessionId, orderRevision, previewing])
}

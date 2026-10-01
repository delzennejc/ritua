import { useEffect, useLayoutEffect, useRef } from 'react'

const TASK_REORDER_DURATION_MS = 180
const TASK_FLIGHT_DURATION_MS = 420
const TASK_REORDER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const COMPLETION_LAYOUT_EVENT = 'ritua:task-completion-layout'

// Measure at the end of the check pause, including any scrolling since the click.
export const captureTaskCompletionLayout = () => window.dispatchEvent(new Event(COMPLETION_LAYOUT_EVENT))

const collectTaskLayouts = () => {
  const layoutsByScope = new Map()

  document.querySelectorAll('[data-task-layout-id]').forEach((element) => {
    const parent = element.parentElement
    const id = element.dataset.taskLayoutId
    if (!parent || !id || !element.getClientRects().length) return

    const lane = element.closest('[data-board-surface-id][data-date-key]')
    // Board columns share a scope; other lists keep their own task copies independent.
    const scope = lane ? `board:${lane.dataset.boardSurfaceId}:${lane.dataset.dateKey}` : parent
    const siblings = layoutsByScope.get(scope) || []
    siblings.push({
      complete: element.dataset.taskLayoutComplete === 'true',
      element,
      id,
      parent,
      rect: element.getBoundingClientRect(),
    })
    layoutsByScope.set(scope, siblings)
  })

  return layoutsByScope
}

const indexLayouts = (layouts) => new Map(layouts.map((layout) => [layout.id, layout]))

const createFlight = (element, before, after) => {
  const ghost = element.cloneNode(true)
  // The visual travels above scroll containers; canonical controls stay in their destination.
  ghost.classList.add('task-completion-flight')
  ;[ghost, ...ghost.querySelectorAll('*')].forEach((node) => {
    ;[...node.attributes].forEach(({ name }) => {
      if (name === 'id' || name.startsWith('data-') || name.startsWith('aria-')) node.removeAttribute(name)
    })
  })
  ghost.dataset.taskFlightId = element.dataset.taskLayoutId
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  const style = getComputedStyle(element)
  Object.assign(ghost.style, {
    left: `${after.left}px`,
    top: `${after.top}px`,
    width: `${after.width}px`,
    height: `${after.height}px`,
    font: style.font,
    color: style.color,
    transform: 'none',
    translate: 'none',
    opacity: '1',
  })
  document.body.appendChild(ghost)
  const animation = ghost.animate(
    [
      {
        translate: `${before.left - after.left}px ${before.top - after.top}px`,
        scale: `${before.width / after.width} ${before.height / after.height}`,
      },
      { translate: '0px 0px', scale: '1 1' },
    ],
    { duration: TASK_FLIGHT_DURATION_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' },
  )
  const arrival = element.animate([{ opacity: 0 }, { opacity: 0 }], {
    duration: TASK_FLIGHT_DURATION_MS,
    fill: 'both',
  })
  return {
    animation,
    ghost,
    cancel() {
      animation.cancel()
      arrival.cancel()
      ghost.remove()
    },
  }
}

export function TaskReorderAnimator({ revision, events, isDragging }) {
  const previousLayoutsRef = useRef(new Map())
  const animationsRef = useRef(new Map())
  const sessionOrderRevision = JSON.stringify(
    events.filter((event) => event.kind === 'session').map((session) => [session.id, session.taskIds]),
  )
  const previousSessionOrderRef = useRef(sessionOrderRevision)
  const previousDraggingRef = useRef(false)

  useLayoutEffect(() => {
    const capture = () => {
      const layouts = collectTaskLayouts()
      layouts.forEach((siblings) =>
        siblings.forEach((layout) => {
          const flight = animationsRef.current.get(layout.element)?.ghost
          if (flight) layout.rect = flight.getBoundingClientRect()
        }),
      )
      previousLayoutsRef.current = layouts
    }
    window.addEventListener(COMPLETION_LAYOUT_EVENT, capture)
    return () => window.removeEventListener(COMPLETION_LAYOUT_EVENT, capture)
  }, [])

  useLayoutEffect(() => {
    animationsRef.current.forEach((record) => record.cancel())
    animationsRef.current.clear()

    const nextLayouts = collectTaskLayouts()
    const sessionOrderChanged = previousSessionOrderRef.current !== sessionOrderRevision
    previousSessionOrderRef.current = sessionOrderRevision
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const wasDragging = previousDraggingRef.current
    previousDraggingRef.current = isDragging

    // The user already moved the card. Also skip the commit that ends a drag or cancellation.
    if (!reduceMotion && !isDragging && !wasDragging) {
      const animationJobs = []

      nextLayouts.forEach((nextSiblings, scope) => {
        const previousSiblings = previousLayoutsRef.current.get(scope)
        if (!previousSiblings) return

        const previousById = indexLayouts(previousSiblings)
        const completionChanged = nextSiblings.some((nextLayout) => {
          const previousLayout = previousById.get(nextLayout.id)
          return previousLayout && previousLayout.complete !== nextLayout.complete
        })
        const sessionBoardChanged =
          sessionOrderChanged &&
          nextSiblings.some(({ element }) => element.hasAttribute('data-board-task-id'))
        if (!completionChanged && !sessionBoardChanged) return

        nextSiblings.forEach((nextLayout) => {
          const previousLayout = previousById.get(nextLayout.id)
          if (!previousLayout) return

          const deltaX = previousLayout.rect.left - nextLayout.rect.left
          const deltaY = previousLayout.rect.top - nextLayout.rect.top
          if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return

          animationJobs.push({
            ...nextLayout,
            previousLayout,
            deltaX,
            deltaY,
            completionChanged,
            sessionBoardChanged,
          })
        })
      })

      animationJobs.forEach(
        ({ element, rect, previousLayout, deltaX, deltaY, completionChanged, sessionBoardChanged }) => {
          let record
          if (previousLayout.parent !== element.parentElement && completionChanged) {
            record = createFlight(element, previousLayout.rect, rect)
          } else {
            // Translate leaves the transform used by sortable dragging independent.
            const animation = element.animate(
              [{ translate: `${deltaX}px ${deltaY}px` }, { translate: '0px 0px' }],
              {
                duration: completionChanged ? 320 : sessionBoardChanged ? 280 : TASK_REORDER_DURATION_MS,
                easing: TASK_REORDER_EASING,
                fill: 'both',
              },
            )
            record = { animation, cancel: () => animation.cancel() }
          }
          animationsRef.current.set(element, record)
          record.animation.onfinish = () => {
            if (animationsRef.current.get(element) !== record) return
            record.cancel()
            animationsRef.current.delete(element)
          }
        },
      )
    }

    previousLayoutsRef.current = nextLayouts
  }, [revision, sessionOrderRevision, isDragging])

  useEffect(() => {
    const cancel = () => {
      animationsRef.current.forEach((record) => record.cancel())
      animationsRef.current.clear()
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    window.addEventListener('scroll', cancel, true)
    window.addEventListener('resize', cancel)
    motion.addEventListener('change', cancel)
    return () => {
      cancel()
      window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('resize', cancel)
      motion.removeEventListener('change', cancel)
    }
  }, [])

  return null
}

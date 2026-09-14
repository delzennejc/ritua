import { useEffect, useLayoutEffect, useRef } from 'react'

const TASK_REORDER_DURATION_MS = 180
const TASK_REORDER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

const collectTaskLayouts = () => {
  const layoutsByParent = new Map()

  document.querySelectorAll('[data-task-layout-id]').forEach((element) => {
    const parent = element.parentElement
    const id = element.dataset.taskLayoutId
    if (!parent || !id) return

    const siblings = layoutsByParent.get(parent) || []
    siblings.push({
      complete: element.dataset.taskLayoutComplete === 'true',
      element,
      id,
      index: siblings.length,
      rect: element.getBoundingClientRect(),
    })
    layoutsByParent.set(parent, siblings)
  })

  return layoutsByParent
}

const indexLayouts = (layouts) => new Map(layouts.map((layout) => [layout.id, layout]))

export function TaskReorderAnimator({ revision }) {
  const previousLayoutsRef = useRef(new Map())
  const animationsRef = useRef(new Map())

  useLayoutEffect(() => {
    animationsRef.current.forEach((animation) => animation.cancel())
    animationsRef.current.clear()

    const nextLayouts = collectTaskLayouts()
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (!reduceMotion) {
      const animationJobs = []

      nextLayouts.forEach((nextSiblings, parent) => {
        const previousSiblings = previousLayoutsRef.current.get(parent)
        if (!previousSiblings) return

        const previousById = indexLayouts(previousSiblings)
        const completionChanged = nextSiblings.some((nextLayout) => {
          const previousLayout = previousById.get(nextLayout.id)
          return previousLayout && previousLayout.complete !== nextLayout.complete
        })
        if (!completionChanged) return

        nextSiblings.forEach((nextLayout) => {
          const previousLayout = previousById.get(nextLayout.id)
          if (!previousLayout || previousLayout.index === nextLayout.index) return

          const deltaX = previousLayout.rect.left - nextLayout.rect.left
          const deltaY = previousLayout.rect.top - nextLayout.rect.top
          if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return

          animationJobs.push({ ...nextLayout, deltaX, deltaY })
        })
      })

      animationJobs.forEach(({ element, deltaX, deltaY }) => {
        const animation = element.animate(
          [{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
          {
            duration: TASK_REORDER_DURATION_MS,
            easing: TASK_REORDER_EASING,
            fill: 'both',
          },
        )
        animationsRef.current.set(element, animation)
        animation.onfinish = () => {
          if (animationsRef.current.get(element) !== animation) return
          animation.cancel()
          animationsRef.current.delete(element)
        }
      })
    }

    previousLayoutsRef.current = nextLayouts
  }, [revision])

  useEffect(
    () => () => {
      animationsRef.current.forEach((animation) => animation.cancel())
      animationsRef.current.clear()
    },
    [],
  )

  return null
}

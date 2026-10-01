import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDragOperation } from '@dnd-kit/react'
import { taskWindow } from '../utils/task-window'

const ESTIMATED_ROW_HEIGHT = 45
const OVERSCAN_PX = 360
const WINDOW_THRESHOLD = 80
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]'

/** Keep small lists untouched; large lists keep real task indices and measured, wrapping row heights. */
export function WindowedTaskRows({ items, children, totalTaskCount = items.length }) {
  return !items.length || totalTaskCount <= WINDOW_THRESHOLD ? (
    items.map(children)
  ) : (
    <TaskWindow items={items}>{children}</TaskWindow>
  )
}

function TaskWindow({ items, children }) {
  const containerRef = useRef(null)
  const scrollRootRef = useRef(null)
  const heightsRef = useRef(new Map())
  const widthRef = useRef(null)
  const frameRef = useRef(null)
  const [measurementRevision, setMeasurementRevision] = useState(0)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [focusedTaskId, setFocusedTaskId] = useState(null)
  const { source } = useDragOperation()
  const draggedTaskId = source?.data?.itemId || source?.data?.taskId

  const offsets = useMemo(() => {
    const result = [0]
    for (const item of items) {
      const measured = heightsRef.current.get(item.id)
      result.push(result.at(-1) + (measured?.item === item ? measured.height : ESTIMATED_ROW_HEIGHT))
    }
    return result
  }, [items, measurementRevision])
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets

  const updateRange = useCallback(() => {
    const container = containerRef.current
    const root = scrollRootRef.current
    if (!container || !root) return
    const top = root.getBoundingClientRect().top + root.clientTop - container.getBoundingClientRect().top
    const next = taskWindow(offsetsRef.current, top - OVERSCAN_PX, top + root.clientHeight + OVERSCAN_PX)
    setRange((current) => (current.start === next.start && current.end === next.end ? current : next))
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    const root = container.closest('.backlog-view')
    scrollRootRef.current = root
    const schedule = () => {
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        updateRange()
      })
    }
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth
      if (widthRef.current !== null && widthRef.current !== width) {
        heightsRef.current.clear()
        setMeasurementRevision((revision) => revision + 1)
      }
      widthRef.current = width
      schedule()
    })
    resize.observe(container)
    resize.observe(root)
    // Other lanes can change height without changing this lane's size.
    resize.observe(root.querySelector('.work-area-list'))
    root.addEventListener('scroll', schedule, { passive: true })
    // A picker lives in a portal. Keep its originating row mounted until focus leaves the picker.
    const focus = (event) => {
      if (container.contains(event.target)) {
        setFocusedTaskId(event.target.closest('[data-task-layout-id]')?.dataset.taskLayoutId || null)
      } else if (!event.target.closest('[data-dropdown-root]')) {
        setFocusedTaskId(null)
      }
    }
    document.addEventListener('focusin', focus)
    updateRange()
    return () => {
      resize.disconnect()
      root.removeEventListener('scroll', schedule)
      document.removeEventListener('focusin', focus)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [updateRange])

  useLayoutEffect(updateRange, [offsets, updateRange])

  const indices = []
  for (let index = range.start; index < Math.min(range.end, items.length); index++) indices.push(index)
  for (const id of [focusedTaskId, draggedTaskId]) {
    if (!id) continue
    const index = items.findIndex((item) => item.id === id)
    if (index >= 0 && !indices.includes(index)) indices.push(index)
  }
  indices.sort((a, b) => a - b)
  const indexRevision = indices.join(',')

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = () => {
      let changed = false
      const byId = new Map(items.map((item) => [item.id, item]))
      container.querySelectorAll('[data-task-layout-id]').forEach((row) => {
        const id = row.dataset.taskLayoutId
        const item = byId.get(id)
        const height = row.getBoundingClientRect().height
        if (!item || height <= 0) return
        const previous = heightsRef.current.get(id)
        if (previous?.item === item && previous.height === height) return
        heightsRef.current.set(id, { item, height })
        changed = true
      })
      if (changed) setMeasurementRevision((revision) => revision + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    container.querySelectorAll('[data-task-layout-id]').forEach((row) => observer.observe(row))
    return () => observer.disconnect()
  }, [items, indexRevision])

  const rows = []
  let previous = 0
  const gap = (end) => {
    if (end <= previous) return
    rows.push(
      <div
        key={`gap-${previous}`}
        aria-hidden="true"
        data-task-window-gap="true"
        style={{ height: offsets[end] - offsets[previous], overflowAnchor: 'none' }}
      />,
    )
  }
  for (const index of indices) {
    gap(index)
    rows.push(children(items[index], index))
    previous = index + 1
  }
  gap(items.length)

  return (
    <div
      ref={containerRef}
      data-task-window-count={items.length}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab' || event.defaultPrevented) return
        const row = event.target.closest('[data-task-layout-id]')
        if (!row) return
        const controls = [row, ...row.querySelectorAll(FOCUSABLE)].filter((element) => element.tabIndex >= 0)
        const boundary = event.shiftKey ? controls[0] : controls.at(-1)
        if (event.target !== boundary) return
        const index = items.findIndex((item) => item.id === row.dataset.taskLayoutId)
        const next = index + (event.shiftKey ? -1 : 1)
        if (next < 0 || next >= items.length || indices.includes(next)) return
        // Native Tab traversal must also reach rows outside the current window.
        event.preventDefault()
        setFocusedTaskId(items[next].id)
        requestAnimationFrame(() => {
          const target = containerRef.current?.querySelector(
            `[data-task-layout-id="${CSS.escape(items[next].id)}"]`,
          )
          if (!target) return
          const nextControls = [target, ...target.querySelectorAll(FOCUSABLE)].filter(
            (element) => element.tabIndex >= 0,
          )
          ;(event.shiftKey ? nextControls.at(-1) : nextControls[0])?.focus({ preventScroll: true })
          target.scrollIntoView({ block: 'nearest' })
        })
      }}
    >
      {rows}
    </div>
  )
}

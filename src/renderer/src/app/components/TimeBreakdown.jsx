import { Square } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PieChart } from 'react-minimal-pie-chart'
import { taskTimeTotals } from '../../../../domain/task-time'
import { minutesLabel } from '../utils/time'

export function TimeBreakdown({
  areas,
  tasks,
  events,
  dateKeys,
  includeEmptySessions = true,
  period = 'last week',
  showTitle = true,
  interactive = false,
}) {
  const [hover, setHover] = useState(null)
  const tooltipId = useId()
  const chartRef = useRef(null)
  const tooltipRef = useRef(null)
  const tooltipOpen = Boolean(hover)
  useEffect(() => {
    if (!tooltipOpen) return undefined
    const dismiss = () => setHover(null)
    const onKeyDown = (event) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [tooltipOpen])
  const distribution = areas
    .map((folder) => ({
      title: folder.label,
      color: folder.color,
      taskCount: new Set(tasks.filter((task) => task.channel === folder.label).map((task) => task.id)).size,
      value: taskTimeTotals(
        tasks.filter((task) => task.channel === folder.label),
        events,
        { dateKeys, includeEmptySessions: false },
      ).actual,
    }))
    .filter((item) => item.value > 0)
  const unassignedSessionMinutes = taskTimeTotals([], events, { dateKeys, includeEmptySessions }).actual
  if (unassignedSessionMinutes > 0)
    distribution.push({ title: 'Sessions', color: '#a4a4a4', value: unassignedSessionMinutes, taskCount: 0 })

  const active = hover ? distribution[hover.index] : null
  const describe = (item) =>
    `${item.taskCount} ${item.taskCount === 1 ? 'task' : 'tasks'} · ${Math.round(item.value / 6) / 10} hr`
  // The chart library exposes segment focus handlers but no per-segment ARIA props.
  useLayoutEffect(() => {
    if (!interactive) return
    chartRef.current?.querySelectorAll('svg path').forEach((path, index) => {
      const item = distribution[index]
      if (item) {
        path.setAttribute('role', 'img')
        path.setAttribute('aria-label', `${item.title}: ${describe(item)}`)
      }
    })
  })
  const showSegment = (event, index) => {
    if (!interactive || !distribution[index]) return
    const rect = event.currentTarget.getBoundingClientRect()
    const pointer = event.type === 'mouseover'
    setHover({
      index,
      x: pointer ? event.clientX : rect.left + rect.width / 2,
      y: pointer ? event.clientY : rect.top,
      pointer,
    })
  }
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!tooltip || !hover) return
    const { width, height } = tooltip.getBoundingClientRect()
    tooltip.style.left = `${Math.max(width / 2 + 8, Math.min(window.innerWidth - width / 2 - 8, hover.x))}px`
    tooltip.style.top = `${Math.max(height + 8, hover.y - 12)}px`
  })

  return (
    <div className="weekly-time-breakdown">
      {showTitle ? <h2>How you spent your time</h2> : null}
      <div
        className="weekly-folder-chart"
        ref={chartRef}
        role={interactive ? 'group' : 'img'}
        aria-label={`Time spent ${period} by area: ${distribution.length ? distribution.map((item) => `${item.title}: ${interactive ? describe(item) : minutesLabel(item.value)}`).join(', ') : 'No recorded time'}`}
        aria-describedby={active ? tooltipId : undefined}
        onMouseMove={
          interactive
            ? (event) => {
                const { clientX: x, clientY: y } = event
                setHover((current) => (current?.pointer ? { ...current, x, y } : current))
              }
            : undefined
        }
        onMouseLeave={interactive ? () => setHover(null) : undefined}
      >
        <PieChart
          data={
            distribution.length
              ? distribution.map((item) => ({ ...item, title: interactive ? undefined : item.title }))
              : [{ title: 'No recorded time', value: 1, color: 'var(--neutral-200)' }]
          }
          lineWidth={42}
          startAngle={270}
          paddingAngle={1}
          animate={false}
          segmentsTabIndex={interactive && distribution.length ? 0 : undefined}
          segmentsStyle={
            interactive
              ? (index) => ({ opacity: active && hover.index !== index ? 0.35 : 1, cursor: 'default' })
              : undefined
          }
          onMouseOver={interactive ? showSegment : undefined}
          onMouseOut={interactive ? () => setHover(null) : undefined}
          onFocus={interactive ? showSegment : undefined}
          onBlur={interactive ? () => setHover(null) : undefined}
        />
      </div>
      {!interactive ? (
        <div className="weekly-folder-legend" aria-hidden="true">
          {!distribution.length ? <span>No recorded time</span> : null}
          {distribution.map((item) => (
            <span key={item.title}>
              <Square size={10} weight="fill" style={{ color: item.color }} /> {item.title}
            </span>
          ))}
        </div>
      ) : null}
      {active
        ? createPortal(
            <div
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              className="sidebar-project-tooltip time-breakdown-tooltip"
              style={{
                left: hover.x,
                top: hover.y - 12,
              }}
            >
              <strong>
                <Square size={10} weight="fill" style={{ color: active.color }} />
                {active.title}
              </strong>
              <span>{describe(active)}</span>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

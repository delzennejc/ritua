import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Square } from '@phosphor-icons/react'
import { addDays, dateFromKey, mondayOf } from '../../../../../domain/calendar-dates'

const dateLabel = (key) =>
  dateFromKey(key).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
const detail = (day) =>
  day.current
    ? 'Today · In progress'
    : `${day.taskCount} ${day.taskCount === 1 ? 'task' : 'tasks'} · ${Math.round(day.minutes / 6) / 10} hr logged`
// Six tasks plus six logged hours reach full intensity; either measure can contribute.
const activityIntensity = (day) => Math.min(1, day.taskCount / 12 + day.minutes / 720)
const activityOpacity = (day) => `${25 + 75 * activityIntensity(day)}%`

export function DailyActivityGrid({ days, areas, includeToday = true }) {
  const visibleDays =
    includeToday && days.length
      ? [
          ...days,
          {
            dateKey: addDays(days.at(-1).dateKey, 1),
            current: true,
            minutes: 0,
            taskCount: 0,
            areaBreakdown: [],
          },
        ]
      : days
  const firstWeekday = days.length ? (dateFromKey(days[0].dateKey).getDay() + 6) % 7 : 0
  const weekCount = Math.ceil((firstWeekday + visibleDays.length) / 7)
  const weekColumns = []
  const columns = []
  let previousMonth = null
  // Thursday always belongs to the month containing most of a Monday–Sunday week.
  for (let week = weekCount - 1; week >= 0; week--) {
    const weekStart = mondayOf(visibleDays[Math.max(0, week * 7 - firstWeekday)].dateKey)
    const month = addDays(weekStart, 3).slice(0, 7)
    if (previousMonth && month !== previousMonth) columns.push('2px')
    columns.push('10px')
    weekColumns[week] = columns.length
    previousMonth = month
  }
  const [hover, setHover] = useState(null)
  const tooltipRef = useRef(null)
  const contentRef = useRef(null)
  const closeTimer = useRef(null)
  const tooltipId = useId()
  const open = Boolean(hover)
  const dismiss = useCallback(() => {
    clearTimeout(closeTimer.current)
    setHover(null)
  }, [])
  const deferDismiss = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(dismiss, 120)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open, dismiss])
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!tooltip || !contentRef.current || !hover) return
    const { width, height } = contentRef.current.getBoundingClientRect()
    tooltip.style.width = `${width}px`
    tooltip.style.height = `${height}px`
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, hover.x - width / 2))}px`
    const fitsAbove = hover.y - height - 12 >= 8
    tooltip.style.top = `${fitsAbove ? hover.y - height - 12 : Math.max(8, Math.min(hover.bottom + 12, window.innerHeight - height - 8))}px`
  })
  const show = (event, day) => {
    clearTimeout(closeTimer.current)
    const rect = event.currentTarget.getBoundingClientRect()
    setHover({ day, x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom })
  }
  return (
    <div
      className="daily-activity-grid"
      style={{ gridTemplateColumns: columns.join(' ') }}
      onMouseLeave={dismiss}
      role="group"
      aria-label={`Activity over the last six months, with ${includeToday ? 'today enlarged in black with a white center dot' : 'yesterday enlarged and marked with a center dot'}. Newest weeks are on the left, older weeks on the right, Monday to Sunday from top to bottom. Green squares become more opaque with more tasks and logged hours.`}
    >
      {visibleDays.map((day, index) => (
        <span
          key={day.dateKey}
          className="daily-activity-day"
          data-level={day.taskCount > 0 || day.minutes > 0 ? 1 : 0}
          data-date={day.dateKey}
          data-current-day={day.current ? true : undefined}
          data-highlighted-day={index === visibleDays.length - 1 ? true : undefined}
          aria-current={index === visibleDays.length - 1 ? 'date' : undefined}
          style={{
            gridColumn: weekColumns[Math.floor((firstWeekday + index) / 7)],
            gridRow: ((firstWeekday + index) % 7) + 1,
            '--activity-opacity': activityOpacity(day),
            '--activity-dot-color': day.current || activityIntensity(day) >= 0.5 ? '#fff' : '#000',
            '--activity-enter-delay': `${(weekCount - 1 - Math.floor((firstWeekday + index) / 7)) * 20}ms`,
          }}
          role="img"
          tabIndex={0}
          aria-label={`${!includeToday && index === visibleDays.length - 1 ? 'Yesterday, ' : ''}${dateLabel(day.dateKey)}: ${detail(day)}`}
          aria-describedby={hover?.day.dateKey === day.dateKey ? tooltipId : undefined}
          onMouseEnter={(event) => show(event, day)}
          onMouseLeave={deferDismiss}
          onFocus={(event) => show(event, day)}
          onBlur={deferDismiss}
        />
      ))}
      {hover
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className="sidebar-project-tooltip time-breakdown-tooltip daily-activity-tooltip"
            >
              <div className="daily-activity-tooltip-content" ref={contentRef} key={hover.day.dateKey}>
                <strong>{dateLabel(hover.day.dateKey)}</strong>
                <span>{detail(hover.day)}</span>
                {hover.day.areaBreakdown.length ? (
                  <div className="daily-activity-area-list">
                    {hover.day.areaBreakdown.map((entry) => (
                      <div className="daily-activity-area-row" key={entry.area || 'unassigned'}>
                        <span className="daily-activity-area-name">
                          <Square
                            size={9}
                            weight="fill"
                            aria-hidden="true"
                            style={{
                              color:
                                areas.find((area) => area.label === entry.area)?.color ||
                                'var(--neutral-400)',
                            }}
                          />
                          {entry.area || 'Unassigned'}
                        </span>
                        <span>{detail(entry).replace(' logged', '')}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

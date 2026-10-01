import { useWorkspaceTaskActions } from '../hooks/useWorkspaceTaskActions.js'
import { useWorkspaceCollections } from '../hooks/useWorkspaceCollections.js'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarPane } from '../components/CalendarPanel'
import { CURRENT_DATE_KEY, dateFromKey, isoWeekNumber } from '../utils/dates'
import { filterItemsByArea } from '../utils/areas'

const dateKeyFromDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const weekDateKeysFor = (dateKey) => {
  const selectedDate = dateFromKey(dateKey)
  const monday = new Date(selectedDate)
  monday.setDate(selectedDate.getDate() - ((selectedDate.getDay() + 6) % 7))

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return dateKeyFromDate(date)
  })
}

export const weekDateLabel = (dateKeys) => {
  if (!dateKeys.length) return 'Week'
  const firstDate = dateFromKey(dateKeys[0])
  const lastDate = dateFromKey(dateKeys[dateKeys.length - 1])
  const includesToday = dateKeys.includes(CURRENT_DATE_KEY)
  if (includesToday) return 'This week'

  const firstLabel = firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const lastLabel = lastDate.toLocaleDateString(
    'en-US',
    firstDate.getMonth() === lastDate.getMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' },
  )
  return `${firstLabel}–${lastLabel}`
}

export const weekPeriodLabel = (dateKeys) => {
  const firstDate = dateFromKey(dateKeys[0])
  const lastDate = dateFromKey(dateKeys[dateKeys.length - 1])
  const firstYear = firstDate.getFullYear()
  const lastYear = lastDate.getFullYear()
  const shortMonth = (date) => date.toLocaleDateString('en-US', { month: 'short' })
  let monthYear

  if (firstYear !== lastYear) {
    monthYear = `${shortMonth(firstDate)} ${firstYear} – ${shortMonth(lastDate)} ${lastYear}`
  } else if (firstDate.getMonth() !== lastDate.getMonth()) {
    monthYear = `${shortMonth(firstDate)} – ${shortMonth(lastDate)} ${firstYear}`
  } else {
    monthYear = firstDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  return { monthYear, weekNumber: isoWeekNumber(dateKeys[0]) }
}

const dateKeyAfterDays = (dateKey, dayOffset) => {
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + dayOffset)
  return dateKeyFromDate(date)
}

const EMPTY_TASKS = Object.freeze([])

const WeekCalendarPage = memo(function WeekCalendarPage({
  pageDateKey,
  active,
  gridScrollRef,
  getInitialScrollTop,
  selectedAreaIds,
  areas,
  boardTasksByDate,
  events,
  setEvents,
  onCreateCalendarSession,
  onCreateCalendarTask,
  onOpenTask,
}) {
  const pageRef = useRef(null)
  const [readyDays, setReadyDays] = useState(() => (active ? 7 : 0))
  const days = useMemo(
    () =>
      weekDateKeysFor(pageDateKey).map((dateKey) => {
        const tasks = boardTasksByDate[dateKey] || EMPTY_TASKS
        return {
          dateKey,
          tasks,
          visibleTaskIds: selectedAreaIds.length
            ? filterItemsByArea(tasks, selectedAreaIds, areas).map((task) => task.id)
            : null,
        }
      }),
    [pageDateKey, boardTasksByDate, selectedAreaIds, areas],
  )
  useEffect(() => {
    if (readyDays >= 7) return
    // Warm the offscreen adjacent week one day per frame. Paging retains both
    // visible weeks, so mounting the next neighbor doesn't block a whole frame.
    const frame = requestAnimationFrame(() => setReadyDays((count) => count + 1))
    return () => cancelAnimationFrame(frame)
  }, [readyDays])
  useLayoutEffect(() => {
    if (readyDays >= 7) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.intersectionRatio > 0)) setReadyDays(7)
      },
      { root: gridScrollRef.current },
    )
    observer.observe(pageRef.current)
    return () => observer.disconnect()
  }, [gridScrollRef, readyDays])
  return (
    <div className="week-calendar-days" data-week-calendar-page={pageDateKey} ref={pageRef}>
      {days.map(({ dateKey, tasks, visibleTaskIds }, index) => (
        <section
          className={`week-calendar-day ${dateKey === CURRENT_DATE_KEY ? 'current-day' : ''}`.trim()}
          data-week-calendar-date={dateKey}
          key={dateKey}
        >
          {active || index < readyDays ? (
            <CalendarPane
              areas={areas}
              dateKey={dateKey}
              getInitialScrollTop={getInitialScrollTop}
              showDayReview
              selectedAreaIds={selectedAreaIds}
              enableSlotCreation
              events={events}
              onCreateSession={onCreateCalendarSession}
              onCreateTask={onCreateCalendarTask}
              onOpenTask={onOpenTask}
              setEvents={setEvents}
              tasks={tasks}
              visibleTaskIds={visibleTaskIds}
            />
          ) : null}
        </section>
      ))}
    </div>
  )
})

export function WeekCalendarView({ selectedAreaIds, selectedDateKey, availableDateKeys = [], onDateChange }) {
  const { onCreateCalendarSession, onCreateCalendarTask, onOpenTask } = useWorkspaceTaskActions()

  const { areas, boardTasksByDate, events, setEvents } = useWorkspaceCollections()

  const gridScrollRef = useRef(null)
  const calendarDaysRef = useRef(null)
  const scrollSettleTimerRef = useRef(null)
  const recenteringRef = useRef(false)
  const timelineScrollTopRef = useRef(6.5 * 60)
  const getInitialScrollTop = useCallback(() => timelineScrollTopRef.current, [])
  const adjacentDateKeys = [-7, 7].map((dayOffset) => dateKeyAfterDays(selectedDateKey, dayOffset))
  const pageDateKeys = [
    ...(availableDateKeys.includes(adjacentDateKeys[0]) ? [adjacentDateKeys[0]] : []),
    selectedDateKey,
    ...(availableDateKeys.includes(adjacentDateKeys[1]) ? [adjacentDateKeys[1]] : []),
  ]
  const currentPageIndex = pageDateKeys.indexOf(selectedDateKey)

  useLayoutEffect(() => {
    const scrollElement = gridScrollRef.current
    if (!scrollElement) return
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current)
    recenteringRef.current = true
    const currentPage = scrollElement.querySelectorAll('[data-week-calendar-page]')[currentPageIndex]
    scrollElement.scrollTo({
      left: currentPage?.offsetLeft || 0,
      behavior: 'instant',
    })
    requestAnimationFrame(() => {
      recenteringRef.current = false
    })
  }, [currentPageIndex, selectedDateKey])

  useEffect(
    () => () => {
      if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current)
    },
    [],
  )

  const commitVisibleWeek = (event) => {
    if (recenteringRef.current) return
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current)
    const scrollElement = event.currentTarget
    scrollSettleTimerRef.current = setTimeout(() => {
      const pages = Array.from(scrollElement.querySelectorAll('[data-week-calendar-page]'))
      if (!pages.length) return
      const nextPageIndex = pages.reduce(
        (closestIndex, page, pageIndex) =>
          Math.abs(page.offsetLeft - scrollElement.scrollLeft) <
          Math.abs(pages[closestIndex].offsetLeft - scrollElement.scrollLeft)
            ? pageIndex
            : closestIndex,
        0,
      )
      const nextDateKey = pageDateKeys[nextPageIndex]
      if (nextDateKey && nextDateKey !== selectedDateKey) onDateChange(nextDateKey)
    }, 120)
  }

  useLayoutEffect(() => {
    const track = calendarDaysRef.current
    let synchronizing = false
    const synchronizeScroll = (event) => {
      if (synchronizing || !event.target.matches('.calendar-timeline-scroll')) return
      if (event.target.scrollTop === timelineScrollTopRef.current) return
      synchronizing = true
      timelineScrollTopRef.current = event.target.scrollTop
      track.querySelectorAll('.calendar-timeline-scroll').forEach((element) => {
        if (element !== event.target && element.scrollTop !== timelineScrollTopRef.current)
          element.scrollTop = timelineScrollTopRef.current
      })
      requestAnimationFrame(() => {
        synchronizing = false
      })
    }
    // Capture handles timelines warmed after the initial render as well.
    track.addEventListener('scroll', synchronizeScroll, { passive: true, capture: true })
    return () => track.removeEventListener('scroll', synchronizeScroll, { capture: true })
  }, [])

  return (
    <div
      className="week-calendar-grid-scroll"
      ref={gridScrollRef}
      onScroll={commitVisibleWeek}
      data-week-calendar-scroll-container="true"
    >
      <div className="week-calendar-track" ref={calendarDaysRef}>
        {pageDateKeys.map((pageDateKey) => (
          <WeekCalendarPage
            key={pageDateKey}
            pageDateKey={pageDateKey}
            active={pageDateKey === selectedDateKey}
            gridScrollRef={gridScrollRef}
            getInitialScrollTop={getInitialScrollTop}
            selectedAreaIds={selectedAreaIds}
            areas={areas}
            boardTasksByDate={boardTasksByDate}
            events={events}
            setEvents={setEvents}
            onCreateCalendarSession={onCreateCalendarSession}
            onCreateCalendarTask={onCreateCalendarTask}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </div>
  )
}

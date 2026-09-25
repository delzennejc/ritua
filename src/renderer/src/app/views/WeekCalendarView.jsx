import { useWorkspaceTaskActions } from '../hooks/useWorkspaceTaskActions.js'
import { useWorkspaceCollections } from '../hooks/useWorkspaceCollections.js'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { CalendarPane } from '../components/CalendarPanel'
import { CURRENT_DATE_KEY, dateFromKey } from '../utils/dates'
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

const dateKeyAfterDays = (dateKey, dayOffset) => {
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + dayOffset)
  return dateKeyFromDate(date)
}

export function WeekCalendarView({ selectedAreaIds, selectedDateKey, availableDateKeys = [], onDateChange }) {
  const { onCreateCalendarSession, onCreateCalendarTask, onOpenTask } = useWorkspaceTaskActions()

  const { areas, tasks, datedTasksByDate, events, setEvents } = useWorkspaceCollections()

  const gridScrollRef = useRef(null)
  const calendarDaysRef = useRef(null)
  const scrollSettleTimerRef = useRef(null)
  const recenteringRef = useRef(false)
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
    const scrollElements = Array.from(
      calendarDaysRef.current?.querySelectorAll('.calendar-timeline-scroll') || [],
    )
    let synchronizing = false
    const synchronizeScroll = (event) => {
      if (synchronizing) return
      synchronizing = true
      scrollElements.forEach((element) => {
        if (element !== event.currentTarget) element.scrollTop = event.currentTarget.scrollTop
      })
      requestAnimationFrame(() => {
        synchronizing = false
      })
    }

    scrollElements.forEach((element) =>
      element.addEventListener('scroll', synchronizeScroll, { passive: true }),
    )
    return () => scrollElements.forEach((element) => element.removeEventListener('scroll', synchronizeScroll))
  }, [pageDateKeys.join('|')])

  return (
    <div
      className="week-calendar-grid-scroll"
      ref={gridScrollRef}
      onScroll={commitVisibleWeek}
      data-week-calendar-scroll-container="true"
    >
      <div className="week-calendar-track" ref={calendarDaysRef}>
        {pageDateKeys.map((pageDateKey) => (
          <div className="week-calendar-days" data-week-calendar-page={pageDateKey} key={pageDateKey}>
            {weekDateKeysFor(pageDateKey).map((dateKey) => {
              const dayTasks = dateKey === CURRENT_DATE_KEY ? tasks : datedTasksByDate[dateKey] || []
              const visibleTasks = filterItemsByArea(dayTasks, selectedAreaIds, areas)
              return (
                <section
                  className={`week-calendar-day ${dateKey === CURRENT_DATE_KEY ? 'current-day' : ''}`.trim()}
                  data-week-calendar-date={dateKey}
                  key={dateKey}
                >
                  <CalendarPane
                    areas={areas}
                    dateKey={dateKey}
                    selectedAreaIds={selectedAreaIds}
                    enableSlotCreation
                    events={events}
                    onCreateSession={onCreateCalendarSession}
                    onCreateTask={onCreateCalendarTask}
                    onOpenTask={onOpenTask}
                    setEvents={setEvents}
                    tasks={dayTasks}
                    visibleTaskIds={selectedAreaIds.length ? visibleTasks.map((task) => task.id) : null}
                  />
                </section>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

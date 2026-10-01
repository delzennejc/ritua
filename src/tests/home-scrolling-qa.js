// Explicit large-workspace fixture and scrolling measurements for the isolated native QA app.
import { emptyWorkspace } from '../domain/production-workspace'
import { normalize, project } from '../domain/workspace'
import { addDays, calendarDaysAround, localDateKey, mondayOf } from '../domain/calendar-dates'
import {
  replaceWorkspaceDocument,
  flushWorkspace,
  getWorkspaceFields,
} from '../renderer/src/desktop/workspace-store'
import { DragDropManager, Draggable } from '@dnd-kit/dom'
import { BatchedDragAccessibility } from '../renderer/src/app/interactions/BatchedDragAccessibility'

const painted = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
export const homeQaFields = () => getWorkspaceFields()
export const flushHomeQa = () => flushWorkspace()

export async function verifyDragAccessibilityBatching() {
  let scans = 0
  class CountingAccessibility extends BatchedDragAccessibility {
    registerEffect(callback) {
      return super.registerEffect(() => {
        scans++
        return callback.call(this)
      })
    }
  }
  const root = document.createElement('div')
  root.hidden = true
  document.body.append(root)
  const manager = new DragDropManager({ plugins: [CountingAccessibility], sensors: [] })
  const draggables = Array.from({ length: 40 }, (_, index) => {
    const element = document.createElement('div')
    root.append(element)
    return new Draggable({ id: `qa-accessibility-${index}`, element }, manager)
  })
  await painted()
  const initialScans = scans
  const initialAttributes = draggables.every(
    ({ element }) =>
      element.tabIndex === 0 &&
      element.getAttribute('aria-roledescription') === 'draggable' &&
      Boolean(document.getElementById(element.getAttribute('aria-describedby'))) &&
      element.getAttribute('aria-disabled') === 'false',
  )
  const handle = document.createElement('button')
  root.append(handle)
  draggables[0].handle = handle
  draggables[0].disabled = true
  await painted()
  const replacedHandle =
    handle.getAttribute('aria-disabled') === 'true' && Boolean(handle.getAttribute('aria-describedby'))
  draggables[0].disabled = false
  await painted()
  const reenabled = handle.getAttribute('aria-disabled') === 'false'
  // Destroy with an attribute scan queued: it must not recreate instructions.
  draggables[0].disabled = true
  const beforeDestroy = scans
  const descriptionId = handle.getAttribute('aria-describedby')
  manager.destroy()
  draggables.forEach((draggable) => draggable.destroy())
  root.remove()
  await painted()
  return {
    initialScans,
    initialAttributes,
    replacedHandle,
    reenabled,
    destroyed: scans === beforeDestroy && !document.getElementById(descriptionId),
  }
}

export async function seedHomeScrolling(tasksPerDay = 20) {
  const today = localDateKey()
  const fields = project(emptyWorkspace(today))
  fields.view = 'home'
  fields['daily.completedDate'] = today
  fields['weekly.completedWeek'] = mondayOf(today)
  fields.rightPanelOpenByPage = { home: false, today: true }
  fields.rightPanes = { home: 'board', today: 'calendar' }
  fields.events = []
  fields.tasks = []
  fields.datedTasksByDate = {}
  for (const day of calendarDaysAround(today)) {
    const tasks = Array.from({ length: tasksPerDay }, (_, index) => ({
      id: `qa-home-${day.dateKey}-${index}`,
      title:
        index % 5 === 0
          ? `Task ${index + 1}: Review the detailed notes and prepare the team's next steps`
          : `Task ${index + 1}: Prepare next steps`,
      channel: index % 3 === 0 ? 'Personal' : 'Work',
      minutes: 30,
      complete: false,
      ...(index % 7 === 0
        ? { subtasks: [{ id: `step-${index}`, title: 'Collect feedback', complete: false }] }
        : {}),
    }))
    if (day.dateKey === today) fields.tasks = tasks
    else fields.datedTasksByDate[day.dateKey] = tasks
    for (const [index, task] of tasks.slice(0, 12).entries()) {
      fields.events.push({
        id: task.id,
        dateKey: day.dateKey,
        taskId: task.id,
        title: task.title,
        color: 'violet',
        start: 420 + index * 45,
        end: 450 + index * 45,
      })
    }
    fields.events.push({
      id: `qa-session-${day.dateKey}`,
      kind: 'session',
      dateKey: day.dateKey,
      title: 'Team focus',
      start: 1050,
      end: 1140,
      taskIds: tasks.slice(12, 15).map((task) => task.id),
    })
  }
  // Include an overnight event to verify both visual slices when weeks change.
  const overnightDate = addDays(mondayOf(today), 6)
  const overnightTask = (fields.datedTasksByDate[overnightDate] || fields.tasks)[0]
  fields.events.push({
    id: 'qa-home-overnight',
    taskId: overnightTask.id,
    dateKey: overnightDate,
    title: overnightTask.title,
    color: 'blue',
    start: 1410,
    end: 1470,
  })
  replaceWorkspaceDocument(normalize(fields))
  await flushWorkspace()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return {
    days: calendarDaysAround(today).length,
    tasks: calendarDaysAround(today).length * tasksPerDay,
    events: fields.events.length,
  }
}

export async function measureHomeScroll(selector, axis = 'x', steps = 40, distance = 35) {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Missing scroll surface: ${selector}`)
  const previousSnap = element.style.scrollSnapType
  element.style.scrollSnapType = 'none'
  const startPosition = axis === 'x' ? element.scrollLeft : element.scrollTop
  const startScrollHeight = element.scrollHeight
  const weekPages = () =>
    [...document.querySelectorAll('[data-week-calendar-page]')].map((page) => page.dataset.weekCalendarPage)
  const startWeekPages = weekPages()
  const intervals = []
  let previous = performance.now()
  for (let index = 0; index < steps + 25; index++) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const now = performance.now()
    intervals.push(now - previous)
    previous = now
    if (index < steps)
      element.scrollBy(
        axis === 'x' ? { left: distance, behavior: 'instant' } : { top: distance, behavior: 'instant' },
      )
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  element.style.scrollSnapType = previousSnap
  const sorted = intervals.slice(1).sort((a, b) => a - b)
  return {
    selector,
    axis,
    startPosition,
    endPosition: axis === 'x' ? element.scrollLeft : element.scrollTop,
    startScrollHeight,
    endScrollHeight: element.scrollHeight,
    startWeekPages,
    endWeekPages: weekPages(),
    frames: sorted.length,
    medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
    maxMs: +sorted.at(-1).toFixed(1),
    slowFrames: sorted.filter((ms) => ms > 33.4).length,
    mountedCards: document.querySelectorAll('.task-card').length,
    mountedEvents: document.querySelectorAll('.calendar-event').length,
  }
}

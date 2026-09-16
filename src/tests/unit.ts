import './project-card-tasks.test'
import './project-task-order.test'
import './workspace-immutable.test'
import './workspace-command-boundaries.test'
import './workspace-sequences.test'
import './organization-commands.test'
import './workspace-session.test'
import test from 'node:test'
import './task-deletion.test'
import './board-scroll.test.mjs'
import './calendar-utils.test.js'
import './task-time.test.mjs'
import './session-board-order.test'
import { testTaskCompletion } from './task-completion-tests'
import { testCalendarSessions } from './calendar-session-tests'
import { testDailyPlanning } from './daily-planning-tests'
import { testPlanningEntry } from './planning-entry-tests'

test('task completion and calendar consequences', testTaskCompletion)
test('calendar session membership', () => {
  testCalendarSessions()
})
test('daily planning', testDailyPlanning)
test('planning entry', testPlanningEntry)

import { testTaskCalendarBlocks } from './task-calendar-tests'
test('multiple calendar blocks share one task and sum their durations', () => {
  testTaskCalendarBlocks()
})

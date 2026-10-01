import { CheckCircle } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { isDayReviewed } from '../../../../domain/day-review'
import { workspaceStore } from '../../desktop/workspace-store'
import { togglePastDayReview } from '../../desktop/daily-plan-actions'
import { CURRENT_DATE_KEY, dateFromKey } from '../utils/dates'
import { ProjectProgressCircle, projectTaskProgress } from './ProjectProgressCircle'
import { ReviewCheckVisual } from './ReviewCheckVisual'
import { animateReviewCheck } from '../utils/review-check-animation'

export function DayCompletionIndicator({ dateKey, tasks = [], className = '', size = 20 }) {
  const reviewed = useStore(workspaceStore, (state) => isDayReviewed(state.document, dateKey))
  const buttonRef = useRef(null)
  const [checkAnimationKey, setCheckAnimationKey] = useState(0)
  const lastAnimatedKey = useRef(0)
  useLayoutEffect(() => {
    if (!reviewed || lastAnimatedKey.current === checkAnimationKey) return
    lastAnimatedKey.current = checkAnimationKey
    const animations = animateReviewCheck(buttonRef.current)
    // Unchecking or leaving Home cancels immediately; cancellation is expected.
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      animations.forEach((animation) => animation.cancel())
    })
    return () => animations.forEach((animation) => animation.cancel())
  }, [reviewed, dateKey, checkAnimationKey])
  if (dateKey > CURRENT_DATE_KEY) return null
  if (dateKey === CURRENT_DATE_KEY) {
    const { taskCount, completedTaskCount, isComplete } = projectTaskProgress(tasks)
    return (
      <span
        className={`day-completion-indicator ${className}`.trim()}
        data-day-completion-date={dateKey}
        data-day-state={!taskCount ? 'empty' : isComplete ? 'complete' : 'progress'}
        role="progressbar"
        aria-label="Today task completion"
        aria-valuemin={0}
        aria-valuemax={taskCount || 1}
        aria-valuenow={completedTaskCount}
        aria-valuetext={
          taskCount ? `${completedTaskCount} of ${taskCount} tasks complete` : 'No tasks planned'
        }
        title={taskCount ? `${completedTaskCount} of ${taskCount} tasks complete` : 'No tasks planned'}
      >
        <ProjectProgressCircle size={size} tasks={tasks} />
      </span>
    )
  }
  const label = dateFromKey(dateKey).toLocaleDateString('en-US', { dateStyle: 'full' })
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`icon-button day-completion-indicator day-review-checkbox ${reviewed ? 'is-reviewed' : ''} ${className}`.trim()}
      data-day-completion-date={dateKey}
      role="checkbox"
      aria-label={`Review for ${label}`}
      aria-checked={reviewed}
      title={`Mark ${label} ${reviewed ? 'unreviewed' : 'reviewed'}`}
      onClick={() => {
        if (togglePastDayReview(dateKey)) setCheckAnimationKey((key) => key + 1)
      }}
    >
      <ReviewCheckVisual>
        <CheckCircle size={size} weight={reviewed ? 'fill' : 'regular'} aria-hidden="true" />
      </ReviewCheckVisual>
    </button>
  )
}

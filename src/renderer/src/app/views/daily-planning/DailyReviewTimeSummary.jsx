import { CaretDown } from '@phosphor-icons/react'
import { TimeBreakdown } from '../../components/TimeBreakdown'
import { taskTimeTotals } from '../../../../../domain/task-time'
import { DailyActivityGrid } from './DailyActivityGrid'

export function DailyReviewTimeSummary({ areas, tasks, events, dateKeys, activity }) {
  const minutes = taskTimeTotals(tasks, events, { dateKeys }).actual
  const hours = Math.round(minutes / 6) / 10
  const maximum = Math.max(12 * 60, minutes)
  const position = (value) => `${(value / maximum) * 100}%`
  return (
    <div className="daily-review-time-summary">
      <section className="daily-review-total-time" aria-label="Yesterday’s total time">
        <div className="review-time-meter" title="Time you logged yesterday">
          <progress value={minutes} max={maximum} aria-label={`${hours} hours recorded yesterday`} />
          <span
            className="actual-time-callout"
            style={{ left: `clamp(30px, calc(${position(minutes)} * var(--daily-time-progress)), calc(100% - 30px))` }}
          >
            <strong>{hours} hr</strong>
            <CaretDown size={16} weight="fill" aria-hidden="true" />
          </span>
          {[6, 8].map((hour) => (
            <span key={hour} aria-hidden="true">
              <span className="hour-tick" style={{ left: position(hour * 60) }} />
              <span className="hour-label" style={{ left: position(hour * 60) }}>
                {hour} hr
              </span>
            </span>
          ))}
        </div>
      </section>
      <TimeBreakdown
        areas={areas}
        tasks={tasks}
        events={events}
        dateKeys={dateKeys}
        period="yesterday"
        showTitle={false}
        interactive
      />
      <DailyActivityGrid days={activity} areas={areas} includeToday={false} />
    </div>
  )
}

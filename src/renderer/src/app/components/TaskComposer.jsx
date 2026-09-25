import { ChoiceDropdown } from './Dropdown'
import { ArrowsClockwise, Prohibit, CalendarBlank, CaretDown, Clock, Folder, X } from '@phosphor-icons/react'
import { DEFAULT_AREAS } from '../../../../domain/workspace-defaults'
import { dateFromKey } from '../utils/dates'
import { CALENDAR_DAY_MINUTES, CALENDAR_SNAP_MINUTES } from '../utils/calendar'
import {
  recurrenceForPreset,
  recurrenceLabel,
  recurrenceOptions,
  RECURRENCE_PRESETS,
} from '../../../../domain/recurrence'
import { timeLabel } from '../utils/time'
import { RecurrenceCustomFields } from './RecurrenceCustomFields'

const START_TIME_OPTIONS = Array.from(
  { length: CALENDAR_DAY_MINUTES / CALENDAR_SNAP_MINUTES },
  (_, index) => index * CALENDAR_SNAP_MINUTES,
)
const END_TIME_OPTIONS = START_TIME_OPTIONS.map((start) => start + CALENDAR_SNAP_MINUTES)

function ComposerField({ children, className = '', icon, label, style, value }) {
  return (
    <div className={`task-composer-field ${className}`} style={style}>
      <span className="task-composer-field-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="task-composer-field-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <CaretDown className="task-composer-field-caret" size={13} aria-hidden="true" />
      {children}
    </div>
  )
}

export function TaskComposer({
  entityLabel = 'Task',
  area,
  areas = DEFAULT_AREAS,
  ariaLabel,
  className = '',
  dateKey,
  end,
  error = '',
  formRef,
  helper,
  onAreaChange,
  onCancel,
  onDateChange,
  onEndChange,
  onKeyDown,
  onRecurrenceChange,
  onStartChange,
  onSubmit,
  onTitleChange,
  recurrence,
  start,
  style,
  submitLabel,
  title,
  titleInputRef,
}) {
  const scheduled = Number.isFinite(start) && Number.isFinite(end)
  const selectedArea = areas.find((item) => item.label === area) || areas[0] || DEFAULT_AREAS[0]
  const dateLabel = dateFromKey(dateKey).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const customRecurrence = recurrence?.preset === RECURRENCE_PRESETS.CUSTOM

  return (
    <form
      ref={formRef}
      className={`task-composer ${scheduled ? 'scheduled' : 'board'} ${className}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
    >
      <header className="task-composer-header">
        <div>
          <span className="task-composer-eyebrow">{entityLabel}</span>
          <h2>New {entityLabel.toLowerCase()}</h2>
        </div>
        <button
          className="task-composer-close"
          type="button"
          aria-label={`Close ${entityLabel.toLowerCase()} creation`}
          onClick={onCancel}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="task-composer-body">
        <input
          ref={titleInputRef}
          className="task-composer-title-input"
          autoComplete="off"
          maxLength={entityLabel === 'Session' ? 500 : undefined}
          aria-label={`${entityLabel} title`}
          placeholder={entityLabel === 'Session' ? 'What will you focus on?' : 'What needs to get done?'}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />

        <div className="task-composer-fields">
          <ComposerField
            className="task-composer-date-field"
            icon={<CalendarBlank size={18} />}
            label="When"
            value={dateLabel}
          >
            <input
              aria-label={`${entityLabel} date`}
              type="date"
              value={dateKey}
              onChange={(event) => {
                if (!event.target.value) return
                const nextDateKey = event.target.value
                onDateChange(nextDateKey)
                if (recurrence?.preset !== RECURRENCE_PRESETS.CUSTOM) {
                  onRecurrenceChange?.(
                    recurrenceForPreset(
                      recurrence?.preset || RECURRENCE_PRESETS.NONE,
                      nextDateKey,
                      recurrence,
                    ),
                  )
                }
              }}
            />
          </ComposerField>

          {scheduled ? (
            <>
              <ComposerField icon={<Clock size={18} />} label="Starts" value={timeLabel(start)}>
                <ChoiceDropdown
                  label={`${entityLabel} start time`}
                  className="composer-field-dropdown"
                  trigger={<span className="sr-only">{entityLabel} start time</span>}
                  value={start}
                  onChange={onStartChange}
                  options={START_TIME_OPTIONS.map((value) => ({
                    value,
                    label: timeLabel(value),
                    icon: <Clock size={16} />,
                  }))}
                />
              </ComposerField>
              <ComposerField
                icon={<Clock size={18} />}
                label="Ends"
                value={end === 24 * 60 ? '00:00' : timeLabel(end)}
              >
                <ChoiceDropdown
                  label={`${entityLabel} end time`}
                  className="composer-field-dropdown"
                  trigger={<span className="sr-only">{entityLabel} end time</span>}
                  value={end}
                  onChange={onEndChange}
                  options={END_TIME_OPTIONS.map((value) => ({
                    value,
                    label: value === 1440 ? '00:00' : timeLabel(value),
                    icon: <Clock size={16} />,
                  }))}
                />
              </ComposerField>
            </>
          ) : null}

          {onAreaChange ? (
            <ComposerField
              className="task-composer-area-field"
              icon={<Folder size={18} weight="fill" />}
              label="Area"
              style={{ '--task-composer-area-color': selectedArea.color }}
              value={selectedArea.label}
            >
              <ChoiceDropdown
                label={`${entityLabel} area`}
                className="composer-field-dropdown"
                trigger={<span className="sr-only">{entityLabel} area</span>}
                value={selectedArea.label}
                onChange={onAreaChange}
                options={areas.map((area) => ({
                  value: area.label,
                  label: area.label,
                  icon: <Folder size={16} weight="fill" style={{ color: area.color }} />,
                }))}
              />
            </ComposerField>
          ) : null}

          {onRecurrenceChange ? (
            <ComposerField
              className="task-composer-recurrence-field"
              icon={<ArrowsClockwise size={18} />}
              label="Repeat"
              value={recurrenceLabel(recurrence, dateKey)}
            >
              <ChoiceDropdown
                label="Task recurrence"
                className="composer-field-dropdown"
                trigger={<span className="sr-only">Task recurrence</span>}
                value={recurrence?.preset || RECURRENCE_PRESETS.NONE}
                onChange={(value) => onRecurrenceChange?.(recurrenceForPreset(value, dateKey, recurrence))}
                options={recurrenceOptions(dateKey).map((option) => ({
                  ...option,
                  icon:
                    option.value === RECURRENCE_PRESETS.NONE ? (
                      <Prohibit size={16} />
                    ) : (
                      <ArrowsClockwise size={16} />
                    ),
                }))}
              />
            </ComposerField>
          ) : null}
        </div>

        {customRecurrence ? (
          <RecurrenceCustomFields dateKey={dateKey} onChange={onRecurrenceChange} recurrence={recurrence} />
        ) : null}

        {error ? (
          <p className="task-composer-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="task-composer-footer">
        <span>{helper}</span>
        <div>
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={!title.trim()}>
            {submitLabel}
          </button>
        </div>
      </footer>
    </form>
  )
}

import { useId } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { Dropdown } from './Dropdown'
import { customRecurrenceForChange, WEEKDAY_LABELS } from '../../../../domain/recurrence'

export function RecurrenceCustomFields({ dateKey, onChange, recurrence }) {
  const endChoiceName = useId()
  const recurrenceEnd = recurrence?.end || { type: 'never', date: '', count: 10 }
  const updateRecurrence = (change) => onChange(customRecurrenceForChange(recurrence, change, dateKey))

  return (
    <section className="task-composer-recurrence-custom" aria-label="Custom recurrence settings">
      <div className="task-composer-recurrence-every">
        <span>Repeat every</span>
        <input
          aria-label="Repeat interval"
          min="1"
          max="99"
          type="number"
          value={recurrence.interval}
          onChange={(event) =>
            updateRecurrence({
              interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)),
            })
          }
        />
        <Dropdown
          className="recurrence-unit-picker"
          label="Repeat unit"
          triggerClassName="task-details-recurrence-trigger"
          menuWidth={160}
          trigger={
            <>
              <span>{recurrence.frequency}</span>
              <CaretDown size={14} />
            </>
          }
          items={['day', 'week', 'month', 'year'].map((frequency) => ({
            id: frequency,
            label: frequency,
            role: 'menuitemradio',
            checked: recurrence.frequency === frequency,
            onSelect: () => updateRecurrence({ frequency }),
          }))}
        />
      </div>

      {recurrence.frequency === 'week' ? (
        <fieldset className="task-composer-repeat-days">
          <legend>Repeat on</legend>
          <div>
            {WEEKDAY_LABELS.map((label, dayIndex) => {
              const selected = recurrence.weekDays.includes(dayIndex)
              const weekday = new Date(2026, 7, 2 + dayIndex).toLocaleDateString('en-US', { weekday: 'long' })
              return (
                <button
                  aria-pressed={selected}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${weekday}`}
                  className={selected ? 'selected' : ''}
                  key={`${label}-${dayIndex}`}
                  type="button"
                  onClick={() => {
                    const nextDays = selected
                      ? recurrence.weekDays.filter((day) => day !== dayIndex)
                      : [...recurrence.weekDays, dayIndex].sort()
                    if (nextDays.length) updateRecurrence({ weekDays: nextDays })
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </fieldset>
      ) : null}

      {recurrence.frequency === 'month' ? (
        <div className="task-composer-month-mode">
          <span>Repeat by</span>
          <Dropdown
            label="Monthly repeat pattern"
            triggerClassName="task-details-recurrence-trigger"
            menuWidth={240}
            trigger={
              <>
                <span>{recurrence.monthMode === 'day' ? 'Day of the month' : 'Weekday position'}</span>
                <CaretDown size={14} />
              </>
            }
            items={[
              { id: 'day', label: 'Day of the month' },
              { id: 'weekday', label: 'Weekday position' },
            ].map((option) => ({
              ...option,
              role: 'menuitemradio',
              checked: recurrence.monthMode === option.id,
              onSelect: () => updateRecurrence({ monthMode: option.id }),
            }))}
          />
        </div>
      ) : null}

      <fieldset className="task-composer-recurrence-end">
        <legend>Ends</legend>
        <label>
          <input
            checked={recurrenceEnd.type === 'never'}
            name={endChoiceName}
            type="radio"
            onChange={() => updateRecurrence({ end: { type: 'never' } })}
          />
          <span>Never</span>
        </label>
        <label>
          <input
            checked={recurrenceEnd.type === 'on'}
            name={endChoiceName}
            type="radio"
            onChange={() =>
              updateRecurrence({
                end: { type: 'on', date: recurrenceEnd.date || dateKey },
              })
            }
          />
          <span>On</span>
          <input
            aria-label="Recurrence end date"
            disabled={recurrenceEnd.type !== 'on'}
            min={dateKey}
            type="date"
            value={recurrenceEnd.date || dateKey}
            onChange={(event) =>
              updateRecurrence({
                end: { type: 'on', date: event.target.value },
              })
            }
          />
        </label>
        <label>
          <input
            checked={recurrenceEnd.type === 'after'}
            name={endChoiceName}
            type="radio"
            onChange={() => updateRecurrence({ end: { type: 'after' } })}
          />
          <span>After</span>
          <input
            aria-label="Number of occurrences"
            disabled={recurrenceEnd.type !== 'after'}
            min="1"
            max="500"
            type="number"
            value={recurrenceEnd.count}
            onChange={(event) =>
              updateRecurrence({
                end: {
                  type: 'after',
                  count: Math.max(1, Math.min(500, Number(event.target.value) || 1)),
                },
              })
            }
          />
          <span>occurrences</span>
        </label>
      </fieldset>
    </section>
  )
}

import { useId } from 'react'
import { Dropdown } from '../Dropdown'
import { recurrenceOptions, RECURRENCE_PRESETS, recurrenceForPreset } from '../../../../../domain/recurrence'
import { CaretDown, Prohibit, ArrowsClockwise } from '@phosphor-icons/react'
import { RecurrenceCustomFields } from '../RecurrenceCustomFields'

export function RecurrenceEditor({ dateKey, onCancel, onChange, recurrence, taskScope = null }) {
  const scopeName = useId()
  return (
    <form
      className="task-details-recurrence-editor"
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key !== 'Escape') return
        keyboardEvent.preventDefault()
        keyboardEvent.stopPropagation()
        onCancel()
      }}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault()
        onChange(recurrence)
      }}
    >
      <div className="task-details-recurrence-preset">
        <span>Repeat</span>
        <Dropdown
          label="Task recurrence"
          triggerClassName="task-details-recurrence-trigger"
          menuWidth={320}
          trigger={
            <>
              <span>
                {
                  recurrenceOptions(dateKey).find(
                    (option) => option.value === (recurrence?.preset || RECURRENCE_PRESETS.NONE),
                  )?.label
                }
              </span>
              <CaretDown size={14} />
            </>
          }
          items={recurrenceOptions(dateKey).map((option) => ({
            id: option.value,
            label: option.label,
            icon:
              option.value === RECURRENCE_PRESETS.NONE ? (
                <Prohibit size={16} />
              ) : (
                <ArrowsClockwise size={16} />
              ),
            role: 'menuitemradio',
            checked: option.value === (recurrence?.preset || RECURRENCE_PRESETS.NONE),
            onSelect: () => onChange(recurrenceForPreset(option.value, dateKey, recurrence), false),
          }))}
        />
      </div>
      {recurrence?.preset === RECURRENCE_PRESETS.CUSTOM ? (
        <RecurrenceCustomFields
          dateKey={dateKey}
          onChange={(nextRecurrence) => onChange(nextRecurrence, false)}
          recurrence={recurrence}
        />
      ) : null}
      {taskScope ? (
        <fieldset className="task-details-recurrence-scope">
          <legend>Tasks</legend>
          <label className={taskScope.disabled ? 'disabled' : undefined}>
            <input
              checked={taskScope.disabled ? false : taskScope.value}
              disabled={taskScope.disabled}
              name={scopeName}
              type="radio"
              onChange={() => taskScope.onChange(true)}
            />
            <span>Repeat tasks with the session</span>
          </label>
          <label>
            <input
              checked={taskScope.disabled ? true : !taskScope.value}
              name={scopeName}
              type="radio"
              onChange={() => taskScope.onChange(false)}
            />
            <span>Session only</span>
          </label>
          {taskScope.disabled ? (
            <small className="task-details-recurrence-scope-hint">
              Add tasks to this session to repeat them in every occurrence.
            </small>
          ) : null}
        </fieldset>
      ) : null}
      <p>
        {taskScope && !taskScope.disabled
          ? 'Repeated tasks start fresh in every occurrence; this occurrence keeps its own tasks either way. '
          : ''}
        Changes apply from this occurrence or today, whichever is later. Past and completed tasks keep their
        history; individually edited future tasks are preserved.
      </p>
      <div className="task-details-recurrence-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          Save repeat
        </button>
      </div>
    </form>
  )
}

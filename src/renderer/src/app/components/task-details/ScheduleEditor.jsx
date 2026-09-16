import { timeLabel } from '../../utils/time'
export function ScheduleEditor({
  draft,
  error,
  onCancel,
  onClearError,
  onSubmit,
  blocks = [],
  selectedId,
  onSelectBlock,
  onRemoveBlock,
}) {
  return (
    <form className="task-details-schedule-editor" noValidate onChange={onClearError} onSubmit={onSubmit}>
      {blocks.length > 0 && (
        <label className="task-details-block-selector">
          <span>Calendar block</span>
          <select
            aria-label="Calendar block"
            value={selectedId || ''}
            onChange={(event) => onSelectBlock(event.target.value)}
          >
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.dateKey} · {timeLabel(block.start)}–{timeLabel(block.end)}
              </option>
            ))}
            <option value="">Add another block</option>
          </select>
        </label>
      )}
      <label>
        <span>Date</span>
        <input name="dateKey" type="date" required defaultValue={draft.dateKey} />
      </label>
      <label>
        <span>Starts</span>
        <input name="start" type="time" step="300" required defaultValue={draft.start} />
      </label>
      <label>
        <span>Ends</span>
        <input name="end" type="time" step="300" required defaultValue={draft.end} />
      </label>
      {error ? (
        <p className="task-details-schedule-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="task-details-schedule-actions">
        {selectedId && (
          <button
            className="secondary-button task-details-remove-block"
            type="button"
            onClick={onRemoveBlock}
          >
            Remove block
          </button>
        )}
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          Save time
        </button>
      </div>
    </form>
  )
}

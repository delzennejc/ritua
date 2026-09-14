export function ScheduleEditor({ draft, error, onCancel, onClearError, onSubmit }) {
  return (
    <form className="task-details-schedule-editor" noValidate onChange={onClearError} onSubmit={onSubmit}>
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
